import { Agent, type ToolsInput } from '@mastra/core/agent'
import { AgentController, type Session } from '@mastra/core/agent-controller'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { AgentSkillsInput } from '@mastra/core/skills'
import type { AgentEvent } from '@otto/core/types'
import { initMastraHistory } from './mastra-history'
import type { MastraInputFile } from './mastra-attachments'

export async function runMastraSession(input: {
  chatId: string
  workspaceId: string
  ownerId: string
  agentId: string
  name: string
  instructions: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  history?: () => Promise<{ role: 'user' | 'assistant'; content: string; files?: MastraInputFile[] }[]>
  files?: MastraInputFile[]
  model: MastraModelConfig
  tools: ToolsInput
  skills?: AgentSkillsInput
  signal: AbortSignal
  assertAccess: () => void
  policy: (toolName: string) => 'allow' | 'deny' | 'ask'
  onReady: (session: Session, stop: () => void) => void
  onApproval: (toolCallId: string, toolName: string, args: unknown) => void
  emit: (event: AgentEvent) => Promise<void>
  onRunStart?: () => void
}) {
  const history = input.messages.slice(0, -1)
  const content = input.messages.at(-1)?.content ?? ''
  const agent = new Agent({
    id: input.agentId,
    name: input.name,
    model: input.model,
    instructions: input.instructions,
    tools: input.tools,
    skills: input.skills,
    inputProcessors: [
      {
        id: 'otto-history',
        processInput: async ({ messages }) => {
          await writes
          const replay = input.history ? await input.history() : history
          return [
            ...replay.map((message) => ({
              id: crypto.randomUUID(),
              role: message.role,
              createdAt: new Date(),
              content: {
                format: 2 as const,
                parts: [{ type: 'text' as const, text: message.content }, ...('files' in message && message.files ? (message.files as MastraInputFile[]).map((file) => file.mediaType.startsWith('text/') ? { type: 'text' as const, text: `[Attached file: ${file.filename}; reference data]\n${file.data}` } : { type: 'file' as const, data: file.data, mimeType: file.mediaType }) : [])],
              },
            })),
            ...messages,
          ]
        },
      },
    ],
  })
  const controller = new AgentController({
    id: `${input.chatId}:${input.agentId}`,
    agent,
    storage: (await initMastraHistory()).storage,
    modes: [{ id: 'work', name: 'Work', default: true }],
    disableBuiltinTools: [
      'ask_user',
      'submit_plan',
      'task_write',
      'task_update',
      'task_complete',
      'task_check',
      'subagent',
    ],
  })
  await controller.init()
  const session = await controller.createSession({
    id: input.chatId,
    ownerId: input.ownerId,
    resourceId: input.workspaceId,
    scope: input.chatId,
    threadId: input.chatId,
  })
  const machinery = session.machinery
  const runtimeAgent = machinery.getAgent()
  const queue = runtimeAgent.queueMessage.bind(runtimeAgent)
  runtimeAgent.queueMessage = (message, target) =>
    queue(message, { ...target, queueOwnerId: input.chatId })
  session.setMachinery({
    ...machinery,
    buildStreamOptions: async (options) => ({
      ...(await machinery.buildStreamOptions(options)),
      maxSteps: 8,
      toolCallConcurrency: 1,
      providerOptions: { openai: { store: false } },
      hooks: {
        beforeToolCall: ({ toolName }: { toolName: string }) => {
          input.assertAccess()
          if (input.policy(toolName) === 'deny')
            return {
              proceed: false,
              output: {
                error: 'The current permission policy denies this action.',
              },
            }
        },
      },
    }),
    buildSharedRunOptions: () => ({
      ...machinery.buildSharedRunOptions(),
      maxSteps: 8,
      toolCallConcurrency: 1,
      providerOptions: { openai: { store: false } },
    }),
  })
  for (const name of [
    ...Object.keys(input.tools),
    'skill',
    'skill_search',
    'skill_read',
  ])
    await session.permissions.setForTool({
      toolName: name,
      policy: input.policy(name),
    })
  let writes = Promise.resolve(),
    queued = 0,
    active = false,
    runs = 0
  let idleResolve: (() => void) | undefined
  let text = '',
    turnId: string = crypto.randomUUID(),
    failed = false,
    usage = { inputTokens: 0, outputTokens: 0 }
  const emit = (event: AgentEvent) => {
    writes = writes.then(() => input.emit(event))
  }
  const flush = (intermediate: boolean) => {
    if (text) {
      emit({
        type: 'text_complete',
        text,
        turnId,
        isIntermediate: intermediate,
      })
      text = ''
    }
  }
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_start') {
      active = true
      failed = false
      usage = { inputTokens: 0, outputTokens: 0 }
      if (runs++) input.onRunStart?.()
    } else if (event.type === 'follow_up_queued') queued = event.count
    else if (
      event.type === 'message_start' &&
      event.message.role === 'assistant'
    )
      turnId = event.message.id
    else if (
      event.type === 'message_update' &&
      event.event.type === 'text-delta'
    ) {
      text += event.event.delta
      emit({ type: 'text_delta', text: event.event.delta, turnId })
    } else if (event.type === 'tool_start') {
      flush(true)
      emit({
        type: 'tool_start',
        toolName: event.toolName,
        toolUseId: event.toolCallId,
        input: event.args as Record<string, unknown>,
        turnId,
      })
    } else if (event.type === 'tool_end') {
      const result = event.result
      const envelope = result && typeof result === 'object' ? result as { error?: unknown; isError?: unknown; validationErrors?: unknown } : undefined
      const invalidInput = envelope?.error === true && envelope.validationErrors !== undefined
      const isError = event.isError || event.denied === true || envelope?.isError === true || (envelope?.error !== undefined && envelope.error !== false && envelope.error !== null)
      emit({
        type: 'tool_result',
        toolUseId: event.toolCallId,
        result: JSON.stringify(invalidInput ? { error: 'Tool input validation failed. Use only the advertised schema fields.' } : result),
        isError,
        turnId,
      })
    } else if (event.type === 'tool_approval_required')
      input.onApproval(event.toolCallId, event.toolName, event.args)
    else if (event.type === 'usage_update')
      usage = {
        inputTokens: event.usage.promptTokens,
        outputTokens: usage.outputTokens + event.usage.completionTokens,
      }
    else if (event.type === 'error') {
      failed = true
      emit({ type: 'text_discard', turnId })
      emit({
        type: 'error',
        message: 'The native model request could not complete.',
      })
    } else if (event.type === 'agent_end') {
      active = false
      if (event.reason === 'complete' && !failed) {
        flush(false)
        emit({ type: 'complete', usage })
      } else if (text) {
        emit({ type: 'text_discard', turnId })
        text = ''
      }
      setImmediate(() => {
        if (!active && !queued) idleResolve?.()
      })
    }
  })
  const stop = () => {
    session.cleanupFollowUpBinding()
    runtimeAgent.cancelQueuedMessages({
      resourceId: input.workspaceId,
      threadId: input.chatId,
      queueOwnerId: input.chatId,
    })
    queued = 0
    session.abort()
  }
  input.signal.addEventListener('abort', stop, { once: true })
  input.onReady(session, stop)
  try {
    input.signal.throwIfAborted()
    await session.sendMessage({ content, files: input.files })
    if (active || queued)
      await new Promise<void>((resolve) => {
        idleResolve = resolve
        setImmediate(() => {
          if (!active && !queued) resolve()
        })
      })
    await writes
    input.signal.throwIfAborted()
    if (failed) throw new Error('Native session failed.')
  } finally {
    input.signal.removeEventListener('abort', stop)
    unsubscribe()
    await controller.deleteSession({
      resourceId: input.workspaceId,
      scope: input.chatId,
    })
    await writes
  }
}
