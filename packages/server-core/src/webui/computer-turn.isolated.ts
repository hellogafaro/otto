import { afterAll, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider-v5'
import type { AgentEvent } from '@otto/core/types'
import { ChatComputer } from '../../../shared/src/computer/chat-computer.ts'
import { getComputerRuns } from '../../../shared/src/computer/lifecycle.ts'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { getLibraryItems, readLibraryContent } from '@otto/shared/library'
import { createMastraComputerTools } from '../sessions/mastra-computer-tools.ts'
import { runMastraSession } from '../sessions/mastra-session.ts'
import { closeMastraHistory } from '../sessions/mastra-history.ts'

afterAll(() => closeMastraHistory())
const enabled = process.env.OTTO_TEST_CHAT_COMPUTER_DOCKER === '1'
const usage = { inputTokens: 2, outputTokens: 1, totalTokens: 3 }

it.skipIf(!enabled)('native Session uses only its task computer, publishes explicit Library output, and Stop kills owned descendants without harming a sibling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'otto-native-computer-turn-'))
  const image = process.env.OTTO_TEST_TASK_IMAGE ?? `otto-chat-proof:${crypto.randomUUID()}`
  let built = false
  let computer: ChatComputer | undefined
  let sibling: ChatComputer | undefined
  const docker = async (...args: string[]) => {
    const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
    if (code) throw new Error(`${args[0]} failed: ${stderr}`)
    return stdout.trim()
  }
  try {
    if (!process.env.OTTO_TEST_TASK_IMAGE) {
    writeFileSync(join(directory, 'Dockerfile'), 'FROM rift-rift:latest\nUSER root\nRUN printf "agent:x:17731:17731::/home/agent:/bin/bash\\n" >> /etc/passwd && printf "agent:x:17731:\\n" >> /etc/group && mkdir /home/agent && chown 17731:17731 /home/agent\nUSER agent\nWORKDIR /home/agent\nHEALTHCHECK NONE\nENTRYPOINT ["/bin/sh", "-c", "exec sleep 3600"]\n')
    await docker('build', '--pull=false', '-t', image, directory)
    built = true
    }
    saveConfig({ workspaces: [] })
    const workspace = addWorkspace({ name: 'Native computer fixture', rootPath: join(directory, 'workspace') })
    const scope = { workspaceId: workspace.id, agentId: crypto.randomUUID(), chatId: crypto.randomUUID() }
    computer = new ChatComputer(scope, { image })
    sibling = new ChatComputer(scope, { image })
    await sibling.ensureRunning()
    const abort = new AbortController()
    const tools = createMastraComputerTools({ ...scope, computer, signal: abort.signal, mode: 'allow-all', getMode: () => 'allow-all', assertAccess: () => abort.signal.throwIfAborted() })
    const events: AgentEvent[] = []
    const seen: string[] = []
    let exposed: string[] = []
    const steps = [
      { name: 'bash', args: { command: 'pwd; printf "token=%s\\n" "${OTTO_RUN_TOKEN:-absent}"; ls /sys/class/net' } },
      { name: 'write', args: { path: 'notes/plan.md', content: '# Native plan\n' } },
      { name: 'read', args: { path: 'notes/plan.md' } },
      { name: 'publish_file', args: { path: 'notes/plan.md' } },
    ]
    let call = 0
    const model: LanguageModelV2 = {
      specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
      doGenerate: async () => { throw new Error('stream only') },
      doStream: async (options) => {
        exposed = (options.tools ?? []).map((tool) => tool.name)
        seen.push(JSON.stringify(options.prompt))
        const step = steps[call++]
        const parts: LanguageModelV2StreamPart[] = step ? [
          { type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: step.name, input: JSON.stringify(step.args) },
          { type: 'finish', finishReason: 'tool-calls', usage },
        ] : [
          { type: 'text-start', id: 'finished' }, { type: 'text-delta', id: 'finished', delta: 'The explicit artifact is saved.' },
          { type: 'text-end', id: 'finished' }, { type: 'finish', finishReason: 'stop', usage },
        ]
        return { stream: new ReadableStream({ start(controller) { controller.enqueue({ type: 'stream-start', warnings: [] }); for (const part of parts) controller.enqueue(part); controller.close() } }) }
      },
    }
    await runMastraSession({ ...scope, ownerId: crypto.randomUUID(), name: 'Scout', instructions: 'Work only in the allocated task computer; publish only when explicitly requested.', messages: [{ role: 'user', content: 'Create and explicitly publish a plan.' }], model, tools, signal: abort.signal, assertAccess: () => abort.signal.throwIfAborted(), policy: () => 'allow', onReady: () => {}, onApproval: () => { throw new Error('Unexpected approval') }, emit: async (event) => { events.push(event) } })
    expect(exposed).toEqual(expect.arrayContaining(['read', 'write', 'bash', 'publish_file']))
    expect(exposed).not.toContain('subagent')
    expect(exposed).not.toContain('executeCommand')
    expect(seen.at(-1)).toContain('# Native plan')
    expect(seen.at(-1)).toContain('token=absent')
    expect(seen.at(-1)).toContain(computer.cwd)
    const item = getLibraryItems(workspace.id)[0]!
    expect(item).toMatchObject({ title: 'plan.md', createdBy: `agent:${scope.agentId}`, type: 'document' })
    expect(Buffer.from(await readLibraryContent(workspace.id, item.id)).toString()).toBe('# Native plan\n')
    expect(events.some((event) => event.type === 'tool_result' && event.result.includes(item.id))).toBe(true)
    expect(getComputerRuns(computer.id).activeCount).toBe(0)

    const stop = new AbortController()
    const stoppingTools = createMastraComputerTools({ ...scope, computer, signal: stop.signal, mode: 'allow-all', getMode: () => 'allow-all', assertAccess: () => stop.signal.throwIfAborted() })
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const stoppingModel: LanguageModelV2 = { ...model, doStream: async () => ({ stream: new ReadableStream({ start(controller) { controller.enqueue({ type: 'stream-start', warnings: [] }); controller.enqueue({ type: 'tool-call', toolCallId: 'stop-owned', toolName: 'bash', input: JSON.stringify({ command: 'sleep 300 & touch stop-ready; wait' }) }); controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage }); controller.close() } }) }) }
    const pending = runMastraSession({ ...scope, ownerId: crypto.randomUUID(), name: 'Scout', instructions: 'Run the authorized task.', messages: [{ role: 'user', content: 'Start owned work.' }], model: stoppingModel, tools: stoppingTools, signal: stop.signal, assertAccess: () => stop.signal.throwIfAborted(), policy: () => 'allow', onReady: () => started(), onApproval: () => {}, emit: async () => {} })
    const settled = pending.then(() => false, () => true)
    await ready
    let entered = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await docker('exec', `otto-agent-${computer.id}`, 'test', '-f', `${computer.cwd}/stop-ready`); entered = true; break } catch { await Bun.sleep(20) }
    }
    expect(entered).toBe(true)
    stop.abort()
    await computer.terminate()
    expect(await settled).toBe(true)
    expect(await docker('inspect', '-f', '{{.State.Running}}', `otto-agent-${computer.id}`)).toBe('false')
    expect(await docker('inspect', '-f', '{{.State.Running}}', `otto-agent-${sibling.id}`)).toBe('true')
    expect(getComputerRuns(computer.id).activeCount).toBe(0)
    expect(getLibraryItems(workspace.id)).toHaveLength(1)
  } finally {
    await Promise.all([computer?.dispose(), sibling?.dispose()])
    if (built) await docker('image', 'rm', image)
    rmSync(directory, { recursive: true, force: true })
  }
}, 120000)
