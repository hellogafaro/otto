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

/** The header rewrites run in the background (as the old code did); listing meanwhile would clean up their temp files. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 300))
const headers = () => Object.fromEntries(listSessions(root).map((s) => [s.name, s]))

describe('chat headers keep resolving through the old path', () => {
  it('deleting a label (and its children) strips it, valued entries included, from the chats that carry it', async () => {
    createLabel(workspaceId, { name: 'Ops' })
    createLabel(workspaceId, { name: 'Oncall', parentId: 'ops', valueType: 'string' })
    await createSession(root, { name: 'a', labels: ['ops', 'oncall::alice', 'bug'] })
    await createSession(root, { name: 'b', labels: ['oncall::bob'] })
    await createSession(root, { name: 'c', labels: ['bug'] })

    expect(deleteLabel(workspaceId, 'ops')).toEqual({ stripped: 2 }) // one update per chat that carried any of them (a and b)
    await settled()

    const after = headers()
    expect(after.a!.labels).toEqual(['bug'])
    expect(after.b!.labels).toEqual([])
    expect(after.c!.labels).toEqual(['bug'])
  })

  it('deleting a status moves its chats to todo, and a chat of another status is left alone', async () => {
    createStatus(workspaceId, { label: 'Review Soon', category: 'open' })
    await createSession(root, { name: 'd', sessionStatus: 'review-soon' })
    await createSession(root, { name: 'e', sessionStatus: 'needs-review' })
    expect(headers().d!.sessionStatus).toBe('review-soon') // the new status is valid for chats at once

    expect(deleteStatus(workspaceId, 'review-soon')).toEqual({ migrated: 1 })
    await settled()

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
