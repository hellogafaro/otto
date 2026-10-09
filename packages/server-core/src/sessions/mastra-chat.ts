import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { AgentEvent } from '@otto/core/types'
import type { ToolsInput } from '@mastra/core/agent'
import type { AgentSkillsInput } from '@mastra/core/skills'

export async function* streamMastraChat(input: {
  agentId: string
  name: string
  instructions: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  model: MastraModelConfig
  signal: AbortSignal
  tools?: ToolsInput
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
  new Mastra({ agents: { chat: agent }, logger: false })
  let turnId = crypto.randomUUID()
  const messages = input.messages.map((message) => message.role === 'assistant'
    ? { role: 'assistant' as const, content: message.content }
    : { role: 'user' as const, content: message.content })
  const output = await agent.stream(messages, { abortSignal: input.signal, maxSteps: input.tools || input.skills ? 8 : 1, toolCallConcurrency: 1, providerOptions: { openai: { store: false } } })
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
      turnId = crypto.randomUUID()
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

export function nativeProviderBaseUrl(input: { provider: string; baseUrl?: string; api?: string }): URL {
  if (!['openai', 'custom', 'anthropic'].includes(input.provider)) throw new Error('Native chat supports OpenAI API-key connections, explicit OpenAI-compatible endpoints and Anthropic API keys only.')
  if (input.provider === 'custom' && (!input.baseUrl || !['openai-completions', 'openai-responses'].includes(input.api ?? ''))) throw new Error('Custom endpoints require a base URL and an explicit supported OpenAI protocol.')
  if (input.api && !(input.provider === 'anthropic' ? input.api === 'anthropic-messages' : ['openai-completions', 'openai-responses'].includes(input.api))) throw new Error('The selected API protocol does not match the provider family.')
  let base: URL
  try { base = new URL(input.baseUrl ?? (input.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')) } catch { throw new Error('The model endpoint must be a valid HTTP(S) base URL.') }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('The model endpoint must be an HTTP(S) base URL without credentials or query parameters.')
  return base
}

export function createMastraChatModel(input: { provider: string; model: string; apiKey: string; baseUrl?: string; api?: string }) {
  const base = nativeProviderBaseUrl(input)
  if (!input.apiKey.trim()) throw new Error('An API key is required.')
  const model = input.model.replace(/^pi\//, '')
  const official = base.href.replace(/\/$/, '') === (input.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')
  if (!(official ? input.provider === 'anthropic' ? /^claude-[a-z0-9.-]{1,120}$/.test(model) : /^(gpt-|o\d)[a-z0-9.-]{1,120}$/.test(model) : /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/.test(model))) throw new Error('The model ID is not supported by this endpoint.')
  const prefix = `${base.pathname.replace(/\/$/, '')}/`
  const confinedFetch = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url)
    if (target.origin !== base.origin || !target.pathname.startsWith(prefix)) throw new Error('The model request attempted to leave its configured endpoint.')
    return fetch(url, { ...init, redirect: 'error' })
  }, { preconnect: fetch.preconnect })
  if (input.provider === 'anthropic') return createAnthropic({ apiKey: input.apiKey, baseURL: base.href.replace(/\/$/, ''), fetch: confinedFetch })(model)
  const provider = createOpenAI({ apiKey: input.apiKey, baseURL: base.href.replace(/\/$/, ''), fetch: confinedFetch })
  return input.api === 'openai-completions' ? provider.chat(model) : provider.responses(model)
}
