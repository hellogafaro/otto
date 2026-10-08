import { afterAll, expect, it } from 'bun:test'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type {
  LanguageModelV2,
  LanguageModelV2StreamPart,
  LanguageModelV2CallOptions,
} from '@ai-sdk/provider-v5'
import type { Session } from '@mastra/core/agent-controller'
import type { AgentEvent } from '@otto/core/types'
import { runMastraSession } from './mastra-session'
import { closeMastraHistory } from './mastra-history'

afterAll(() => closeMastraHistory())
const usage = { inputTokens: 2, outputTokens: 1, totalTokens: 3 }
function model(
  parts: (
    call: number,
    options: LanguageModelV2CallOptions,
  ) => Promise<LanguageModelV2StreamPart[]>,
): LanguageModelV2 {
  let call = 0
  return {
    specificationVersion: 'v2',
    provider: 'fixture',
    modelId: 'fixture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('stream only')
    },
    doStream: async (options) => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (const part of await parts(call++, options))
            controller.enqueue(part)
          controller.close()
        },
      }),
    }),
  }
}

it('native Session queues follow-up once, has no controller builtins and uses one approval gate', async () => {
  let release!: () => void, started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const events: AgentEvent[] = []
  let session: Session | undefined,
    writes = 0
  let exposed: string[] = []
  const replay: { role: 'user' | 'assistant'; content: string }[] = []
  const seen: string[] = []
  const pending = runMastraSession({
    chatId: crypto.randomUUID(),
    workspaceId: 'fixture-scope',
    ownerId: 'fixture-owner',
    agentId: 'fixture-agent',
    name: 'Scout',
    instructions: 'General work',
    messages: [{ role: 'user', content: 'First' }],
    model: model(async (call, options) => {
      seen.push(JSON.stringify(options.prompt))
      if (call === 0) {
        started()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return [
          { type: 'text-start', id: 'first' },
          { type: 'text-delta', id: 'first', delta: 'First response' },
          { type: 'text-end', id: 'first' },
          { type: 'finish', finishReason: 'stop', usage },
        ]
      }
      return [
        { type: 'text-start', id: 'next' },
        { type: 'text-delta', id: 'next', delta: 'Queued response' },
        { type: 'text-end', id: 'next' },
        { type: 'finish', finishReason: 'stop', usage },
      ]
    }),
    tools: {
      save_brief: createTool({
        id: 'save_brief',
        description: 'Save brief',
        inputSchema: z.object({ title: z.string() }),
        execute: async () => {
          writes++
          return { id: 'saved' }
        },
      }),
    },
    history: async () => [...replay],
    signal: new AbortController().signal,
    assertAccess: () => {},
    policy: () => 'allow',
    onReady: (native) => {
      session = native
      void native.machinery
        .getAgent()
        .listTools()
        .then((tools) => {
          exposed = Object.keys(tools)
        })
    },
    onApproval: () => {
      throw new Error('Unexpected approval')
    },
    emit: async (event) => {
      events.push(event)
      if (event.type === 'text_complete')
        replay.push(
          { role: 'user', content: 'First request' },
          { role: 'assistant', content: event.text },
          {
            role: 'user',
            content: 'Recorded completed artifact document000001',
          },
        )
    },
  })
  await ready
  await session!.followUp({ content: 'Second queued message' })
  release()
  await pending
  expect(
    events
      .filter((event) => event.type === 'text_complete')
      .map((event) => (event.type === 'text_complete' ? event.text : '')),
  ).toEqual(['First response', 'Queued response'])
  expect(events.filter((event) => event.type === 'complete')).toHaveLength(2)
  expect(writes).toBe(0)
  expect(exposed).not.toContain('task_write')
  expect(exposed).not.toContain('executeCommand')
  expect(seen[1]).toContain('First request')
  expect(seen[1]).toContain('First response')
  expect(seen[1]).toContain('document000001')
  expect(seen[1].match(/document000001/g)).toHaveLength(1)
}, 15000)

