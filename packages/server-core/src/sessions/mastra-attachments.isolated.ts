import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import sharp from 'sharp'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createLibraryItem, deleteLibraryItem, getLibraryConversion, getLibraryItem, getLibraryStore, readLibraryContent, updateLibraryItem } from '@otto/shared/library'
import type { StoredAttachment } from '@otto/core/types'
import { loadMastraAttachmentFiles, resolveMastraAttachmentReferences } from './mastra-attachments'
import { runMastraSession } from './mastra-session'
import { closeMastraHistory } from './mastra-history'
import { createMastraChatModel } from './mastra-chat'
import { initSchema } from '@otto/shared/db/init-schema'
import { registerFilesHandlers } from '../handlers/rpc/files'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '../transport'
import type { HandlerDeps } from '../handlers/handler-deps'

afterAll(() => closeMastraHistory())
const bytes = (value: string) => new TextEncoder().encode(value)
function pdf(pages = 1) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>')]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = result.length
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return bytes(result)
}

it('uses original Library IDs and verified Office derivatives, bounds files and refuses foreign/stale/deleted refs', async () => {
  await initSchema()
  expect(Object.keys(Array.prototype)).not.toContain('random')
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Attachments', rootPath: join(CONFIG_DIR, 'attachment-workspace') })
  const other = addWorkspace({ name: 'Foreign', rootPath: join(CONFIG_DIR, 'foreign-attachment-workspace') })
  const actor = 'user:anaaaaaaaaaa'
  const make = (title: string, mime: string, content: Uint8Array, workspaceId = workspace.id) => createLibraryItem({ workspaceId, title, mime, bytes: content, createdBy: actor })
  const text = await make('notes.txt', 'text/plain', bytes('ATTACHMENT_TEXT_BODY'))
  const image = await make('picture.png', 'image/png', await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } }).png().toBuffer())
  const document = await make('brief.pdf', 'application/pdf', pdf())
  const original = await make('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes('stored original office fixture'))
  const derivative = await createLibraryItem({ workspaceId: workspace.id, title: 'brief.docx.md', mime: 'text/markdown', bytes: bytes('OFFICE_DERIVATIVE_BODY'), createdBy: actor, conversionOf: { id: original.id, updatedAt: original.updatedAt } })
  const ref = (id: string, patch: Partial<StoredAttachment> = {}) => ({ id, type: 'unknown', name: 'forged name', mimeType: 'wrong/type', size: 1, storedPath: '/private/arbitrary-host-path', markdownPath: '/private/unrelated.md', ...patch }) as StoredAttachment
  const abort = new AbortController()
  let access = true
  const input = { workspaceId: workspace.id, signal: abort.signal, assertAccess: () => { abort.signal.throwIfAborted(); if (!access) throw new Error('Access removed') }, supportsImages: true }
  const load = (attachments: StoredAttachment[], budget = { bytes: 0, tokens: 0 }) => loadMastraAttachmentFiles({ ...input, attachments, budget })
  const refs = resolveMastraAttachmentReferences(workspace.id, [ref(text.id), ref(image.id), ref(document.id), ref(original.id)])
  expect(refs.map((item) => item.type)).toEqual(['text', 'image', 'pdf', 'office'])
  expect(refs[3]!.markdownId).toBe(derivative.id)
  expect(JSON.stringify(refs)).not.toContain('/private')
  const files = await load(refs)
  expect(files[0]!.data).toBe('ATTACHMENT_TEXT_BODY')
  expect(files[1]!.data).toStartWith('data:image/png;base64,')
  expect(files[2]!.data).toStartWith('data:application/pdf;base64,')
  expect(files[3]!.data).toBe('OFFICE_DERIVATIVE_BODY')
  await expect(load([ref(original.id, { markdownId: text.id })])).rejects.toThrow('unrelated')
  const foreign = await make('foreign.txt', 'text/plain', bytes('FOREIGN_CONTENT'), other.id)
  await expect(load([ref(foreign.id)])).rejects.toThrow('unavailable')
  await expect(load([ref(crypto.randomUUID())])).rejects.toThrow('unavailable')
  const invalid = await make('invalid.png', 'image/png', bytes('not an image'))
  await expect(load([ref(invalid.id)])).rejects.toThrow()
  const manyPages = await make('many.pdf', 'application/pdf', pdf(5))
  await expect(load([ref(manyPages.id)])).rejects.toThrow('four pages')
  const large = await make('large.txt', 'text/plain', new Uint8Array(32769).fill(65))
  await expect(load([ref(large.id)])).rejects.toThrow('input limit')
  const retainedBudget = { bytes: 0, tokens: 32760 }
  await expect(load([ref(text.id)], retainedBudget)).rejects.toThrow('allowance')
  expect(retainedBudget).toEqual({ bytes: 0, tokens: 32760 })
  const small = await make('small.txt', 'text/plain', bytes('small'))
  expect((await load([ref(small.id)], retainedBudget))[0]!.data).toBe('small')
  await expect(loadMastraAttachmentFiles({ ...input, supportsImages: false, attachments: [ref(image.id)], budget: { bytes: 0, tokens: 0 } })).rejects.toThrow('selected model')
  access = false
  await expect(load([ref(text.id)])).rejects.toThrow('Access removed')
  access = true
  await updateLibraryItem(workspace.id, derivative.id, { content: bytes('Direct editor still works'), expectedUpdatedAt: derivative.updatedAt })
  expect(getLibraryConversion(workspace.id, original.id)).toBeUndefined()
  expect(new TextDecoder().decode(await readLibraryContent(workspace.id, derivative.id))).toBe('Direct editor still works')
  await expect(load([ref(original.id)])).rejects.toThrow('Reattach')
  const replacement = await createLibraryItem({ workspaceId: workspace.id, title: 'new conversion.md', mime: 'text/markdown', bytes: bytes('conversion'), createdBy: actor, conversionOf: { id: original.id, updatedAt: original.updatedAt } })
  await updateLibraryItem(workspace.id, original.id, { content: bytes('changed original'), expectedUpdatedAt: original.updatedAt })
  expect(getLibraryConversion(workspace.id, original.id)).toBeUndefined()
  await expect(load([ref(original.id, { markdownId: replacement.id })])).rejects.toThrow('changed')
  await deleteLibraryItem(workspace.id, original.id)
  await expect(load([ref(original.id)])).rejects.toThrow('unavailable')
  await getLibraryStore(workspace.rootPath, workspace.id).delete(text.id)
  await expect(load([ref(text.id)])).rejects.toThrow('content is missing')
  abort.abort()
  await expect(load([ref(image.id)])).rejects.toThrow()
  expect(getLibraryItem(workspace.id, image.id)).toBeDefined()
})

