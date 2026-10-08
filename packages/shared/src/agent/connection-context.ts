import { getLlmConnection, getLlmConnections, getDefaultLlmConnection, type ConnectionContext, type LlmConnection } from '../config/storage.ts'
import { CUSTOM_CONNECTION_TYPE, type LlmAuthType } from '../config/llm-connections.ts'
import { getModelProvider, normalizeDeprecatedModelId } from '../config/models.ts'

const credentialAuthType = (authType: LlmAuthType) => authType === 'none' || authType === 'environment' ? undefined : authType

export function resolveSessionConnection(
  sessionConnection?: string,
  workspaceDefaultConnection?: string,
  where?: ConnectionContext,
  /** The chat agent's provider: only a connection of it (the same order among them); none = null. */
  provider?: string,
): LlmConnection | null {
  if (provider) {
    const ofProvider = getLlmConnections(where).filter((connection) => connection.type === provider);
    const named = (slug?: string | null) => (slug ? ofProvider.find((connection) => connection.slug === slug) : undefined);
    return named(sessionConnection) ?? named(workspaceDefaultConnection) ?? named(getDefaultLlmConnection(where)) ?? ofProvider[0] ?? null;
  }

  // 1. Session-level connection (locked after first message)
  if (sessionConnection) {
    const connection = getLlmConnection(sessionConnection, where);
    if (connection) return connection;
  }

  // 2. Workspace default
  if (workspaceDefaultConnection) {
    const connection = getLlmConnection(workspaceDefaultConnection, where);
    if (connection) return connection;
  }

  // 3. Global default
  const defaultSlug = getDefaultLlmConnection(where);
  if (!defaultSlug) return null;
  return getLlmConnection(defaultSlug, where);
}

/** A session's connection, the auth type its agent uses and the model it runs. */
export interface ResolvedBackendContext {
  connection: LlmConnection | null;
  authType?: LlmAuthType;
  resolvedModel: string;
  /** The chat's agent names a provider its creator has no connection of: what the person is told. */
  missingConnection?: string;
}

/** The chat's agent as it picks the connection and model (docs/final-plan.md 2.2): a Pi provider id and its model. */
export interface BackendAgent {
  title: string;
  provider: string;
  model?: string | null;
}

/** An agent's provider as a connection `type`; rows written before Pi only may name `pi_compat` or `pi` (no constraint). */
function agentProvider(provider: string): string | undefined {
  if (provider === 'pi_compat') return CUSTOM_CONNECTION_TYPE;
  return provider && provider !== 'pi' ? provider : undefined;
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'openai-codex': 'ChatGPT',
  'github-copilot': 'GitHub Copilot',
  custom: 'a custom endpoint',
};

const providerLabel = (provider: string) =>
  PROVIDER_LABELS[provider] ?? provider.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/**
 * Resolve connection, auth and model in one call.
 */
export function resolveBackendContext(args: {
  sessionConnectionSlug?: string;
  workspaceDefaultConnectionSlug?: string;
  managedModel?: string;
  /** Whose connections are looked at: the chat's creator's own, then the workspace's, then the install's. */
  where?: ConnectionContext;
  /** The chat's agent: only a connection of its provider; its model when the chat has none of its own. */
  agent?: BackendAgent | null;
}): ResolvedBackendContext {
  const provider = args.agent ? agentProvider(args.agent.provider) : undefined;
  const connection = resolveSessionConnection(
    args.sessionConnectionSlug,
    args.workspaceDefaultConnectionSlug,
    args.where,
    provider,
  );
  return {
    connection,
    authType: connection ? credentialAuthType(connection.authType) : undefined,
    resolvedModel: resolveModel(args.managedModel || args.agent?.model || undefined, connection),
    ...(!connection && provider && args.agent ? { missingConnection: `Connect ${providerLabel(provider)} to talk to ${args.agent.title}.` } : {}),
  };
}

export function resolveModel(
  managedModel: string | undefined,
  connection: LlmConnection | null
): string {
  if (managedModel) {
    managedModel = normalizeDeprecatedModelId(managedModel);
    const modelProvider = getModelProvider(managedModel);
    if (modelProvider && modelProvider !== 'pi' && modelProvider !== 'openai' && modelProvider !== 'anthropic' && connection?.type !== 'custom') {
      managedModel = undefined; // Clear — will fall through to connection default
    }
  }

  let connectionDefault = connection?.defaultModel
    ? normalizeDeprecatedModelId(connection.defaultModel)
    : undefined;

  if (connection?.models?.length) {
    const connectionModelIds = connection.models.map(m => typeof m === 'string' ? m : m.id);
    if (managedModel && !connectionModelIds.includes(managedModel)) {
      managedModel = undefined;
    }
    if (connectionDefault && !connectionModelIds.includes(connectionDefault)) {
      connectionDefault = connectionModelIds[0];
    }
  }

  return managedModel || connectionDefault || '';
}
