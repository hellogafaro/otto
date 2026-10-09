import type { LlmConnection, ModelFetchResult } from '@otto/shared/config'
import { getCredentialManager } from '@otto/shared/credentials'
import { streamMastraChat, createMastraChatModel, nativeProviderBaseUrl } from '../sessions/mastra-chat.ts'

export const OPENAI_UNSUPPORTED = 'This native migration slice supports OpenAI API-key connections only. Existing subscription and other provider records are unchanged but unavailable here.'

export async function fetchOpenAiModels(input: { apiKey: string; baseUrl?: string; signal?: AbortSignal; custom?: boolean }): Promise<ModelFetchResult> {
  if (!input.apiKey.trim()) throw new Error('An OpenAI API key is required.')
  const base = nativeProviderBaseUrl({ ...input, provider: 'openai' })
  const custom = base.href.replace(/\/$/, '') !== 'https://api.openai.com/v1'
  let response: Response
  try {
    response = await fetch(`${base.href.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      redirect: 'error',
      signal: input.signal ?? AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('OpenAI model discovery could not connect. Check the endpoint and try again.')
  }
  if (!response.ok) throw new Error(response.status === 401 ? 'Invalid OpenAI API key.' : response.status === 403 ? 'The OpenAI key cannot list models.' : response.status === 429 ? 'OpenAI rate limit exceeded. Try again later.' : 'OpenAI model discovery failed. Try again later.')
  let data: unknown
  try { const text = await response.text(); if (Buffer.byteLength(text) > 65536) throw new Error('catalog too large'); data = JSON.parse(text) } catch { throw new Error('OpenAI returned an invalid or oversized model list.') }
  if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data)) throw new Error('OpenAI returned an invalid model list.')
  const ids = [...new Set(data.data.flatMap((entry: unknown) => entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string' ? [entry.id] : []))]
    .filter((id) => custom ? /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/.test(id) : /^(gpt-|o\d)[a-z0-9.-]{1,120}$/.test(id) && !/(audio|realtime|transcri|tts|image|search|embedding|instruct)/.test(id))
    .sort()
  if (!ids.length) throw new Error('No text model candidates are available to this OpenAI key. Model-list access does not prove Responses inference support.')
  return { models: ids.map((id) => ({ id, name: id, shortName: id, description: 'OpenAI account catalog; inference support must be tested.', provider: 'openai', contextWindow: 0, supportsThinking: false })) }
}

export async function validateOpenAiConnection(input: { apiKey: string; baseUrl?: string; model?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const model = input.model ?? (await fetchOpenAiModels(input)).models[0]?.id
    if (!model) return { success: false, error: 'No text model is available for an inference check.' }
    if (!input.apiKey.trim()) throw new Error('An OpenAI API key is required.')
    let complete = false
    for await (const event of streamMastraChat({
      agentId: 'connectiontest', name: 'Connection check', instructions: 'Reply briefly.',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      model: createMastraChatModel({ provider: 'openai', model, apiKey: input.apiKey, baseUrl: input.baseUrl }),
      signal: AbortSignal.timeout(20000),
    })) if (event.type === 'complete') complete = true
    return complete ? { success: true } : { success: false, error: 'OpenAI inference did not complete.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { success: false, error: message.startsWith('OpenAI ') || message.startsWith('An OpenAI ') || message.startsWith('Invalid OpenAI ') || message.startsWith('No text ') || message.startsWith('The OpenAI ') ? message : 'OpenAI inference could not complete. Check the key, model and endpoint.' }
  }
}

export async function validateStoredOpenAiConnection(connection: LlmConnection): Promise<{ success: boolean; error?: string }> {
  if (connection.type !== 'openai' || connection.authType !== 'api_key') return { success: false, error: OPENAI_UNSUPPORTED }
  const apiKey = await getCredentialManager().getLlmApiKey(connection.slug, connection.scope)
  return validateOpenAiConnection({ apiKey: apiKey ?? '', baseUrl: connection.baseUrl, model: connection.defaultModel })
}
