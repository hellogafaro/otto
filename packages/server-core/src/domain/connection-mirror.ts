import type { LlmConnection } from '@otto/shared/config'
import { isLocalConnection } from '@otto/shared/config'
import type { ConnectionType } from '@otto/shared/connections'
import type { CredentialManager } from '@otto/shared/credentials'

/**
 * Bridge: Otto's LLM connections (config.json + credential manager) are mirrored
 * into the `connections` domain whenever one is set up, re-authenticated or
 * deleted. Sessions and Pi still read the old store; remove this file when they
 * read `connections` directly.
 */

/** The catalog type an Otto connection corresponds to. */
export function connectionTypeFor(
  connection: Pick<LlmConnection, 'providerType' | 'authType' | 'piAuthProvider' | 'baseUrl'>,
): ConnectionType {
  const { providerType, authType, piAuthProvider } = connection
  if (isLocalConnection(connection)) return 'ollama'
  if (authType === 'oauth') {
    if (providerType === 'anthropic') return 'claude'
    if (piAuthProvider === 'openai-codex') return 'chatgpt'
    if (piAuthProvider === 'github-copilot') return 'copilot'
  }
  const provider = piAuthProvider ?? providerType
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'openai') return 'openai'
  if (provider === 'openrouter') return 'openrouter'
  return 'custom'
}

type SecretSource = Pick<
  CredentialManager,
  'getLlmOAuth' | 'getLlmApiKey' | 'getLlmIamCredentials' | 'getLlmServiceAccount'
>

/** The credential Otto holds for a connection, as one string (JSON for structured ones). */
export async function readConnectionSecret(
  connection: Pick<LlmConnection, 'slug' | 'authType'>,
  manager: SecretSource,
): Promise<string | undefined> {
  const { slug, authType } = connection
  switch (authType) {
    case 'oauth': {
      const oauth = await manager.getLlmOAuth(slug)
      return oauth ? JSON.stringify(oauth) : undefined
    }
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token':
      return (await manager.getLlmApiKey(slug)) ?? undefined
    case 'iam_credentials': {
      const iam = await manager.getLlmIamCredentials(slug)
      return iam ? JSON.stringify(iam) : undefined
    }
    case 'service_account_file': {
      const account = await manager.getLlmServiceAccount(slug)
      return account ? JSON.stringify(account) : undefined
    }
    default:
      return undefined
  }
}

/** Create or update the `connections` row for an Otto connection. */
export async function mirrorConnection(connection: LlmConnection, manager: SecretSource): Promise<void> {
  const { createConnection, updateConnection, getConnectionBySlug } = await import('@otto/shared/connections')
  const secret = await readConnectionSecret(connection, manager)
  const existing = getConnectionBySlug(connection.slug)
  if (existing) {
    updateConnection(existing.id, { title: connection.name, baseUrl: connection.baseUrl, secret })
  } else {
    createConnection({
      type: connectionTypeFor(connection),
      slug: connection.slug,
      title: connection.name,
      baseUrl: connection.baseUrl,
      secret,
    })
  }
}

/** Remove the mirrored row (and its secret) for an Otto connection slug. */
export async function unmirrorConnection(slug: string): Promise<void> {
  const { getConnectionBySlug, deleteConnection } = await import('@otto/shared/connections')
  const existing = getConnectionBySlug(slug)
  if (existing) deleteConnection(existing.id)
}
