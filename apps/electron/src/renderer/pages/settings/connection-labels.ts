/**
 * What Settings -> AI calls a connection and whose it is: its kind ("Claude subscription", "OpenRouter", "Custom
 * endpoint · localhost:11434") and its scope (Personal, Workspace, Server), plus who may change it. Pure, so it is
 * unit-tested.
 */

import type { TFunction } from 'i18next'
import { CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE, type LlmConnection } from '@config/llm-connections'
import { getProviderMetadata } from '@config/provider-metadata'
import { getModelShortName, type ModelDefinition } from '@config/models'

export type ConnectionScopeKind = 'user' | 'workspace' | 'install'

/** The scope kind of a connection: `user:<id>` is personal, `workspace:<id>` shared by its members, `install` the server's. */
export function scopeKindOf(scope: string | undefined): ConnectionScopeKind {
  if (scope?.startsWith('user:')) return 'user'
  return scope?.startsWith('workspace:') ? 'workspace' : 'install'
}

export const scopeLabel = (scope: string | undefined, t: TFunction): string => t(`connections.scope.${scopeKindOf(scope)}`)

/** The host of a base URL ("localhost:11434"), else the text as typed. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** "Claude subscription", "Anthropic API", "ChatGPT", a provider's name, or "Custom endpoint · host". */
export function connectionKindLabel(connection: Pick<LlmConnection, 'type' | 'baseUrl' | 'customEndpoint'>, t: TFunction): string {
  switch (connection.type) {
    case CLAUDE_CODE_CONNECTION_TYPE:
      return t('connections.kind.claudeCode')
    case 'anthropic':
      return t('connections.kind.anthropic')
    case 'openai-codex':
      return t('connections.kind.chatgpt')
    case CUSTOM_CONNECTION_TYPE: {
      const protocol = connection.customEndpoint?.api === 'openai-responses' ? 'Responses API'
        : connection.customEndpoint?.api === 'openai-completions' ? 'Chat Completions API' : undefined
      return ['OpenAI', protocol, connection.baseUrl ? hostOf(connection.baseUrl) : undefined].filter(Boolean).join(' · ')
    }
    default:
      return getProviderMetadata(connection.type)?.name ?? connection.type
  }
}

/** Personal connections first (the person's own are what they use), then the workspace's, then the server's; each by name. */
export function sortConnections<T extends Pick<LlmConnection, 'name' | 'scope'>>(connections: readonly T[]): T[] {
  const order: Record<ConnectionScopeKind, number> = { user: 0, workspace: 1, install: 2 }
  return [...connections].sort((a, b) => order[scopeKindOf(a.scope)] - order[scopeKindOf(b.scope)] || a.name.localeCompare(b.name))
}

/** Whether the person may change a connection: their own always, a shared one (workspace or server) only as an owner. */
export const canEditConnection = (connection: Pick<LlmConnection, 'scope'>, isOwner: boolean): boolean =>
  scopeKindOf(connection.scope) === 'user' || (scopeKindOf(connection.scope) === 'workspace' && isOwner)

export function groupConnections<T extends Pick<LlmConnection, 'name' | 'scope'>>(connections: readonly T[]): { user: T[]; shared: T[] } {
  const rows = sortConnections(connections)
  return { user: rows.filter((connection) => scopeKindOf(connection.scope) === 'user'), shared: rows.filter((connection) => scopeKindOf(connection.scope) !== 'user') }
}

/**
 * Derive model dropdown options from a connection's models array,
 * falling back to the registry models of the connection's type.
 */
export function getModelOptionsForConnection(
  connection: Pick<LlmConnection, 'type' | 'models'> | undefined,
): Array<{ value: string; label: string; description: string; descriptionKey?: string }> {
  if (!connection) return []

  // If connection has explicit models, use those
  if (connection.models && connection.models.length > 0) {
    return connection.models.map((m) => {
      if (typeof m === 'string') {
        return { value: m, label: getModelShortName(m), description: '' }
      }
      // ModelDefinition object
      const def = m as ModelDefinition
      return { value: def.id, label: def.name, description: def.description, descriptionKey: def.descriptionKey }
    })
  }

  // Fall back to registry models for this connection type
  return []
}
