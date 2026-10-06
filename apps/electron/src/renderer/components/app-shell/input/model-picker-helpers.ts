import {
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'
import { BACKEND_NAME } from '@otto/shared/branding'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    'Local': [],
    [BACKEND_NAME]: [],
  }
  for (const conn of connections) {
    // Claude: an Anthropic API key or a Claude subscription (Pi's anthropic and claude-code providers)
    if (conn.providerType === 'pi' && (conn.piAuthProvider === 'anthropic' || conn.piAuthProvider === 'claude-code')) {
      groups['Anthropic'].push(conn)
    } else if (conn.providerType === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else {
      groups[BACKEND_NAME].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