it('passes inline files through actual Session/OpenAI Responses and replays historical image/PDF/text input without host URLs', async () => {
  const requests: Record<string, unknown>[] = []
  const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    requests.push(await request.json() as Record<string, unknown>)
    const parts = [
      { type: 'response.created', response: { id: 'response-fixture', created_at: 0, model: 'fixture' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-fixture' } },
      { type: 'response.output_text.delta', item_id: 'message-fixture', delta: 'Attachment response' },
      { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } } },
    ]
    return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const files = [
      { data: 'TEXT_REPLAY_BODY', mediaType: 'text/plain', filename: 'notes.txt' },
      { data: `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).png().toBuffer()).toString('base64')}`, mediaType: 'image/png', filename: 'pic.png' },
      { data: `data:application/pdf;base64,${Buffer.from(pdf()).toString('base64')}`, mediaType: 'application/pdf', filename: 'brief.pdf' },
    ]
    const run = (history: boolean) => runMastraSession({ chatId: crypto.randomUUID(), workspaceId: 'fixture-scope', ownerId: 'fixture-owner', agentId: 'fixture-agent', name: 'Scout', instructions: 'Read attached reference data.', messages: [{ role: 'user', content: 'Inspect files.' }], files: history ? undefined : files,
      history: history ? async () => [{ role: 'user', content: 'Prior files', files }] : undefined,
      model: createMastraChatModel({ provider: 'openai', model: 'pi/fixture', apiKey: 'controlled-model-key', baseUrl: endpoint.url.href + 'v1' }), tools: {}, signal: new AbortController().signal, assertAccess: () => {}, policy: () => 'allow', onReady: () => {}, onApproval: () => {}, emit: async () => {} })
    await run(false)
    await run(true)
    for (const body of requests) {
      const serialized = JSON.stringify(body)
      expect(serialized).toContain('TEXT_REPLAY_BODY')
      expect(serialized).toContain('input_image')
      expect(serialized).toContain('input_file')
      expect(serialized).toContain('data:application/pdf;base64,')
      expect(serialized).not.toContain('/private/')
      expect(serialized).not.toContain('file_url')
      expect(body.store).toBe(false)
    }
    expect(requests.length).toBe(2)
  } finally { endpoint.stop(true) }
})

