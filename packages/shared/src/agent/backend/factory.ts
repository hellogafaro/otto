/**
 * Agent factory: every chat runs on Pi (docs/pi-only-plan.md). A connection resolves to a `PiAgent` whose runtime
 * (the pi-agent-server path, the interceptor, the connection's Pi provider and endpoint) is built here.
 */

import type { BackendConfig, BackendHostRuntimeContext, CoreBackendConfig, LlmAuthType } from './types.ts';
import { PiAgent } from '../pi-agent.ts';
import {
  getLlmConnection,
  getLlmConnections,
  getDefaultLlmConnection,
  type ConnectionContext,
  type LlmConnection,
} from '../../config/storage.ts';
import type { CustomEndpointConfig } from '../../config/llm-connections.ts';
import { CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE, isCompatProvider, isValidProviderAuthCombination, piProviderOf } from '../../config/llm-connections.ts';
import type { ModelFetchResult } from '../../config/model-fetcher.ts';
import { getModelProvider, normalizeDeprecatedModelId } from '../../config/models.ts';
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getCredentialManager } from '../../credentials/index.ts';
import { CLAUDE_CODE_OWNER_ONLY, isClaudeCodeScope } from '../../connections/index.ts';
import type {
  BackendModelFetchCredentials,
  StoredConnectionValidationResult,
} from './internal/pi-runtime.ts';
import {
  resolveBackendHostTooling as resolveHostToolingPaths,
  resolveBackendRuntimePaths,
} from './internal/runtime-resolver.ts';
import { buildPiRuntime, checkProviderEndpoint, fetchPiModels, testPiConnection } from './internal/pi-runtime.ts';

/** Create the agent of a chat: always a `PiAgent`. */
export function createBackend(config: BackendConfig): PiAgent {
  return new PiAgent(config);
}

/** The auth type the agent passes on; `none` and `environment` need no credential handed over. */
function credentialAuthType(authType: LlmAuthType): LlmAuthType | undefined {
  return authType === 'none' || authType === 'environment' ? undefined : authType;
}

/**
 * Create the agent from a pre-resolved context and the session's core config.
 */
export function createBackendFromResolvedContext(args: {
  context: ResolvedBackendContext;
  coreConfig: CoreBackendConfig;
  hostRuntime: BackendHostRuntimeContext;
}): PiAgent {
  const { context, coreConfig, hostRuntime } = args;
  return createBackend({
    ...coreConfig,
    authType: context.authType ?? 'api_key',
    model: context.resolvedModel,
    connectionSlug: context.connection?.slug,
    connectionScope: context.connection?.scope,
    // A chat whose connection is a Claude subscription that is not the instance owner's own is told so, never run
    missingConnection: context.missingConnection
      ?? (context.connection?.type === CLAUDE_CODE_CONNECTION_TYPE && !isClaudeCodeScope(context.connection.scope) ? CLAUDE_CODE_OWNER_ONLY : undefined),
    runtime: buildPiRuntime(context.connection, resolveBackendRuntimePaths(hostRuntime)),
  });
}

/**
 * Resolve backend-managed host tooling paths (e.g. ripgrep) from generic host runtime metadata.
 */
export function resolveBackendHostTooling(args: {
  hostRuntime: BackendHostRuntimeContext;
}): {
  ripgrepPath?: string;
} {
  return resolveHostToolingPaths(args.hostRuntime);
}

// ============================================================
// LLM Connection Support
// ============================================================

/**
 * Get LLM connection for a session.
 * Resolution order: session.llmConnection > workspace.defaults.defaultLlmConnection > global default
 *
 * @param sessionConnection - Connection slug from session (may be undefined)
 * @param workspaceDefaultConnection - Workspace default connection (may be undefined)
 * @returns The resolved LLM connection or null if not found
 */
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

/**
 * The connection shape a setup-time test runs with: a custom endpoint (base URL and protocol) is `custom`,
 * anything else the Pi provider it names.
 */
