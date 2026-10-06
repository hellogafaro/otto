import {
  CLAUDE_CODE_CONNECTION_TYPE,
  isCompatProvider,
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'

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

export type ConnectionGroup = 'anthropic' | 'local' | 'other'

/**
 * Group connections for hierarchical picker rendering.
 * Each group can contain multiple connections (API key, subscription, …).
 * Order is significant for UI: Anthropic, Local, Other.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[ConnectionGroup, T[]]> {
  const groups: Record<ConnectionGroup, T[]> = { anthropic: [], local: [], other: [] }
  for (const conn of connections) {
    // Claude: an Anthropic API key or a Claude subscription
    if (conn.type === 'anthropic' || conn.type === CLAUDE_CODE_CONNECTION_TYPE) {
      groups.anthropic.push(conn)
    } else if (isCompatProvider(conn.type) && isLocalConnection(conn)) {
      groups.local.push(conn)
    } else {
      groups.other.push(conn)
    }
  }
  return (Object.entries(groups) as Array<[ConnectionGroup, T[]]>).filter(([, conns]) => conns.length > 0)
}
