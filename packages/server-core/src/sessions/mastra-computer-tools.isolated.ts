import { afterAll, expect, it } from 'bun:test'
import { AgentBrowser } from '../../../shared/src/browser/agent-browser.ts'
import { ChatComputer } from '../../../shared/src/computer/chat-computer.ts'
import { createMastraBrowserTool, createMastraComputerTools } from './mastra-computer-tools.ts'

const scope = { workspaceId: crypto.randomUUID(), agentId: crypto.randomUUID(), chatId: crypto.randomUUID() }
let allowed = true
let mode: 'ask' | 'safe' = 'ask'
let blockedDisposal = false
const requests: { method: string; params: Record<string, unknown>; sessionId?: string }[] = []
let nextContext = 0
const contexts = new Map<string, { url: string; title: string }>()
const targets = new Map<string, string>()
const sessions = new Map<string, string>()
const pending: { ws: { send: (value: string) => unknown }; id: number; sessionId?: string }[] = []
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return
    return Response.json({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/` })
  },
  websocket: {
    message(ws, data) {
      const message = JSON.parse(String(data))
      requests.push(message)
      const { method, params, sessionId, id } = message
      let result: Record<string, unknown> = {}
      if (method === 'Target.createBrowserContext') {
        const browserContextId = `context-${++nextContext}`
        contexts.set(browserContextId, { url: 'about:blank', title: 'Blank' })
        result = { browserContextId }
      } else if (method === 'Target.createTarget') {
        const targetId = `target-${params.browserContextId}`
        targets.set(targetId, params.browserContextId)
        result = { targetId }
      } else if (method === 'Target.attachToTarget') {
        const sessionId = `session-${params.targetId}`
        sessions.set(sessionId, targets.get(params.targetId)!)
        result = { sessionId }
      } else if (method === 'Target.disposeBrowserContext') {
        if (blockedDisposal) {
          ws.send(JSON.stringify({ id, error: { message: 'controlled disposal failure' } }))
          return
        }
        contexts.delete(params.browserContextId)
      } else if (method === 'Page.navigate') {
        const context = contexts.get(sessions.get(sessionId)!)!
        context.url = params.url
        context.title = params.url.includes('second') ? 'Second' : 'First'
        setTimeout(() => ws.send(JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId })), 5)
      } else if (method === 'Runtime.evaluate') {
        if (params.expression === 'hang') { pending.push({ ws, id, sessionId }); return }
        result = { result: { value: contexts.get(sessions.get(sessionId)!) } }
      } else if (method === 'Accessibility.getFullAXTree') {
        result = { nodes: [{ role: { value: 'heading' }, name: { value: 'Fixture heading' }, backendDOMNodeId: 1 }] }
      } else if (method === 'Page.captureScreenshot') result = { data: Buffer.from('fixture-png').toString('base64') }
      ws.send(JSON.stringify({ id, result }))
    },
  },
})
afterAll(() => server.stop(true))
const browser = new AgentBrowser(async () => server.url.href.slice(0, -1))
const access = () => { if (!allowed) throw new Error('Access removed') }
const input = (signal: AbortSignal, chatId = scope.chatId) => ({ ...scope, chatId, mode: 'ask' as const, getMode: () => mode, signal, assertAccess: access, browser, assertBrowserIsolation: access })
const call = (tool: ReturnType<typeof createMastraBrowserTool>, command: string | string[], signal?: AbortSignal) => tool.execute!({ command }, { abortSignal: signal } as never)

it('uses separate CDP contexts and rechecks membership/mode; never navigates file URLs', async () => {
  const first = createMastraBrowserTool(input(new AbortController().signal))
  const second = createMastraBrowserTool(input(new AbortController().signal, crypto.randomUUID()))
  expect(await call(first, 'navigate https://example.test/first')).toHaveProperty('output', 'Page: First\nURL: https://example.test/first\nNext: snapshot to see the elements.')
  await call(second, 'navigate https://example.test/second')
  expect((await call(first, 'snapshot') as { output: string }).output).toContain('URL: https://example.test/first')
  expect((await call(second, 'snapshot') as { output: string }).output).toContain('URL: https://example.test/second')
  expect(contexts.size).toBe(2)
  const before = requests.length
  await expect(call(first, 'navigate file:///etc/passwd')).rejects.toThrow('Only HTTP')
  allowed = false
  await expect(call(first, 'snapshot')).rejects.toThrow('Access removed')
  allowed = true
  mode = 'safe'
  await expect(call(first, 'click @e1')).rejects.toThrow('mode changed')
  mode = 'ask'
  expect(requests.length).toBe(before)
  const safe = createMastraBrowserTool({ ...input(new AbortController().signal), mode: 'safe', getMode: () => 'safe' })
  await expect(call(safe, 'evaluate fetch("https://example.test/write",{method:"POST"})')).rejects.toThrow('Explore')
  expect(await call(safe, 'screenshot')).toHaveProperty('mediaType', 'image/png')
  browser.dispose()
})

it('cancels a pending command, confirms only its own context disposal, and never admits a failed-disposal context again', async () => {
  const abort = new AbortController()
  const tool = createMastraBrowserTool(input(abort.signal, crypto.randomUUID()))
  const operation = call(tool, 'evaluate hang')
  while (!pending.length) await Bun.sleep(5)
  const contextId = sessions.get(pending[0]!.sessionId!)!
  abort.abort()
  await expect(operation).rejects.toThrow()
  expect(contexts.has(contextId)).toBe(false)
  expect(requests.at(-1)).toMatchObject({ method: 'Target.disposeBrowserContext', params: { browserContextId: contextId } })
  pending[0]!.ws.send(JSON.stringify({ id: pending[0]!.id, result: { result: { value: 'late result' } } }))
  pending.length = 0
  const failedChat = crypto.randomUUID()
  const failure = new AbortController()
  const failed = createMastraBrowserTool(input(failure.signal, failedChat))
  const failing = call(failed, 'evaluate hang')
  while (!pending.length) await Bun.sleep(5)
  blockedDisposal = true
  failure.abort()
  await expect(failing).rejects.toThrow('disposal failed')
  blockedDisposal = false
  await expect(browser.page(failedChat)).rejects.toThrow('blocked')
  browser.dispose()
})

it('refuses non-chat/foreign computer allocations before any provisioning', () => {
  const computer = new ChatComputer(scope)
  expect(() => createMastraComputerTools({ ...input(new AbortController().signal), chatId: crypto.randomUUID(), computer })).toThrow('exact chat')
  expect(() => createMastraComputerTools({ ...input(new AbortController().signal), computer: {} as ChatComputer })).toThrow('shared or host')
})

it('rechecks authorization between CDP writes and serializes same-chat commands', async () => {
  const isolated = new AgentBrowser(async () => server.url.href.slice(0, -1))
  const chatId = crypto.randomUUID()
  let checks = 0
  const assertAccess = () => { if (++checks === 4) throw new Error('Access removed during execution') }
  await expect(isolated.run(chatId, { signal: new AbortController().signal, assertAccess }, async (page) => {
    await page.type('first')
    await page.type('forbidden second')
  })).rejects.toThrow('during execution')
  expect(requests.filter((request) => request.method === 'Input.insertText' && request.params.text === 'forbidden second')).toHaveLength(0)
  const order: string[] = []
  await Promise.all([
    isolated.run(chatId, { signal: new AbortController().signal, assertAccess: () => {} }, async () => { order.push('first-start'); await Bun.sleep(10); order.push('first-end') }),
    isolated.run(chatId, { signal: new AbortController().signal, assertAccess: () => {} }, async () => { order.push('second') }),
  ])
  expect(order).toEqual(['first-start', 'first-end', 'second'])
  await isolated.close(chatId)
  isolated.dispose()
})