it('existing upload handler binds a real Office conversion without replacing the original blob', async () => {
  const workspace = addWorkspace({ name: 'Office upload', rootPath: join(CONFIG_DIR, 'office-upload') })
  const handlers = new Map<string, HandlerFn>()
  const server = { handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer
  registerFilesHandlers(server, { platform: { logger: console, imageProcessor: { process: async () => { throw new Error('not an image') } } } } as unknown as HandlerDeps)
  const base64 = 'UEsDBBQAAAAIAMwWSF3mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACADMFkhdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgAzBZIXUWf2J6nAAAA0wAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEXOTQ6CMBAF4Ks0HICiCxeEnyhIYmKCGxeuSC0FmrSdZlpEby/FhZtvMnmZl8nKt1bkJdBJMHm0i5OoLLIl7YHPWhhP1ti4dMmjyXubUur4JDRzMVhh1mwA1MyvK450AewtAhfOSTNqRfdJcqCaSROFyif0nzBtAAO+aJvmUp27++3aHuvu1NaPlFRgPIJSoieKzYZP5IlSDHFGw0UQN+3mr5X+Py6+UEsBAhQDFAAAAAgAzBZIXeZ1xH7SAAAAiwEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADMFkhdXzOVUpUAAAAHAQAACwAAAAAAAAAAAAAAgAEDAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADMFkhdRZ/YnqcAAADTAAAAEQAAAAAAAAAAAAAAgAHBAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAlwIAAAAA'
  const original = Buffer.from(base64, 'base64')
  const ctx = { clientId: 'fixture', workspaceId: workspace.id, userId: 'anaaaaaaaaaa', webContentsId: null } as RequestContext
  const stored = await handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)!(ctx, { type: 'office', name: 'brief.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64, size: original.length, path: '/untrusted/ignored.docx' }) as StoredAttachment
  expect(stored.markdownId).toBeDefined()
  expect(getLibraryConversion(workspace.id, stored.id)?.id).toBe(stored.markdownId)
  expect(await readLibraryContent(workspace.id, stored.id)).toEqual(new Uint8Array(original))
  const files = await loadMastraAttachmentFiles({ workspaceId: workspace.id, attachments: [stored], signal: new AbortController().signal, assertAccess: () => {}, supportsImages: true, budget: { bytes: 0, tokens: 0 } })
  expect(files[0]!.data).toContain('Controlled launch brief.')
})

it('native image upload preserves original WebP bytes/MIME rather than re-encoding a large original', async () => {
  const previous = process.env.OTTO_MASTRA_CHAT
  process.env.OTTO_MASTRA_CHAT = '1'
  try {
    const workspace = addWorkspace({ name: 'Image upload', rootPath: join(CONFIG_DIR, 'image-upload') })
    const handlers = new Map<string, HandlerFn>()
    const server = { handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer
    registerFilesHandlers(server, { platform: { logger: console, imageProcessor: {
      getMetadata: async (buffer: Buffer) => { const meta = await sharp(buffer).metadata(); return { width: meta.width, height: meta.height } },
      process: async (buffer: Buffer) => sharp(buffer).resize(200, 200).png().toBuffer(),
    } } } as unknown as HandlerDeps)
    const original = await sharp({ create: { width: 8500, height: 2, channels: 3, background: '#ff0000' } }).webp().toBuffer()
    const ctx = { clientId: 'fixture', workspaceId: workspace.id, userId: 'anaaaaaaaaaa', webContentsId: null } as RequestContext
    const stored = await handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)!(ctx, { type: 'image', name: 'large.webp', mimeType: 'image/webp', base64: original.toString('base64'), size: original.length, path: '/untrusted/ignored.webp' }) as StoredAttachment
    expect(await readLibraryContent(workspace.id, stored.id)).toEqual(new Uint8Array(original))
    expect(getLibraryItem(workspace.id, stored.id)?.mime).toBe('image/webp')
    expect(stored.wasResized).toBe(false)
    await expect(loadMastraAttachmentFiles({ workspaceId: workspace.id, attachments: [stored], signal: new AbortController().signal, assertAccess: () => {}, supportsImages: true, budget: { bytes: 0, tokens: 0 } })).rejects.toThrow('2048')
  } finally { if (previous === undefined) delete process.env.OTTO_MASTRA_CHAT; else process.env.OTTO_MASTRA_CHAT = previous }
})
