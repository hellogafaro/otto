import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
//
// One Pi turn on an agent's computer, end to end with no Docker daemon: the real PiAgent and the real
// pi-agent-server subprocess, a scripted model behind a local OpenAI-compatible endpoint (it decides each tool call),
// `DirComputer` as the box (a temp folder as its root, box paths mapped), the real `otto` CLI against a real server on
// an ephemeral port, and the browser tool against a real Fortress (OTTO_FORTRESS_PATH; without it those steps are
// left out). The box is killed in the middle of a bash command.

const configDir = mkdtempSync(join(tmpdir(), 'otto-computer-turn-'))
process.env.OTTO_CONFIG_DIR = configDir
const REPO = join(import.meta.dir, '../../../..')
const FORTRESS = process.env.OTTO_FORTRESS_PATH

const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../shared/src/db/push.ts')
const { users } = await import('../../../shared/src/users/schema.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { createSession, getSessionPath } = await import('../../../shared/src/sessions/storage.ts')
const { initAgentApiUrl, initComputerApiUrl } = await import('@otto/shared/agent')
const { PiAgent } = await import('../../../shared/src/agent/pi-agent.ts')
const { DirComputer } = await import('../../../shared/src/computer/__tests__/dir-computer.ts')
const { COMPUTER_RESTARTED, DOCS_MOUNT, SKILLS_MOUNT, getComputerRuns } = await import('@otto/shared/computer')
const { disposeAgentBrowsers, findFortress, launchFortress } = await import('@otto/shared/browser')
const { getDocsDir } = await import('@otto/shared/docs')
const { WsRpcServer } = await import('../transport')
const { authorize } = await import('../bootstrap/authorize')
const { registerCoreRpcHandlers } = await import('../handlers/rpc/index')
const { createAgentRpcHandler } = await import('./agent-rpc')

const AGENT = 'agent0000001'
const USER = 'alice0000001'
let workspaceId = ''
let rootPath = ''
let chatId = ''
let server: InstanceType<typeof WsRpcServer>
let box: InstanceType<typeof DirComputer>
let fortress: { httpUrl: string; stop(): void } | null = null
let page: ReturnType<typeof Bun.serve>
let llm: ReturnType<typeof Bun.serve>
const requests: any[] = []

/** The model's script: what to do after `done` tool results, given what came back. */
function nextStep(done: number, lastResult: string, tools: string[]): { tool?: string; args?: Record<string, unknown>; text?: string } {
  const browserTool = tools.find((name) => name.endsWith('browser_tool'))!
  const steps: Array<() => { tool?: string; args?: Record<string, unknown>; text?: string }> = [
    () => ({ tool: 'bash', args: { command: 'pwd; echo "home=$HOME"; ls /skills; otto tasks list; echo "token=${OTTO_RUN_TOKEN:+set}"' } }),
    () => ({ tool: 'write', args: { path: 'notes/plan.md', content: '# Plan\n' } }),
    () => ({ tool: 'read', args: { path: `${DOCS_MOUNT}/browser-tools.md` } }),
    ...(FORTRESS
      ? [
          () => ({ tool: browserTool, args: { command: `navigate http://127.0.0.1:${page.port}/` } }),
          () => ({ tool: browserTool, args: { command: 'screenshot' } }),
          () => ({ tool: 'read', args: { path: /Saved screenshot: (\S+)/.exec(lastResult)?.[1] ?? 'missing' } }),
        ]
      : []),
    () => {
      setTimeout(() => box.crash(), 1500)
      return { tool: 'bash', args: { command: 'echo started; sleep 20; echo late' } }
    },
    () => ({ tool: 'bash', args: { command: 'echo back; ls notes' } }),
  ]
  return done < steps.length ? steps[done]!() : { text: 'All done.' }
}

/** OpenAI-compatible streaming chat completions, driven by `nextStep`. */
function fakeModel(req: Request): Promise<Response> {
  return req.json().then((body: any) => {
    requests.push(body)
    const toolMessages = body.messages.filter((m: any) => m.role === 'tool')
    const last = toolMessages.at(-1)
    const lastResult = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
    const step = nextStep(toolMessages.length, lastResult, (body.tools ?? []).map((t: any) => t.function.name))
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`
    const sse = step.tool
      ? chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${toolMessages.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] }, null)
        + chunk({}, 'tool_calls')
      : chunk({ role: 'assistant', content: step.text }, null) + chunk({}, 'stop')
    return new Response(sse + usage + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  })
}

beforeAll(async () => {
  const db = initDb()
  await pushSchema(db)
  saveConfig({ workspaces: [] })
  rootPath = join(configDir, 'ws')
  workspaceId = addWorkspace({ name: 'Main', rootPath }).id
  const now = new Date()
  db.insert(users).values({ id: USER, name: 'Alice', email: 'alice@example.com', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspaceId, USER, 'owner')
  chatId = createSession({ id: workspaceId, rootPath }, { createdBy: `user:${USER}`, agentId: AGENT }).id
  mkdirSync(join(rootPath, 'skills', 'deploy'), { recursive: true })
  writeFileSync(join(rootPath, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship it\n---\nShip.\n')
  mkdirSync(getDocsDir(), { recursive: true })
  writeFileSync(join(getDocsDir(), 'browser-tools.md'), '# Browser tools\nUse browser_tool.\n')
  writeFileSync(join(getDocsDir(), 'otto.md'), '# otto\n')

  const deps = {
    sessionManager: { waitForInit: async () => {}, canSeeSession: () => true, getSessions: () => [], emitLabelConfigChange: () => {} },
    platform: { logger: console, imageProcessor: {} },
    messagingRegistry: new Proxy({}, { get: () => () => undefined }),
    oauthFlowStore: {},
  } as never
  server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async () => null,
    authorize,
    httpHandler: createAgentRpcHandler({ invoke: (ctx, channel, args) => server.invoke(ctx, channel, args), audit: () => {} }),
  })
  registerCoreRpcHandlers(server, deps)
  await server.listen()
  initAgentApiUrl(`http://127.0.0.1:${server.port}`)
  // The test box runs on this host, so it reaches the server where a docker box would reach the computer API.
  initComputerApiUrl(`http://127.0.0.1:${server.port}`)

  llm = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (req) => (new URL(req.url).pathname.endsWith('/chat/completions') ? fakeModel(req) : new Response('not found', { status: 404 })) })
  page = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('<title>Box page</title><h1>Hello from the box</h1>', { headers: { 'content-type': 'text/html' } }) })

  if (FORTRESS) {
    fortress = await launchFortress({ binary: findFortress()!, profileDir: join(configDir, 'fortress-profile'), env: { ...process.env, TILION_NO_GEO: '1' } })
  }
  box = new DirComputer({
    id: 'boxturn00001',
    mounts: { [SKILLS_MOUNT]: join(rootPath, 'skills'), [DOCS_MOUNT]: getDocsDir() },
    path: [join(REPO, 'apps/electron/resources/bin'), dirname(process.execPath)],
  })
  // Like a DockerComputer: the box's browser is published on a loopback port.
  Object.assign(box, { hostPort: async () => (fortress ? Number(new URL(fortress.httpUrl).port) : null) })
}, 60_000)

