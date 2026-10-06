import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-library-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { getLibraryItems, getLibraryItem, CHAT_ATTACHMENTS_FOLDER_TITLE, MAX_FILE_BYTES } = await import('@otto/shared/library')
const { registerLibraryHandlers } = await import('./library')
const { registerFilesHandlers } = await import('./files')
type Ctx = import('../../transport/types').RequestContext
type Handler = import('../../transport/types').HandlerFn
type Deps = import('../handler-deps').HandlerDeps

const handlers = new Map<string, Handler>()
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push() {},
  async invokeClient() {},
  hasClientCapability: () => false,
  findClientsWithCapability: () => [],
}
const deps = {
  sessionManager: {},
  oauthFlowStore: {},
  platform: {
    appRootPath: '/',
    resourcesPath: '/',
    isPackaged: false,
    appVersion: '0.0.0-test',
    isDebugMode: true,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    imageProcessor: {
      async getMetadata(input: Buffer) {
        const m = await sharp(input).metadata()
        return m.width && m.height ? { width: m.width, height: m.height } : null
      },
      async process(input: Buffer | string, opts: { resize?: { width: number; height: number } } = {}) {
        const pipeline = sharp(input)
        return (opts.resize ? pipeline.resize(opts.resize.width, opts.resize.height, { fit: 'inside' }) : pipeline).png().toBuffer()
      },
    },
  },
} as unknown as Deps

const USER_ID = 'abcdefghijkl'
const ME = `user:${USER_ID}`
let workspaceId = ''
let rootPath = ''
let ctx: Ctx
const call = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)
const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64')

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  rootPath = join(configDir, 'workspace')
  const workspace = addWorkspace({ name: 'Test', rootPath })
  workspaceId = workspace.id
  ctx = { clientId: 'c1', userId: USER_ID, workspaceId, webContentsId: null }
  registerLibraryHandlers(server, deps)
  registerFilesHandlers(server as never, deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

describe('library RPC', () => {
  it('uploads, lists, reads, updates, conflicts and deletes', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer()
    const image = await call(RPC_CHANNELS.library.CREATE, { title: 'pic.png', mime: 'image/png', content: { encoding: 'base64', data: b64(png) } })
    const doc = await call(RPC_CHANNELS.library.CREATE, { title: 'notes.md', mime: 'text/markdown', content: { encoding: 'utf8', data: '# One' } })
    const folder = await call(RPC_CHANNELS.library.CREATE_FOLDER, { title: 'Docs' })
    expect(image).toMatchObject({ type: 'file', size: png.length, createdBy: ME, folderId: null })
    expect(doc).toMatchObject({ type: 'document', size: 5 })

    expect((await call(RPC_CHANNELS.library.LIST)).map((item: { title: string }) => item.title)).toEqual(['Docs', 'notes.md', 'pic.png'])
    expect(await call(RPC_CHANNELS.library.LIST, { type: 'document' })).toEqual([doc])
    expect(await call(RPC_CHANNELS.library.GET, doc.id)).toEqual(doc)
    expect(await call(RPC_CHANNELS.library.GET, 'missing00000')).toBeNull()

    expect((await call(RPC_CHANNELS.library.READ, image.id)).content).toEqual({ encoding: 'base64', data: b64(png) })
    expect(await call(RPC_CHANNELS.library.READ, doc.id)).toEqual({ item: doc, content: { encoding: 'utf8', data: '# One' } })
    expect(readFileSync(join(rootPath, 'library', doc.id), 'utf8')).toBe('# One')

    const moved = await call(RPC_CHANNELS.library.UPDATE, doc.id, { title: 'plan.md', folderId: folder.id })
    expect(moved).toMatchObject({ title: 'plan.md', folderId: folder.id })
    await expect(
      call(RPC_CHANNELS.library.UPDATE, doc.id, { content: { encoding: 'utf8', data: 'stale' }, expectedUpdatedAt: doc.updatedAt }),
    ).rejects.toThrow('changed since it was loaded')
    expect((await call(RPC_CHANNELS.library.READ, doc.id)).content.data).toBe('# One')
    const saved = await call(RPC_CHANNELS.library.UPDATE, doc.id, {
      content: { encoding: 'utf8', data: '# Two' },
      expectedUpdatedAt: moved.updatedAt,
    })
    expect(saved.size).toBe(5)
    expect((await call(RPC_CHANNELS.library.READ, doc.id)).content.data).toBe('# Two')

    await expect(call(RPC_CHANNELS.library.DELETE, folder.id)).rejects.toThrow('not empty')
    await call(RPC_CHANNELS.library.DELETE, doc.id)
    await call(RPC_CHANNELS.library.DELETE, image.id)
    await call(RPC_CHANNELS.library.DELETE, folder.id)
    expect(await call(RPC_CHANNELS.library.LIST)).toEqual([])
  })

  it('refuses an oversized upload before decoding it and an empty one after', async () => {
    const huge = 'A'.repeat(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4)
    await expect(call(RPC_CHANNELS.library.CREATE, { title: 'big', mime: 'x/y', content: { encoding: 'base64', data: huge } })).rejects.toThrow('limited')
    await expect(call(RPC_CHANNELS.library.CREATE, { title: 'none', mime: 'x/y', content: { encoding: 'base64', data: '' } })).rejects.toThrow('empty')
  })

  it('needs a signed-in user to create, and never takes the actor from the client', async () => {
    const nobody = { ...ctx, userId: null }
    await expect((async () => handlers.get(RPC_CHANNELS.library.CREATE_FOLDER)!(nobody, { title: 'x' }))()).rejects.toThrow('Sign in')
    const folder = await call(RPC_CHANNELS.library.CREATE_FOLDER, { title: 'mine', createdBy: 'user:zzzzzzzzzzzz' })
    expect(folder.createdBy).toBe(ME)
    await call(RPC_CHANNELS.library.DELETE, folder.id)
  })

  it('needs a workspace that exists', async () => {
    const other = { ...ctx, workspaceId: 'no-such-workspace' }
    await expect((async () => handlers.get(RPC_CHANNELS.library.LIST)!(other))()).rejects.toThrow('Cannot determine workspace')
  })
})

