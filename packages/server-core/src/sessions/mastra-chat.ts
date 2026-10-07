import { createOpenAI } from '@ai-sdk/openai'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import type { MastraModelConfig } from '@mastra/core/llm'
import { createId } from '@otto/shared/id'
import type { AgentEvent } from '@otto/core/types'
import type { ToolsInput } from '@mastra/core/agent'
import type { ToolHooks } from '@mastra/core/tools'
import type { AgentSkillsInput } from '@mastra/core/skills'

export async function* streamMastraChat(input: {
  agentId: string
  name: string
  instructions: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  model: MastraModelConfig
  signal: AbortSignal
  tools?: ToolsInput
  beforeToolCall?: ToolHooks['beforeToolCall']
  skills?: AgentSkillsInput
}): AsyncGenerator<AgentEvent> {
  const agent = new Agent({
    id: input.agentId,
    name: input.name,
    instructions: input.instructions,
    model: input.model,
    tools: input.tools,
    skills: input.skills,
  })
  new Mastra({ agents: { chat: agent }, logger: false, idGenerator: () => createId() })
  let turnId = createId()
  const messages = input.messages.map((message) => message.role === 'assistant'
    ? { role: 'assistant' as const, content: message.content }
    : { role: 'user' as const, content: message.content })
  const output = await agent.stream(messages, { abortSignal: input.signal, maxSteps: input.tools || input.skills ? 8 : 1, toolCallConcurrency: 1, hooks: { beforeToolCall: input.beforeToolCall }, providerOptions: { openai: { store: false } } })
  let text = ''
  let completed = false
  for await (const chunk of output.fullStream) {
    input.signal.throwIfAborted()
    if (chunk.type === 'text-delta') {
      text += chunk.payload.text
      yield { type: 'text_delta', text: chunk.payload.text, turnId }
    } else if (chunk.type === 'error') {
      yield { type: 'text_discard', turnId }
      throw new Error('The model request failed. Check your connection and try again.')
    } else if (chunk.type === 'tool-call') {
      if (text) {
        yield { type: 'text_complete', text, turnId, isIntermediate: true }
        text = ''
      }
      yield { type: 'tool_start', toolName: chunk.payload.toolName, toolUseId: chunk.payload.toolCallId, input: chunk.payload.args ?? {}, turnId }
    } else if (chunk.type === 'tool-result') {
      const result = chunk.payload.result
      yield { type: 'tool_result', toolName: chunk.payload.toolName, toolUseId: chunk.payload.toolCallId, result: JSON.stringify(result), isError: chunk.payload.isError ?? (typeof result === 'object' && result !== null && 'error' in result), turnId }
    } else if (chunk.type === 'tool-error') {
      yield { type: 'tool_result', toolName: chunk.payload.toolName, toolUseId: chunk.payload.toolCallId, result: 'The work action failed. Check access and the current document or task version.', isError: true, turnId }
    } else if (chunk.type === 'step-finish' && chunk.payload.stepResult.reason === 'tool-calls') {
      if (text) yield { type: 'text_complete', text, turnId, isIntermediate: true }
      text = ''
      turnId = createId()
    } else if (chunk.type === 'finish') {
      if (chunk.payload.stepResult.reason !== 'stop') {
        yield { type: 'text_discard', turnId }
        throw new Error('The model did not finish its response.')
      }
      completed = true
      if (text) yield { type: 'text_complete', text, turnId }
      const usage = chunk.payload.output.usage
      yield { type: 'complete', usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } }
    }
  }
  if (!completed) {
    yield { type: 'text_discard', turnId }
    throw new Error('The model stream ended before completion.')
  }
}

export function createMastraChatModel(input: { provider: string; model: string; apiKey: string; baseUrl?: string }) {
  if (input.provider !== 'openai') throw new Error('This migration slice supports an OpenAI API-key connection only.')
  return createOpenAI({ apiKey: input.apiKey, baseURL: input.baseUrl }).responses(input.model.replace(/^pi\//, ''))
}
