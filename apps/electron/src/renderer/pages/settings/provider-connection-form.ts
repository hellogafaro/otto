import type { LlmConnectionWithStatus } from '../../../shared/types'
import type { KeyFormValues } from '@/components/onboarding/connection-kinds'
import type { LlmConnectionSelector } from '@otto/shared/protocol'
import { scopeKindOf } from './connection-labels'

export type ProviderFamily = 'openai' | 'anthropic'
export const PROVIDER_FAMILIES: readonly ProviderFamily[] = ['openai', 'anthropic']

export function providerFamily(connection: Pick<LlmConnectionWithStatus, 'type'>): ProviderFamily | null {
  if (connection.type === 'openai' || connection.type === 'custom') return 'openai'
  return connection.type === 'anthropic' ? 'anthropic' : null
}

export function providerFormDefaults(family: ProviderFamily, connection?: LlmConnectionWithStatus) {
  return {
    apiKey: '',
    baseUrl: connection?.baseUrl ?? (family === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'),
    api: connection?.customEndpoint?.api ?? (family === 'openai' ? 'openai-responses' : 'anthropic-messages'),
    model: connection?.defaultModel ?? '',
  }
}

export function endpointOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function needsStoredKeyConsent(connection: Pick<LlmConnectionWithStatus, 'baseUrl' | 'type'>, baseUrl: string, apiKey: string): boolean {
  if (apiKey.trim()) return false
  const current = connection.baseUrl ?? (connection.type === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')
  return endpointOrigin(current) !== endpointOrigin(baseUrl)
}

export function bindAddScope(values: KeyFormValues, scope: 'user' | 'workspace'): KeyFormValues {
  return { ...values, scope }
}

export function connectionSelector(connection: LlmConnectionWithStatus): LlmConnectionSelector {
  if (!connection.id) throw new Error('Reload this connection before using its saved identity.')
  return { slug: connection.slug, connectionId: connection.id, scope: scopeKindOf(connection.scope), expectedUpdatedAt: connection.updatedAt }
}

export function connectionChoiceId(connection: LlmConnectionWithStatus): string {
  return connection.id ?? `${connection.scope}:${connection.slug}`
}

export function endpointSetup(connection: LlmConnectionWithStatus, values: { baseUrl: string; apiKey: string; api: string; model?: string; approvedCredentialOrigin: string }) {
  if (!connection.id) throw new Error('Reload this connection before editing its endpoint.')
  const baseUrl = values.baseUrl.trim()
  const origin = endpointOrigin(baseUrl)
  if (!origin) throw new Error('Enter an HTTP(S) base URL without credentials, queries or a fragment.')
  const apiKey = values.apiKey.trim()
  const consent = needsStoredKeyConsent(connection, baseUrl, apiKey)
  if (consent && values.approvedCredentialOrigin !== origin) throw new Error('Approve sending the stored key to this exact endpoint origin.')
  const family = providerFamily(connection)
  if (!family || family === 'openai' && !['openai-responses', 'openai-completions'].includes(values.api) || family === 'anthropic' && values.api !== 'anthropic-messages') throw new Error('Choose a supported provider protocol.')
  const customEndpoint = { ...connection.customEndpoint, api: values.api as NonNullable<LlmConnectionWithStatus['customEndpoint']>['api'] }
  const identity = connectionSelector(connection)
  const approvedCredentialOrigin = consent ? origin : undefined
  const model = values.model !== undefined ? values.model.trim() || undefined : connection.defaultModel
  return {
    test: { ...identity, type: family, baseUrl, customEndpoint, ...(values.model !== undefined ? { model: model ?? '' } : model ? { model } : {}), ...(apiKey ? { apiKey } : {}), approvedCredentialOrigin },
    setup: { ...identity, type: family, updateOnly: true, baseUrl, customEndpoint, ...(values.model !== undefined ? { defaultModel: model ?? null } : model ? { defaultModel: model } : {}), ...(apiKey ? { credential: apiKey } : {}), approvedCredentialOrigin },
  }
}
