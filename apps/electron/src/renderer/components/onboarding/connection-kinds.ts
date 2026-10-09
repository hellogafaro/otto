/**
 * What the person can connect, and the small pure rules of its setup form: the slug of a new connection, the
 * API-key setup payload, and whether a saved endpoint address is valid. The steps own the rest.
 */

import type { LlmConnectionSetup, TestLlmConnectionParams } from '../../../shared/types'

export type ConnectionKind = 'openai' | 'custom' | 'anthropic'
export type OfferedKind = 'openai' | 'anthropic'

export const OFFERED_KINDS: readonly OfferedKind[] = ['openai', 'anthropic']
export const OPENAI_LABEL = 'OpenAI'

export function connectionKindName(kind: ConnectionKind): string {
  switch (kind) {
    case 'openai': return OPENAI_LABEL
    case 'custom': return OPENAI_LABEL
    case 'anthropic': return 'Anthropic'
  }
}

/** A slug no connection the person sees has yet: `base`, then `base-2`, `base-3`. */
export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Whether a base URL parses as http(s). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

/** What a key form asks for. */
export interface KeyFormValues {
  apiKey: string
  scope: 'user' | 'workspace'
  baseUrl?: string
  api?: 'openai-responses' | 'openai-completions'
  model?: string
}

export function keySetup(
  kind: ConnectionKind,
  values: KeyFormValues,
  options: { slug: string; title: string },
): { test: TestLlmConnectionParams; setup: LlmConnectionSetup } {
  const apiKey = values.apiKey.trim()
  const { slug, title } = options
  const type = kind === 'anthropic' ? 'anthropic' : 'openai'
  const baseUrl = values.baseUrl?.trim() || (type === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1')
  const customEndpoint = type === 'openai' ? { api: values.api ?? 'openai-responses' } : { api: 'anthropic-messages' as const }
  const model = values.model?.trim()
  return {
    test: { type, apiKey, baseUrl, customEndpoint, ...(model ? { model } : {}) },
    setup: { slug, type, title, scope: values.scope, credential: apiKey, baseUrl, customEndpoint, ...(model ? { defaultModel: model } : {}) },
  }
}
