/**
 * What the person can connect, and the small pure rules of its setup form: the slug of a new connection, the
 * model list typed for a custom endpoint, and whether a base URL is on this machine. The steps own the rest.
 */

import { CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE } from '@config/llm-connections'
import type { LlmConnectionSetup, TestLlmConnectionParams } from '../../../shared/types'

/**
 * The five things the setup offers, in this order. `github-copilot` is only ever a re-sign-in of a connection that
 * already exists (an imported one): it is never offered as new.
 */
export type OfferedKind = 'claude-code' | 'anthropic' | 'openai-codex' | 'provider' | 'custom'
export type ConnectionKind = OfferedKind | 'github-copilot'

export const OFFERED_KINDS: readonly OfferedKind[] = ['claude-code', 'anthropic', 'openai-codex', 'provider', 'custom']

/** The Pi provider id of a new connection of this kind (`provider` is whichever the person picks). */
export function typeOfKind(kind: ConnectionKind, provider?: string): string {
  if (kind === 'provider') return provider ?? ''
  if (kind === 'custom') return CUSTOM_CONNECTION_TYPE
  return kind === 'claude-code' ? CLAUDE_CODE_CONNECTION_TYPE : kind
}

/** A slug no connection the person sees has yet: `base`, then `base-2`, `base-3`. */
export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** The models typed for a custom endpoint: comma or line separated, trimmed, without repeats. */
export function parseModelList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((m) => m.trim()).filter(Boolean))]
}

/** Whether a base URL parses as http(s). */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Whether a base URL is on this machine, where a key is optional (Ollama, LM Studio). */
export function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/** What a key form asks for. */
export interface KeyFormValues {
  /** The provider of the `provider` kind. */
  provider: string
  /** The name of a custom endpoint. */
  name: string
  baseUrl: string
  api: 'openai-completions' | 'anthropic-messages'
  apiKey: string
  /** The custom endpoint's models, comma separated: the first is the default. */
  models: string
  scope: 'user' | 'workspace'
}

/**
 * The key test and the setup of a key form: an Anthropic API key, a provider's key (named `providerLabel`), or a
 * custom endpoint (its protocol, base URL, key, models; the first model is the default and the one the test runs).
 */
export function keySetup(
  kind: 'anthropic' | 'provider' | 'custom',
  values: KeyFormValues,
  options: { slug: string; title: string },
): { test: TestLlmConnectionParams; setup: LlmConnectionSetup } {
  const apiKey = values.apiKey.trim()
  const { slug, title } = options
  if (kind === 'custom') {
    const models = parseModelList(values.models)
    return {
      test: { type: CUSTOM_CONNECTION_TYPE, apiKey, baseUrl: values.baseUrl.trim(), model: models[0], customEndpoint: { api: values.api } },
      setup: {
        slug,
        type: CUSTOM_CONNECTION_TYPE,
        title,
        scope: values.scope,
        baseUrl: values.baseUrl.trim(),
        customEndpoint: { api: values.api },
        ...(apiKey ? { credential: apiKey } : {}),
        models,
        defaultModel: models[0],
      },
    }
  }
  const type = typeOfKind(kind, values.provider)
  return { test: { type, apiKey }, setup: { slug, type, title, scope: values.scope, credential: apiKey } }
}