export function resolveSetupTestConnectionHint(args: {
  baseUrl?: string;
  type?: string;
  customEndpoint?: CustomEndpointConfig;
}): Pick<LlmConnection, 'type' | 'customEndpoint'> {
  if (args.customEndpoint && args.baseUrl?.trim()) {
    return { type: CUSTOM_CONNECTION_TYPE, customEndpoint: args.customEndpoint };
  }
  return { type: args.type ?? '' };
}

/**
 * Model discovery for model refresh flows: Copilot's live list, else Pi's catalog for the connection's provider.
 */
export async function fetchBackendModels(args: {
  connection: LlmConnection;
  credentials: BackendModelFetchCredentials;
  timeoutMs?: number;
}): Promise<ModelFetchResult> {
  return fetchPiModels(args.connection, args.credentials, args.timeoutMs ?? 30_000);
}

/**
 * Stored-connection validation: the connection holds what its auth type needs, an OAuth sign-in has not lapsed,
 * and an API provider answers its models list with the stored key (no network for OAuth). A `claude-code`
 * connection is checked by the RPC handler (it runs the server's own `claude`).
 */
export async function validateStoredBackendConnection(args: {
  slug: string;
  where?: ConnectionContext;
}): Promise<StoredConnectionValidationResult> {
  try {
    const connection = getLlmConnection(args.slug, args.where);
    if (!connection) {
      return { success: false, error: 'Connection not found' };
    }

    const cm = getCredentialManager();
    if (connection.authType === 'oauth') {
      const oauth = await cm.getLlmOAuth(args.slug, connection.scope);
      if (!oauth) return { success: false, error: 'No credentials configured' };
      // An expired token with a refresh token is renewed when Pi connects
      if (oauth.expiresAt && oauth.expiresAt <= Date.now() && !oauth.refreshToken) {
        return { success: false, error: 'Sign-in expired. Sign in again.' };
      }
      return { success: true };
    }

    if (!(await cm.hasLlmCredentials(args.slug, connection.authType, connection.scope))) {
      return { success: false, error: 'No credentials configured' };
    }
    const apiKey = await cm.getLlmApiKey(args.slug, connection.scope);
    return (await checkProviderEndpoint(connection, apiKey)) ?? { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Create the agent from an LLM connection slug.
 *
 * @throws Error if connection not found or has invalid provider-auth combination
 */
export function createBackendFromConnection(
  connectionSlug: string,
  baseConfig: CoreBackendConfig,
  hostRuntime: BackendHostRuntimeContext,
  where?: ConnectionContext,
): PiAgent {
  const connection = getLlmConnection(connectionSlug, { workspaceId: baseConfig.workspace?.id, ...where });
  if (!connection) {
    throw new Error(`LLM connection not found: ${connectionSlug}`);
  }

  // Validate provider-auth combination before creating backend
  // This catches invalid configurations early with a clear error message
  if (!isValidProviderAuthCombination(connection.type, connection.authType)) {
    throw new Error(
      `Invalid LLM connection configuration: provider '${connection.type}' ` +
      `does not support auth type '${connection.authType}'. ` +
      `Please update the connection settings for '${connection.name}'.`
    );
  }

  return createBackendFromResolvedContext({
    context: {
      connection,
      authType: credentialAuthType(connection.authType),
      resolvedModel: resolveModel(baseConfig.model, connection),
    },
    coreConfig: baseConfig,
    hostRuntime,
  });
}

// ============================================================
// Model Resolution
// ============================================================

/**
 * The model a session runs: its own when the connection lists it, else the connection's default (else its first
 * model, else '' and Pi picks). A model of the removed Claude backend (a bare Claude id) is never sent to Pi.
 *
 * @param managedModel - The model stored on the session (user's choice)
 * @param connection - The LLM connection config (has defaultModel and models[])
 */
export function resolveModel(
  managedModel: string | undefined,
  connection: LlmConnection | null
): string {
  if (managedModel) {
    managedModel = normalizeDeprecatedModelId(managedModel);
    const modelProvider = getModelProvider(managedModel);
    if (modelProvider && modelProvider !== 'pi') {
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

// ============================================================
// Runtime Artifact Helpers
// ============================================================

/**
 * Remove backend runtime artifacts for disabled sources.
 * Currently removes bridge credential cache files in source directories.
 */
export async function cleanupSourceRuntimeArtifacts(
  workspaceRootPath: string,
  disabledSourceSlugs: string[],
): Promise<void> {
  for (const sourceSlug of disabledSourceSlugs) {
    const cachePath = join(workspaceRootPath, 'sources', sourceSlug, '.credential-cache.json');
    await rm(cachePath, { force: true });
  }
}

// ============================================================
// Connection Testing
// ============================================================

/**
 * Test a key before a connection is saved: a direct request for Anthropic-protocol providers, else one mini
 * completion through a throwaway Pi subprocess.
 */
export async function testBackendConnection(args: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  hostRuntime: BackendHostRuntimeContext;
  timeoutMs?: number;
  allowEmptyApiKey?: boolean;
  connection?: Pick<LlmConnection, 'type' | 'customEndpoint'>;
}): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = args.apiKey.trim();
  if (!trimmedKey && !args.allowEmptyApiKey) {
    return { success: false, error: 'API key is required' };
  }

  const tempSlug = `__test-${Date.now()}`;
  const cm = getCredentialManager();
  if (trimmedKey) {
    await cm.setLlmApiKey(tempSlug, trimmedKey);
  }

  try {
    const testModel = args.model;
    const type = args.connection?.type ?? '';
    const now = Date.now();
    const authType: LlmAuthType = isCompatProvider(type) ? 'api_key_with_endpoint' : 'api_key';

    const syntheticConnection: LlmConnection = {
      slug: tempSlug,
      name: 'Temporary Connection Test',
      type,
      authType,
      defaultModel: testModel,
      createdAt: now,
      customEndpoint: args.connection?.customEndpoint,
      ...(args.baseUrl?.trim() ? { baseUrl: args.baseUrl.trim() } : {}),
    };

    const direct = await testPiConnection({
      apiKey: trimmedKey,
      model: testModel,
      baseUrl: args.baseUrl,
      piAuthProvider: piProviderOf(syntheticConnection),
      timeoutMs: args.timeoutMs ?? 20000,
    });
    // null = no direct test for this provider; fall through to the subprocess test
    if (direct !== null) return direct;

    const cwd = homedir();
    const agent = createBackendFromResolvedContext({
      context: { connection: syntheticConnection, authType, resolvedModel: testModel },
      coreConfig: {
        workspace: { id: '__test', name: 'Connection Test', slug: '__test', rootPath: cwd, createdAt: 0 },
        session: { id: `test-${now}`, workspaceRootPath: cwd, createdAt: 0, lastUsedAt: 0 },
        isHeadless: true,
        miniModel: testModel,
      },
      hostRuntime: args.hostRuntime,
    });

    const withStderrContext = (message: string): string => {
      const stderr = agent.getRecentStderr();
      if (!stderr) return `${message} (subprocess produced no stderr output)`;
      return `${message}\n--- subprocess stderr (last ~8KB) ---\n${stderr}`;
    };

    try {
      const timeoutMs = args.timeoutMs ?? 20000;
      const text = await Promise.race([
        agent.runMiniCompletion('Say ok'),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(withStderrContext(`Connection test timed out after ${timeoutMs}ms`))),
            timeoutMs
          )
        ),
      ]);

      return text
        ? { success: true }
        : { success: false, error: 'No response from provider. Check your API key.' };
    } catch (error) {
      const base = error instanceof Error ? error.message : String(error);
      // Avoid double-appending if the timeout branch already included stderr context.
      const enriched = base.includes('subprocess stderr') ? base : withStderrContext(base);
      return { success: false, error: enriched };
    } finally {
      agent.destroy();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await cm.deleteLlmApiKey(tempSlug).catch(() => {});
  }
}
