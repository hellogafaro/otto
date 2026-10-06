import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir (its config.json and database) is fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-chat-headers-'))
process.env.OTTO_CONFIG_DIR = configDir

const { saveConfig, addWorkspace } = await import('../../config/storage.ts')
const { initDb } = await import('../../db/index.ts')
const { pushSchema } = await import('../../db/push.ts')
const { createSession, listSessions } = await import('../../sessions/storage.ts')
const { onChatsChange } = await import('../../sessions/chats.ts')
const { createLabel, deleteLabel } = await import('../crud.ts')
const { createStatus, deleteStatus } = await import('../../statuses/crud.ts')
const { updateWorkspacePermissions, permissionsConfigCache } = await import('../../agent/permissions-config.ts')
const { initLabelsStatusesImport } = await import('../import.ts')

let workspaceId = ''
let root = ''

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') })
  workspaceId = workspace.id
  root = workspace.rootPath
  initLabelsStatusesImport() // seeds the workspace like a boot does
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

const ws = () => ({ id: workspaceId, rootPath: root })
const headers = () => Object.fromEntries(listSessions(ws()).map((s) => [s.name, s]))
const changed: string[][] = []

describe('chats follow label and status deletes', () => {
  it('deleting a label (and its children) strips it, valued entries included, from the chats that carry it', async () => {
    createLabel(workspaceId, { name: 'Ops' })
    createLabel(workspaceId, { name: 'Oncall', parentId: 'ops', valueType: 'string' })
    onChatsChange((_workspace, ids) => changed.push(ids))
    const a = createSession(ws(), { name: 'a', createdBy: 'user:x', labels: ['ops', 'oncall::alice', 'bug'] })
    const b = createSession(ws(), { name: 'b', createdBy: 'user:x', labels: ['oncall::bob'] })
    createSession(ws(), { name: 'c', createdBy: 'user:x', labels: ['bug'] })

    expect(deleteLabel(workspaceId, 'ops')).toEqual({ stripped: 2 }) // the chats that carried any of them (a and b)
    expect(changed.at(-1)?.sort()).toEqual([a.id, b.id].sort()) // the session manager hears which

    const after = headers()
    expect(after.a!.labels).toEqual(['bug'])
    expect(after.b!.labels ?? []).toEqual([])
    expect(after.c!.labels).toEqual(['bug'])
  })

  it('deleting a status moves its chats to todo, and a chat of another status is left alone', async () => {
    createStatus(workspaceId, { label: 'Review Soon', category: 'open' })
    const d = createSession(ws(), { name: 'd', createdBy: 'user:x', sessionStatus: 'review-soon' })
    createSession(ws(), { name: 'e', createdBy: 'user:x', sessionStatus: 'needs-review' })
    expect(headers().d!.sessionStatus).toBe('review-soon') // the new status is valid for chats at once

    expect(deleteStatus(workspaceId, 'review-soon')).toEqual({ migrated: 1 })
    expect(changed.at(-1)).toEqual([d.id])

    const after = headers()
    expect(after.d!.sessionStatus).toBe('todo')
    expect(after.e!.sessionStatus).toBe('needs-review')
  })
})

describe('workspace permission rules', () => {
  it('are read by the agents through the cache and a write shows at once', () => {
    expect(permissionsConfigCache.getMergedConfig({ workspaceRootPath: root }).readOnlyBashPatterns.some((p) => p.source === '^deploy-check')).toBe(false)
    updateWorkspacePermissions(workspaceId, { allowedBashPatterns: ['^deploy-check'] })
    expect(permissionsConfigCache.getMergedConfig({ workspaceRootPath: root }).readOnlyBashPatterns.some((p) => p.source === '^deploy-check')).toBe(true)
    updateWorkspacePermissions(workspaceId, {})
    expect(permissionsConfigCache.getMergedConfig({ workspaceRootPath: root }).readOnlyBashPatterns.some((p) => p.source === '^deploy-check')).toBe(false)
  })

  it('refuse a regex that does not compile and an unknown field type', () => {
    expect(() => updateWorkspacePermissions(workspaceId, { allowedBashPatterns: ['('] })).toThrow()
    expect(() => updateWorkspacePermissions(workspaceId, { allowedBashPatterns: 'nope' })).toThrow()
  })
})