afterAll(() => {
  initAgentApiUrl(null)
  initComputerApiUrl(null)
  disposeAgentBrowsers()
  fortress?.stop()
  box?.dispose()
  llm?.stop(true)
  page?.stop(true)
  server?.close()
  rmSync(configDir, { recursive: true, force: true })
})

describe('a Pi turn on the agent computer', () => {
  it('runs bash, files, the otto CLI and the browser in the box with box paths, and survives the box dying', async () => {
    const agent = new PiAgent({
      isHeadless: true,
      workspace: { id: workspaceId, name: 'Main', rootPath } as never,
      session: { id: chatId, workspaceRootPath: rootPath, createdAt: 0, lastUsedAt: 0, createdBy: `user:${USER}`, agentId: AGENT } as never,
      model: 'fake-model',
      connectionSlug: 'fake',
      runtime: {
        paths: { piServer: join(REPO, 'packages/pi-agent-server/src/index.ts'), node: process.execPath },
        customEndpoint: { api: 'openai-completions', supportsImages: true },
        baseUrl: `http://127.0.0.1:${llm.port}/v1`,
        customModels: [{ id: 'fake-model', supportsImages: true }],
      },
      getAgentTurn: () => ({
        agentId: AGENT,
        instructions: '',
        sourceSlugs: null,
        skills: [{ name: 'deploy', description: 'Ship it', filePath: `${SKILLS_MOUNT}/deploy/SKILL.md` }],
        skillsDir: SKILLS_MOUNT,
        computer: box,
      }),
    } as never)
    agent.setPermissionMode('allow-all')
    const events: any[] = []
    try {
      for await (const event of agent.chat('Look around your computer.')) events.push(event)
    } finally {
      agent.destroy()
    }
    const results = requests.flatMap((r) => r.messages.filter((m: any) => m.role === 'tool')).slice(-50)
    const resultText = (i: number) => {
      const r = requests.at(-1).messages.filter((m: any) => m.role === 'tool')[i]
      return typeof r?.content === 'string' ? r.content : JSON.stringify(r?.content)
    }
    const errors = events.filter((e) => e.type === 'error' || e.type === 'typed_error')
    expect(errors).toEqual([])
    expect(results.length).toBeGreaterThan(0)

    // The prompt: the working directory, the skills and the otto skill as the box sees them; no server path.
    const system = requests[0].messages.find((m: any) => m.role === 'system' || m.role === 'developer').content as string
    const cwd = `/home/agent/chats/${chatId}`
    expect(system).toContain(cwd)
    expect(system).toContain(`${SKILLS_MOUNT}/deploy/SKILL.md`)
    expect(system).toContain(`${DOCS_MOUNT}/otto.md`)
    expect(system).not.toContain(getSessionPath(rootPath, chatId))

    // bash ran in the chat's folder in the box, with the skills mount and the otto CLI working as the chat's user.
    const bash = resultText(0)
    expect(bash).toContain(cwd)
    expect(bash).toContain('home=/home/agent')
    expect(bash).toContain('deploy')
    expect(bash).toContain('[]') // `otto tasks list` on the real server: no tasks yet
    expect(bash).toContain('token=set')
    expect(existsSync(box.hostPath(`${cwd}/notes/plan.md`))).toBe(true)
    // The docs mount (the browser guide is read before the browser may be used).
    expect(resultText(2)).toContain('Use browser_tool.')
    let i = 3
    if (FORTRESS) {
      expect(resultText(i++)).toContain('Page: Box page')
      const shot = resultText(i++)
      const boxShot = /Saved screenshot: (\S+)/.exec(shot)![1]!
      expect(boxShot.startsWith(`${cwd}/downloads/`)).toBe(true)
      const hostShot = getSessionPath(rootPath, chatId) + boxShot.slice(cwd.length)
      expect(readFileSync(hostShot).subarray(1, 4).toString()).toBe('PNG') // the UI's copy
      expect(readFileSync(box.hostPath(boxShot)).subarray(1, 4).toString()).toBe('PNG') // the agent's copy
      expect(shot).toContain(`"src": "${hostShot}"`)
      // Pi's read in the box hands the model the image.
      expect(resultText(i++)).toContain('Read image file [image/png]')
      expect(JSON.stringify(requests.at(-1).messages)).toContain('data:image/png;base64,iVBOR')
      // People see the box path as the server path it maps to.
      const readEvent = events.find((e) => e.type === 'tool_start' && e.toolName === 'Read' && String(e.input.path ?? e.input.file_path).endsWith('.png'))
      expect(readEvent.input.path ?? readEvent.input.file_path).toBe(hostShot)
    }
    // The box died under a bash command: that call says so, the next one starts the box again.
    const died = resultText(i++)
    expect(died).toContain(COMPUTER_RESTARTED)
    expect(died).not.toContain('late')
    expect(resultText(i++)).toContain('back\nplan.md')
    expect(box.starts).toBe(2)
    expect(events.at(-1)).toMatchObject({ type: 'complete' })
    expect(getComputerRuns('boxturn00001').activeCount).toBe(0)
  }, 120_000)
})
