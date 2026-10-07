import { afterEach, describe, expect, test } from 'bun:test'
import { createAgentSession, createExtensionRuntime, SessionManager, SettingsManager, type ModelRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent'
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initFileStorage } from '../../library/storage.ts'
import { startS3Double, type S3Double } from '../../library/__tests__/s3-double.ts'
import { deletePiSession, restorePiSession, uploadPiSession } from '../pi-session-sync.ts'

// Pi's own session file is stored like a chat file and comes back on a node whose disk lost it. Runs real Pi
// sessions (SessionManager.continueRecent, as pi-agent-server does) on an offline model: it answers "ok" and
// records the messages it was sent, so a restored file shows as earlier turns in the next request's context.

const MODEL: Model<'openai-responses'> = {
  id: 'offline', name: 'Offline', provider: 'openai', api: 'openai-responses', baseUrl: 'https://invalid.test',
  reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 4_096,
}
const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

const modelRuntime = { hasConfiguredAuth: () => true, getModel: () => MODEL, getAvailableSnapshot: () => [MODEL], streamSimple: () => { throw new Error('offline') } } as unknown as ModelRuntime
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => 'test',
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
}

/** One turn in a chat folder (`agentId`: another agent's own session, as pi-agent-server keeps it); returns what the model was sent (all earlier turns included). */
async function runTurn(sessionDir: string, cwd: string, prompt: string, agentId?: string): Promise<string> {
  const piDir = agentId ? join(sessionDir, '.pi-sessions', agentId) : join(sessionDir, '.pi-sessions')
  mkdirSync(piDir, { recursive: true })
  const { session } = await createAgentSession({
    cwd, model: MODEL, modelRuntime, resourceLoader, tools: [],
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    sessionManager: SessionManager.continueRecent(cwd, piDir),
  })
  let seen = ''
  session.agent.streamFunction = (_model, context) => {
    seen = JSON.stringify(context.messages)
    const stream = createAssistantMessageEventStream()
    const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'ok' }], provider: MODEL.provider, api: MODEL.api, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop', usage: USAGE }
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: { ...message, content: [] } })
      stream.push({ type: 'done', reason: 'stop', message })
    })
    return stream
  }
  try {
    await session.prompt(prompt)
  } finally {
    session.dispose()
  }
  return seen
}

