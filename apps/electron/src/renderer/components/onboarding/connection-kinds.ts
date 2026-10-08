/**
 * What the person can connect, and the small pure rules of its setup form: the slug of a new connection, the
 * API-key setup payload, and whether a saved endpoint address is valid. The steps own the rest.
 */

import type { LlmConnectionSetup, TestLlmConnectionParams } from '../../../shared/types'

export type ConnectionKind = 'openai'
export type OfferedKind = ConnectionKind

export const OFFERED_KINDS: readonly OfferedKind[] = ['openai']
export const OPENAI_LABEL = 'OpenAI'

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
    const { protocol } = new URL(value.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** What a key form asks for. */
export interface KeyFormValues {
  apiKey: string
  scope: 'user' | 'workspace'
}

export function keySetup(
  kind: ConnectionKind,
  values: KeyFormValues,
  options: { slug: string; title: string },
): { test: TestLlmConnectionParams; setup: LlmConnectionSetup } {
  const apiKey = values.apiKey.trim()
  const { slug, title } = options
  return { test: { type: kind, apiKey }, setup: { slug, type: kind, title, scope: values.scope, credential: apiKey } }
}