describe('STORE_ATTACHMENT', () => {
  const store = (attachment: Record<string, unknown>) => call(RPC_CHANNELS.file.STORE_ATTACHMENT, attachment)
  const chatFolder = () => getLibraryItems(workspaceId, { folderId: null, type: 'folder' }).find((item) => item.title === CHAT_ATTACHMENTS_FOLDER_TITLE)

  it('keeps a chat image as a library item in the Chat attachments folder', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#08f' } }).png().toBuffer()
    const stored = await store({ type: 'image', path: '/tmp/x.png', name: 'shot.png', mimeType: 'image/png', base64: b64(png), size: png.length })

    expect(stored.id).toMatch(/^[0-9a-z]{12}$/)
    expect(stored.storedPath).toBe(join(rootPath, 'library', stored.id))
    expect(readFileSync(stored.storedPath).equals(png)).toBe(true)
    expect(stored.thumbnailBase64).toBeString()
    expect(stored).toMatchObject({ name: 'shot.png', size: png.length, wasResized: false })

    expect(getLibraryItem(workspaceId, stored.id)).toMatchObject({
      type: 'file',
      title: 'shot.png',
      mime: 'image/png',
      createdBy: ME,
      folderId: chatFolder()!.id,
    })
    expect(getLibraryItems(workspaceId, { folderId: null }).map((item) => item.id)).not.toContain(stored.id)
  })

  it('stores a text attachment and an office file with its markdown copy as two items', async () => {
    const text = await store({ type: 'text', path: '/tmp/a.txt', name: 'a.txt', mimeType: 'text/plain', text: 'hello', size: 5 })
    expect(readFileSync(text.storedPath, 'utf8')).toBe('hello')

    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p></w:body></w:document>')
    const docx = await zip.generateAsync({ type: 'nodebuffer' })
    const office = await store({
      type: 'office',
      path: '/tmp/plan.docx',
      name: 'plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64: b64(docx),
      size: docx.length,
    })
    expect(readFileSync(office.storedPath).equals(docx)).toBe(true)
    expect(readFileSync(office.markdownPath, 'utf8')).toContain('Quarterly plan')
    const markdown = getLibraryItems(workspaceId, { folderId: chatFolder()!.id }).find((item) => office.markdownPath.endsWith(item.id))
    expect(markdown).toMatchObject({ type: 'document', title: 'plan.docx.md', createdBy: ME })
    expect(getLibraryItems(workspaceId, { type: 'folder' }).filter((item) => item.title === CHAT_ATTACHMENTS_FOLDER_TITLE)).toHaveLength(1)
  })

  it('rejects empty and invalid attachments and leaves no item behind', async () => {
    const before = getLibraryItems(workspaceId, { folderId: chatFolder()!.id }).length
    await expect(store({ type: 'text', path: '/tmp/e', name: 'e.txt', mimeType: 'text/plain', text: '', size: 0 })).rejects.toThrow('empty')
    await expect(store({ type: 'image', path: '/tmp/b', name: 'b.png', mimeType: 'image/png', base64: b64('not an image'), size: 12 })).rejects.toThrow('Failed to store attachment')
    expect(getLibraryItems(workspaceId, { folderId: chatFolder()!.id }).length).toBe(before)
  })
})
