import type { LlmConnection, ModelFetchResult } from '@otto/shared/config'
import { getCredentialManager } from '@otto/shared/credentials'
import { createMastraChatModel, streamMastraChat } from '../sessions/mastra-chat'
import { fetchOpenAiModels } from './openai'

export const NATIVE_PROVIDER_UNSUPPORTED = 'Connect an OpenAI, explicit OpenAI-compatible endpoint or Anthropic API key. Subscription execution is unavailable.'

export function isNativeConnection(connection: Pick<LlmConnection, 'type' | 'authType' | 'baseUrl' | 'customEndpoint'>): boolean {
  return connection.authType === 'api_key' && (['openai', 'anthropic'].includes(connection.type) || connection.type === 'custom' && !!connection.baseUrl && ['openai-completions', 'openai-responses'].includes(connection.customEndpoint?.api ?? ''))
}

export async function fetchNativeModels(input: { provider: string; apiKey: string; baseUrl?: string; api?: string; signal?: AbortSignal }): Promise<ModelFetchResult> {
  if (input.provider !== 'anthropic') {
    if (!['openai', 'custom'].includes(input.provider) || input.provider === 'custom' && (!input.baseUrl || !['openai-completions', 'openai-responses'].includes(input.api ?? ''))) throw new Error(NATIVE_PROVIDER_UNSUPPORTED)
    const result = await fetchOpenAiModels({ ...input, custom: input.provider === 'custom' })
    return { models: result.models.map((model) => ({ ...model, provider: 'openai' as const })) }
  }
  if (!input.apiKey.trim()) throw new Error('An Anthropic API key is required.')
  const base = new URL(input.baseUrl ?? 'https://api.anthropic.com/v1')
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid Anthropic base URL.')
  const response = await fetch(`${base.href.replace(/\/$/, '')}/models?limit=100`, { headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }, redirect: 'error', signal: input.signal ?? AbortSignal.timeout(15000) }).catch(() => { throw new Error('Anthropic model discovery could not connect.') })
  if (!response.ok) throw new Error('Anthropic model discovery failed. Check the key and permissions.')
  const text = await response.text()
  if (Buffer.byteLength(text) > 65536) throw new Error('Anthropic model catalog exceeds the supported limit.')
  let body: { data?: unknown[]; has_more?: boolean }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !Array.isArray(parsed.data)) throw new Error('invalid')
    body = { data: parsed.data, has_more: 'has_more' in parsed && parsed.has_more === true }
  } catch { throw new Error('Anthropic returned an invalid model catalog.') }
  if (body.has_more) throw new Error('Anthropic model catalog requires pagination beyond this setup limit.')
  const models = body.data!.flatMap((value) => { const row = value && typeof value === 'object' ? value as {id?:unknown;display_name?:unknown} : undefined; return row && typeof row.id === 'string' && /^claude-[a-z0-9.-]{1,120}$/.test(row.id) ? [{ id: row.id, name: row.id, shortName: row.id, description: 'Anthropic account catalog; inference must be validated.', provider: 'anthropic' as const, contextWindow: 0 }] : [] })
  if (!models.length) throw new Error('No Anthropic model candidate is available.')
  return { models }
}

export async function validateNativeConnection(input: { provider: string; apiKey: string; baseUrl?: string; api?: string; model?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const model = input.model ?? (await fetchNativeModels(input)).models[0]?.id
    if (!model) return { success: false, error: 'No model is available to validate.' }
    let complete = false
    for await (const event of streamMastraChat({ agentId: 'connectioncheck', name: 'Connection check', instructions: 'Reply briefly.', messages: [{ role: 'user', content: 'Reply OK only.' }], model: createMastraChatModel({ ...input, model }), signal: AbortSignal.timeout(20000) })) if (event.type === 'complete') complete = true
    return complete ? { success: true } : { success: false, error: 'The provider inference did not complete.' }
  } catch { return { success: false, error: 'Provider validation failed. Check the key, model, endpoint and selected API protocol.' } }
}

export async function validateStoredNativeConnection(connection: LlmConnection) {
  if (!isNativeConnection(connection)) return { success: false, error: NATIVE_PROVIDER_UNSUPPORTED }
  const apiKey = await getCredentialManager().getLlmApiKey(connection.slug, connection.scope)
  return validateNativeConnection({ provider: connection.type, apiKey: apiKey ?? '', baseUrl: connection.baseUrl, api: connection.customEndpoint?.api, model: connection.defaultModel })
}