it('native approval decline never runs a tool and Stop releases a parked gate', async () => {
  let writes = 0,
    stop: () => void = () => {}
  const abort = new AbortController()
  const events: AgentEvent[] = []
  await expect(
    runMastraSession({
      chatId: crypto.randomUUID(),
      workspaceId: 'fixture-scope',
      ownerId: 'fixture-owner',
      agentId: 'fixture-agent',
      name: 'Scout',
      instructions: 'General work',
      messages: [{ role: 'user', content: 'Save' }],
      model: model(async () => [
        {
          type: 'tool-call',
          toolCallId: 'gate1',
          toolName: 'save_brief',
          input: '{"title":"Brief"}',
        },
        { type: 'finish', finishReason: 'tool-calls', usage },
      ]),
      tools: {
        save_brief: createTool({
          id: 'save_brief',
          description: 'Save brief',
          inputSchema: z.object({ title: z.string() }),
          execute: async () => {
            writes++
            return { id: 'saved' }
          },
        }),
      },
      signal: abort.signal,
      assertAccess: () => {},
      policy: () => 'ask',
      onReady: (_session, abortNative) => {
        stop = abortNative
      },
      onApproval: () => {
        abort.abort()
        stop()
      },
      emit: async (event) => {
        events.push(event)
      },
    }),
  ).rejects.toThrow()
  expect(writes).toBe(0)
  expect(
    events.some((event) => event.type === 'tool_result' && event.isError),
  ).toBe(true)
}, 15000)

it('Stop cancels queued native follow-ups instead of letting a second run start', async () => {
  let started!: () => void,
    release!: () => void,
    session: Session | undefined,
    stop = () => {},
    calls = 0
  const active = new Promise<void>((resolve) => {
    started = resolve
  })
  const abort = new AbortController()
  const events: AgentEvent[] = []
  const pending = runMastraSession({
    chatId: crypto.randomUUID(),
    workspaceId: 'fixture-scope',
    ownerId: 'fixture-owner',
    agentId: 'fixture-agent',
    name: 'Scout',
    instructions: 'General work',
    messages: [{ role: 'user', content: 'First' }],
    model: model(async () => {
      calls++
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return [
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'unfinished' },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: 'stop', usage },
      ]
    }),
    tools: {},
    signal: abort.signal,
    assertAccess: () => {},
    policy: () => 'allow',
    onReady: (native, nativeStop) => {
      session = native
      stop = nativeStop
    },
    onApproval: () => {},
    emit: async (event) => {
      events.push(event)
    },
  })
  await active
  await session!.followUp({ content: 'Do not run this after Stop' })
  stop()
  abort.abort()
  release()
  await expect(pending).rejects.toThrow()
  expect(calls).toBe(1)
  expect(events.filter((event) => event.type === 'text_complete')).toEqual([])
}, 15000)

it('Stop cancels tracked follow-up while native stream options are still preparing', async () => {
  let modelStarted!: () => void,
    releaseModel!: () => void,
    preparing!: () => void,
    releasePreparation!: () => void
  const active = new Promise<void>((resolve) => {
    modelStarted = resolve
  })
  const prepared = new Promise<void>((resolve) => {
    preparing = resolve
  })
  const abort = new AbortController()
  let session: Session | undefined,
    stop = () => {},
    calls = 0
  const pending = runMastraSession({
    chatId: crypto.randomUUID(),
    workspaceId: 'fixture-scope',
    ownerId: 'fixture-owner',
    agentId: 'fixture-agent',
    name: 'Scout',
    instructions: 'General work',
    messages: [{ role: 'user', content: 'First' }],
    model: model(async () => {
      calls++
      modelStarted()
      await new Promise<void>((resolve) => {
        releaseModel = resolve
      })
      return [{ type: 'finish', finishReason: 'stop', usage }]
    }),
    tools: {},
    signal: abort.signal,
    assertAccess: () => {},
    policy: () => 'allow',
    onReady: (native, nativeStop) => {
      session = native
      stop = nativeStop
    },
    onApproval: () => {},
    emit: async () => {},
  })
  await active
  const machinery = session!.machinery
  session!.setMachinery({
    ...machinery,
    buildStreamOptions: async (options) => {
      preparing()
      await new Promise<void>((resolve) => {
        releasePreparation = resolve
      })
      return machinery.buildStreamOptions(options)
    },
  })
  const follow = session!.followUp({
    content: 'Late follow-up must not be admitted',
  })
  await prepared
  stop()
  abort.abort()
  releasePreparation()
  await follow
  releaseModel()
  await expect(pending).rejects.toThrow()
  expect(calls).toBe(1)
}, 15000)
