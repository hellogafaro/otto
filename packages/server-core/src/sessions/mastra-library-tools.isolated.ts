import { afterAll, beforeAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { z } from 'zod'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import {
  createLibraryFolder,
  createLibraryItem,
  getLibraryItem,
  getLibraryItems,
  MAX_FOLDER_DEPTH,
  readLibraryContent,
  readLibraryText,
  type LibraryItem,
} from '@otto/shared/library'
import { createMastraLibraryTools, MASTRA_LIBRARY_DESTRUCTIVE, MASTRA_LIBRARY_WRITES } from './mastra-library-tools'
import { runMastraSession } from './mastra-session'
import { closeMastraHistory } from './mastra-history'
import type { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider-v5'
import type { Session } from '@mastra/core/agent-controller'

let workspaceId: string, otherWorkspaceId: string
const agentId = crypto.randomUUID()
const humanId = crypto.randomUUID()
const text = (value: string) => new TextEncoder().encode(value)
let access = true, signedIn = true, accessChecks = 0
const tools = () => createMastraLibraryTools({
  workspaceId, agentId,
  assertAccess: () => { accessChecks++; if (!access) throw new Error('Access removed') },
  getUserId: () => signedIn ? humanId : '',
  assertChatAccess: () => { throw new Error('Library must not consult unrelated chat ownership') },
})
const call = async (name: keyof ReturnType<typeof tools>, input: unknown, context = {}): Promise<any> => {
  const tool = tools()[name]
  const parsed = (tool.inputSchema as z.ZodType).parse(input)
  return tool.execute!(parsed as never, context as never)
}
beforeAll(() => {
  expect(CONFIG_DIR).toContain('otto-test-')
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Library tool fixture', rootPath: join(CONFIG_DIR, 'library-fixture') }).id
  otherWorkspaceId = addWorkspace({ name: 'Foreign Library fixture', rootPath: join(CONFIG_DIR, 'other-library-fixture') }).id
})
afterAll(() => closeMastraHistory())

it('creates and manages the same document, file and folder artifacts without paths or binary payloads', async () => {
  const folder: LibraryItem = await call('library_create_folder', { title: 'Tool fixture folder' })
  const child: LibraryItem = await call('library_create_folder', { title: 'Inner folder', parentId: folder.id })
  const doc: LibraryItem = await call('library_create_document', { title: 'Tool fixture brief', content: '# Initial brief', parentId: child.id })
  const file = await createLibraryItem({ workspaceId, title: 'Tool fixture.pdf', mime: 'application/pdf', bytes: new Uint8Array([0, 1, 2, 3]), parentId: child.id, createdBy: `user:${humanId}` })
  expect(doc).toMatchObject({ type: 'document', parentId: child.id, createdBy: `agent:${agentId}` })
  expect(doc.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(await call('library_folder_path', { id: child.id })).toEqual({ folders: [folder, child] })
  expect(await call('library_read_document', { id: doc.id })).toEqual({ item: doc, content: '# Initial brief' })
  expect((await call('library_list', { parentId: child.id })).items).toHaveLength(2)
  expect((await call('library_list', { parentId: child.id, type: 'file', createdBy: `user:${humanId}` })).items).toEqual([file])
  expect((await call('library_search', { query: 'Tool fixture' })).items.map((entry: LibraryItem) => entry.id)).toContain(doc.id)
  const page = await call('library_list', { parentId: child.id, limit: 1 })
  expect(page).toMatchObject({ total: 2, nextOffset: 1 })
  expect((await call('library_list', { parentId: child.id, limit: 1, offset: 1 })).nextOffset).toBeNull()
  const count = getLibraryItems(workspaceId).length
  const updated: LibraryItem = await call('library_update_item', { id: doc.id, title: 'Revised fixture brief', content: '# Updated brief', parentId: folder.id, expectedUpdatedAt: doc.updatedAt })
  expect(updated).toMatchObject({ id: doc.id, parentId: folder.id, title: 'Revised fixture brief' })
  expect(updated.updatedAt).toBeGreaterThan(doc.updatedAt)
  expect(await readLibraryText(workspaceId, doc.id)).toBe('# Updated brief')
  const movedFile: LibraryItem = await call('library_update_item', { id: file.id, title: 'Renamed fixture.pdf', parentId: null, expectedUpdatedAt: file.updatedAt })
  expect(movedFile).toMatchObject({ id: file.id, parentId: null, type: 'file', size: 4 })
  expect(await readLibraryContent(workspaceId, file.id)).toEqual(new Uint8Array([0, 1, 2, 3]))
  expect(getLibraryItems(workspaceId)).toHaveLength(count)
  const metadata = await call('library_get_item', { id: file.id })
  expect(metadata).toEqual(movedFile)
  expect(JSON.stringify(metadata)).not.toMatch(/base64|rootPath|\/Users\/|file:\/\/|https?:\/\//)
  await expect(call('library_read_document', { id: file.id })).rejects.toThrow('invalid')
  await expect(call('library_read_document', { id: folder.id })).rejects.toThrow('invalid')
  await expect(call('library_update_item', { id: file.id, expectedUpdatedAt: movedFile.updatedAt, content: 'Not binary replacement' })).rejects.toThrow('invalid')
  await expect(call('library_delete_item', { id: folder.id, expectedUpdatedAt: folder.updatedAt })).rejects.toThrow('not_empty')
  expect(await call('library_delete_item', { id: file.id, expectedUpdatedAt: movedFile.updatedAt })).toEqual({ deletedId: file.id })
  expect(getLibraryItem(workspaceId, file.id)).toBeUndefined()
  await expect(readLibraryContent(workspaceId, file.id)).rejects.toThrow()
  await call('library_delete_item', { id: doc.id, expectedUpdatedAt: updated.updatedAt })
  await call('library_delete_item', { id: child.id, expectedUpdatedAt: child.updatedAt })
  await call('library_delete_item', { id: folder.id, expectedUpdatedAt: folder.updatedAt })
})

it('rejects cross-workspace items, parents, versions and deletion without touching foreign artifacts', async () => {
  const foreignFolder = createLibraryFolder({ workspaceId: otherWorkspaceId, title: 'Foreign private folder', createdBy: `user:${humanId}` })
  const foreign = await createLibraryItem({ workspaceId: otherWorkspaceId, title: 'Foreign private document', mime: 'text/markdown', bytes: text('foreign private text'), parentId: foreignFolder.id, createdBy: `user:${humanId}` })
  const local: LibraryItem = await call('library_create_document', { title: 'Local boundary fixture', content: 'local text' })
  for (const [name, args] of [
    ['library_get_item', { id: foreign.id }],
    ['library_read_document', { id: foreign.id }],
    ['library_folder_path', { id: foreignFolder.id }],
    ['library_list', { parentId: foreignFolder.id }],
    ['library_create_document', { title: 'Refused', content: 'refused', parentId: foreignFolder.id }],
    ['library_create_folder', { title: 'Refused', parentId: foreignFolder.id }],
    ['library_update_item', { id: local.id, parentId: foreignFolder.id, expectedUpdatedAt: local.updatedAt }],
    ['library_update_item', { id: foreign.id, content: 'stolen', expectedUpdatedAt: foreign.updatedAt }],
    ['library_update_item', { id: foreignFolder.id, title: 'stolen', expectedUpdatedAt: foreignFolder.updatedAt }],
    ['library_delete_item', { id: foreign.id, expectedUpdatedAt: foreign.updatedAt }],
    ['library_delete_item', { id: foreignFolder.id, expectedUpdatedAt: foreignFolder.updatedAt }],
  ] as const) await expect(call(name, args)).rejects.toThrow('not_found')
  expect((await call('library_search', { query: 'Foreign private' })).items).toEqual([])
  expect((await call('library_list', {})).items.map((entry: LibraryItem) => entry.id)).not.toContain(foreign.id)
  expect(getLibraryItem(otherWorkspaceId, foreign.id)).toEqual(foreign)
  expect(getLibraryItem(otherWorkspaceId, foreignFolder.id)).toEqual(foreignFolder)
  expect(await readLibraryText(otherWorkspaceId, foreign.id)).toBe('foreign private text')
  expect(getLibraryItem(workspaceId, local.id)).toEqual(local)
  await call('library_delete_item', { id: local.id, expectedUpdatedAt: local.updatedAt })
})

it('guards all edits and deletion with a version and preserves the winner of concurrent text saves', async () => {
  const doc: LibraryItem = await call('library_create_document', { title: 'Version fixture', content: 'initial' })
  const changed: LibraryItem = await call('library_update_item', { id: doc.id, title: 'Current fixture', expectedUpdatedAt: doc.updatedAt })
  for (const patch of [{ title: 'stale' }, { parentId: null }, { content: 'stale' }]) {
    await expect(call('library_update_item', { id: doc.id, expectedUpdatedAt: doc.updatedAt, ...patch })).rejects.toThrow('conflict')
  }
  await expect(call('library_delete_item', { id: doc.id, expectedUpdatedAt: doc.updatedAt })).rejects.toThrow('conflict')
  const outcomes = await Promise.allSettled(['winner one', 'winner two'].map((value) => call('library_update_item', { id: doc.id, content: value, expectedUpdatedAt: changed.updatedAt })))
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
  const current = getLibraryItem(workspaceId, doc.id)!
  expect(current.id).toBe(doc.id)
  expect(['winner one', 'winner two']).toContain(await readLibraryText(workspaceId, doc.id))
  expect(current.updatedAt).toBeGreaterThan(changed.updatedAt)
  await call('library_delete_item', { id: doc.id, expectedUpdatedAt: current.updatedAt })
})

it('retains folder depth, type, cycle and nonempty deletion validation', async () => {
  const chain: LibraryItem[] = []
  for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth++) chain.push(await call('library_create_folder', { title: `Depth ${depth + 1}`, parentId: chain.at(-1)?.id }))
  await expect(call('library_create_folder', { title: 'Too deep', parentId: chain.at(-1)!.id })).rejects.toThrow('invalid')
  await expect(call('library_update_item', { id: chain[0]!.id, parentId: chain.at(-1)!.id, expectedUpdatedAt: chain[0]!.updatedAt })).rejects.toThrow('invalid')
  await expect(call('library_update_item', { id: chain[0]!.id, parentId: chain[0]!.id, expectedUpdatedAt: chain[0]!.updatedAt })).rejects.toThrow('invalid')
  const doc: LibraryItem = await call('library_create_document', { title: 'Parent type fixture', content: 'text' })
  await expect(call('library_create_folder', { title: 'Bad parent', parentId: doc.id })).rejects.toThrow('invalid')
  await expect(call('library_list', { parentId: doc.id })).rejects.toThrow('invalid')
  await expect(call('library_folder_path', { id: doc.id })).rejects.toThrow('invalid')
  await expect(call('library_delete_item', { id: chain[0]!.id, expectedUpdatedAt: chain[0]!.updatedAt })).rejects.toThrow('not_empty')
  for (const entry of chain.reverse()) await call('library_delete_item', { id: entry.id, expectedUpdatedAt: entry.updatedAt })
  await call('library_delete_item', { id: doc.id, expectedUpdatedAt: doc.updatedAt })
})

it('bounds UTF-8 input, document reads, metadata results and strict schemas', async () => {
  const oversized = await createLibraryItem({ workspaceId, title: 'Large fixture', mime: 'text/markdown', bytes: text('a'.repeat(65537)), createdBy: `user:${humanId}` })
  await expect(call('library_read_document', { id: oversized.id })).rejects.toThrow('too_large')
  const hugeTitle = createLibraryFolder({ workspaceId, title: 'b'.repeat(65537), createdBy: `user:${humanId}` })
  await expect(call('library_get_item', { id: hugeTitle.id })).rejects.toThrow('too_large')
  const malformed = await createLibraryItem({ workspaceId, title: 'Invalid UTF-8 fixture', mime: 'text/markdown', bytes: new Uint8Array([255]), createdBy: `user:${humanId}` })
  await expect(call('library_read_document', { id: malformed.id })).rejects.toThrow('Library action could not complete.')
  const aborted = new AbortController()
  aborted.abort()
  await expect(call('library_read_document', { id: malformed.id }, { abortSignal: aborted.signal })).rejects.toThrow('Library action could not complete.')
  await expect(call('library_create_document', { title: 'Refused bytes', content: 'é'.repeat(32769) })).rejects.toThrow('64 KiB')
  await expect(call('library_create_document', { title: 'Empty', content: '' })).rejects.toThrow()
  await expect(call('library_list', { limit: 101 })).rejects.toThrow()
  await expect(call('library_update_item', { id: oversized.id, expectedUpdatedAt: oversized.updatedAt })).rejects.toThrow('At least one change')
  for (const badId of ['../../private', '/Users/private', 'https://example.test/file', '00000000-0000-1000-8000-000000000000']) await expect(call('library_get_item', { id: badId })).rejects.toThrow('Invalid stored Library ID')
  for (const extra of [{ workspaceId: otherWorkspaceId }, { path: '/private' }, { createdBy: `user:${humanId}` }, { chatId: crypto.randomUUID() }]) await expect(call('library_create_document', { title: 'Refused extra', content: 'text', ...extra })).rejects.toThrow()
  await expect(call('library_get_item', { id: 'legacyabcdef' })).rejects.toThrow('not_found')
  await call('library_delete_item', { id: oversized.id, expectedUpdatedAt: oversized.updatedAt })
  await call('library_delete_item', { id: hugeTitle.id, expectedUpdatedAt: hugeTitle.updatedAt })
  await call('library_delete_item', { id: malformed.id, expectedUpdatedAt: malformed.updatedAt })
})

it('rechecks current creator and access for every invocation and after asynchronous work', async () => {
  accessChecks = 0
  const doc: LibraryItem = await call('library_create_document', { title: 'Revocation fixture', content: 'text' })
  expect(accessChecks).toBeGreaterThanOrEqual(2)
  access = false
  await expect(call('library_read_document', { id: doc.id })).rejects.toThrow('Access removed')
  await expect(call('library_delete_item', { id: doc.id, expectedUpdatedAt: doc.updatedAt })).rejects.toThrow('Access removed')
  access = true
  signedIn = false
  await expect(call('library_list', {})).rejects.toThrow('signed-in creator')
  signedIn = true
  const revoked = createMastraLibraryTools({ workspaceId, agentId, getUserId: () => humanId, assertChatAccess: () => {}, assertAccess: () => { if (++accessChecks >= 2) throw new Error('Access revoked during read') } })
  accessChecks = 0
  await expect(revoked.library_read_document.execute!({ id: doc.id }, {} as never)).rejects.toThrow('Access revoked during read')
  expect(getLibraryItem(workspaceId, doc.id)).toEqual(doc)
  await call('library_delete_item', { id: doc.id, expectedUpdatedAt: doc.updatedAt })
})

it('exports every write and destructive name and marks deletion for native explicit approval', () => {
  expect([...MASTRA_LIBRARY_WRITES]).toEqual(['library_create_document', 'library_create_folder', 'library_update_item', 'library_delete_item'])
  expect([...MASTRA_LIBRARY_DESTRUCTIVE]).toEqual(['library_delete_item'])
  expect(tools().library_delete_item.requireApproval).toBe(true)
  expect(Object.keys(tools()).every((name) => name.startsWith('library_'))).toBe(true)
})

it('native destructive policy always asks while other tools are allowed; denial preserves and approval deletes', async () => {
  const doc: LibraryItem = await call('library_create_document', { title: 'Native deletion fixture', content: 'retained until approval' })
  let approvals = 0
  for (const decision of ['decline', 'approve'] as const) {
    let native: Session | undefined, calls = 0
    const model: LanguageModelV2 = {
      specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
      doGenerate: async () => { throw new Error('stream only') },
      doStream: async () => {
        const parts: LanguageModelV2StreamPart[] = calls++ === 0 ? [
          { type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: 'library_delete_item', input: JSON.stringify({ id: doc.id, expectedUpdatedAt: doc.updatedAt }) },
          { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ] : [
          { type: 'text-start', id: 'done' }, { type: 'text-delta', id: 'done', delta: 'Approval result checked.' }, { type: 'text-end', id: 'done' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ]
        return { stream: new ReadableStream({ start(controller) { controller.enqueue({ type: 'stream-start', warnings: [] }); for (const part of parts) controller.enqueue(part); controller.close() } }) }
      },
    }
    await runMastraSession({
      chatId: crypto.randomUUID(), workspaceId, ownerId: humanId, agentId, name: 'Fixture agent', instructions: 'Use the requested Library deletion tool.',
      messages: [{ role: 'user', content: 'Request approval to delete the fixture.' }], model, tools: tools(),
      signal: AbortSignal.timeout(15000), assertAccess: () => {}, policy: (name) => MASTRA_LIBRARY_DESTRUCTIVE.has(name) ? 'ask' : 'allow',
      onReady: (session) => { native = session },
      onApproval: (id, name, args) => {
        approvals++
        expect(name).toBe('library_delete_item')
        expect(args).toMatchObject({ id: doc.id, expectedUpdatedAt: doc.updatedAt })
        expect(getLibraryItem(workspaceId, doc.id)).toEqual(doc)
        void native!.respondToToolApproval({ toolCallId: id, decision })
      },
      emit: async () => {},
    })
    if (decision === 'decline') expect(getLibraryItem(workspaceId, doc.id)).toEqual(doc)
    else expect(getLibraryItem(workspaceId, doc.id)).toBeUndefined()
  }
  expect(approvals).toBe(2)
})