const cleanups: (() => void)[] = []
afterEach(() => {
  initFileStorage({})
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function setup() {
  const double: S3Double = startS3Double()
  cleanups.push(() => double.stop())
  initFileStorage({ OTTO_STORAGE: 's3', OTTO_S3_ENDPOINT: double.url, OTTO_S3_BUCKET: double.bucket, OTTO_S3_REGION: 'r', OTTO_S3_ACCESS_KEY_ID: double.accessKeyId, OTTO_S3_SECRET_ACCESS_KEY: 'secret' })
  const node = (name: string) => {
    const root = mkdtempSync(join(tmpdir(), `otto-pi-${name}-`))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    return { workspace: { id: 'ws1', rootPath: root }, dir: join(root, 'sessions', 'chat1'), cwd: join(root, 'sessions', 'chat1') }
  }
  return { double, node, objectKey: 'workspaces/ws1/chats/chat1/session.jsonl' }
}

const piFile = (dir: string) => {
  const name = readdirSync(join(dir, '.pi-sessions')).find((n) => n.endsWith('.jsonl'))!
  return join(dir, '.pi-sessions', name)
}

describe('Pi session durability', () => {
  test('a settled turn uploads the file; unchanged bytes are not uploaded again', async () => {
    const { double, node, objectKey } = setup()
    const a = node('a')
    await runTurn(a.dir, a.cwd, 'first question')
    const ref = await uploadPiSession(a.workspace, 'chat1', a.dir)
    expect(ref?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(new TextDecoder().decode(double.objects.get(objectKey)?.bytes)).toBe(await Bun.file(piFile(a.dir)).text())

    const puts = () => double.requests.filter((r) => r.startsWith('PUT ')).length
    const before = puts()
    expect(await uploadPiSession(a.workspace, 'chat1', a.dir, ref)).toBeUndefined()
    expect(puts()).toBe(before)

    await runTurn(a.dir, a.cwd, 'second question')
    const next = await uploadPiSession(a.workspace, 'chat1', a.dir, ref)
    expect(next && next.hash !== ref!.hash).toBe(true)
    expect(puts()).toBe(before + 1)
  })

  test('a fresh disk restores the file and the next turn sees the same context', async () => {
    const { node } = setup()
    const a = node('a')
    await runTurn(a.dir, a.cwd, 'remember the number 7319')
    const ref = await uploadPiSession(a.workspace, 'chat1', a.dir)

    const b = node('b') // another node: nothing on its disk, another working directory
    expect(await restorePiSession(b.workspace, 'chat1', b.dir, b.cwd, ref)).toBe(true)
    const seen = await runTurn(b.dir, b.cwd, 'what number?')
    expect(seen).toContain('remember the number 7319')
    expect(readdirSync(join(b.dir, '.pi-sessions')).filter((n) => n.endsWith('.jsonl'))).toHaveLength(1)

    // same chat on a disk that never had the file and no ref (the row lost its metadata): the object is still found
    const c = node('c')
    expect(await restorePiSession(c.workspace, 'chat1', c.dir, c.cwd)).toBe(true)
  })

  test('an older local file is replaced; a newer one (failed upload) and an equal one are kept', async () => {
    const { double, node } = setup()
    const a = node('a')
    await runTurn(a.dir, a.cwd, 'turn one')
    const first = await uploadPiSession(a.workspace, 'chat1', a.dir)

    const b = node('b')
    await restorePiSession(b.workspace, 'chat1', b.dir, a.cwd, first)
    const old = Date.now() / 1000 - 3600
    utimesSync(piFile(b.dir), old, old)

    await runTurn(a.dir, a.cwd, 'turn two')
    const second = await uploadPiSession(a.workspace, 'chat1', a.dir, first)
    expect(await restorePiSession(b.workspace, 'chat1', b.dir, a.cwd, second)).toBe(true)
    expect(await Bun.file(piFile(b.dir)).text()).toBe(await Bun.file(piFile(a.dir)).text())

    const gets = () => double.requests.filter((r) => r.startsWith('GET chats') || r.includes('pi-session')).length
    const before = gets()
    expect(await restorePiSession(b.workspace, 'chat1', b.dir, a.cwd, second)).toBe(false) // equal: no download
    expect(gets()).toBe(before)

    await Bun.sleep(20) // file times are coarser than Date.now()
    await runTurn(b.dir, a.cwd, 'turn three on b, upload failed')
    const local = await Bun.file(piFile(b.dir)).text()
    expect(await restorePiSession(b.workspace, 'chat1', b.dir, a.cwd, second)).toBe(false) // newer than the upload
    expect(await Bun.file(piFile(b.dir)).text()).toBe(local)
  })

  test('deleting removes the object; a failed upload throws and leaves the stored object', async () => {
    const { double, node, objectKey } = setup()
    const a = node('a')
    await runTurn(a.dir, a.cwd, 'hello')
    const ref = await uploadPiSession(a.workspace, 'chat1', a.dir)
    const stored = double.objects.get(objectKey)!.bytes

    await runTurn(a.dir, a.cwd, 'again')
    double.fail = (method) => method === 'PUT'
    await expect(uploadPiSession(a.workspace, 'chat1', a.dir, ref)).rejects.toThrow()
    expect(double.objects.get(objectKey)?.bytes).toEqual(stored)
    double.fail = undefined
    expect(await uploadPiSession(a.workspace, 'chat1', a.dir, ref)).toBeDefined() // the next turn retries

    await deletePiSession(a.workspace, 'chat1')
    expect(double.objects.has(objectKey)).toBe(false)
  })

  test('another agent of the chat has its own file and object (session-<agent_id>.jsonl), restored and deleted with the chat', async () => {
    const { double, node, objectKey } = setup()
    const WRITER = 'agentwriter1'
    const a = node('a')
    await runTurn(a.dir, a.cwd, 'primary agent context')
    await runTurn(a.dir, a.cwd, 'writer context only', WRITER)
    const primary = await uploadPiSession(a.workspace, 'chat1', a.dir)
    const writer = await uploadPiSession(a.workspace, 'chat1', a.dir, undefined, WRITER)
    const writerKey = `workspaces/ws1/chats/chat1/session-${WRITER}.jsonl`
    expect(primary && writer && primary.hash !== writer.hash).toBe(true)
    expect(new TextDecoder().decode(double.objects.get(writerKey)?.bytes)).toContain('writer context only')
    expect(new TextDecoder().decode(double.objects.get(objectKey)?.bytes)).not.toContain('writer context only')

    const b = node('b')
    expect(await restorePiSession(b.workspace, 'chat1', b.dir, b.cwd, writer, WRITER)).toBe(true)
    const seen = await runTurn(b.dir, b.cwd, 'go on', WRITER)
    expect(seen).toContain('writer context only')
    expect(seen).not.toContain('primary agent context')

    await deletePiSession(a.workspace, 'chat1', [WRITER])
    expect(double.objects.has(objectKey)).toBe(false)
    expect(double.objects.has(writerKey)).toBe(false)
  })

  test('on the disk driver nothing happens', async () => {
    initFileStorage({})
    const root = mkdtempSync(join(tmpdir(), 'otto-pi-disk-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const dir = join(root, 'chat1')
    await runTurn(dir, dir, 'hi')
    const ws = { id: 'ws1', rootPath: root }
    expect(await uploadPiSession(ws, 'chat1', dir)).toBeUndefined()
    expect(await restorePiSession(ws, 'chat1', dir, dir)).toBe(false)
    await deletePiSession(ws, 'chat1')
    expect(statSync(root).isDirectory()).toBe(true)
  })
})
