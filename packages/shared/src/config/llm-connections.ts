/**
 * LLM Connections
 *
 * Named provider configurations that users can add, configure, and switch between.
 * Each session locks to a specific connection after the first message.
 * Workspaces can set a default connection.
 */

import { type ModelDefinition, normalizeDeprecatedModelId } from './models';

// ============================================================
// Types
// ============================================================

/** The `type` of a connection to an endpoint of the user's own (Ollama, vLLM, a proxy): Pi's `custom-endpoint` provider. */
export const CUSTOM_CONNECTION_TYPE = 'custom';

/** The `type` of a Claude subscription: the user's own `claude` CLI and its login, through pi-agent-server's bridge. No secret. */
export const CLAUDE_CODE_CONNECTION_TYPE = 'claude-code';

/**
 * Authentication mechanism for the connection.
 * Determines the UI pattern, credential storage format, and how credentials are passed.
 *
 * Simple token auth:
 * - 'api_key': Single API key field, fixed endpoint known
 * - 'api_key_with_endpoint': API key + custom endpoint URL fields
 * - 'bearer_token': Single bearer token (different header than API key)
 *
 * OAuth flows (browser redirect):
 * - 'oauth': Browser or device-code sign-in, the provider is the connection's `type`
 *
 * Cloud provider auth:
 * - 'iam_credentials': AWS-style (Access Key + Secret Key + Region)
 * - 'service_account_file': GCP-style JSON file upload
 * - 'environment': Auto-detect from environment variables
 *
 * No auth:
 * - 'none': No authentication required (local models like Ollama)
 * - 'cli_login': The user's own CLI sign-in (a Claude subscription through `claude`); Otto holds no secret
 */
export type LlmAuthType =
  | 'cli_login'
  | 'api_key'
  | 'api_key_with_endpoint'
  | 'oauth'
  | 'iam_credentials'
  | 'bearer_token'
  | 'service_account_file'
  | 'environment'
  | 'none';

/**
 * Protocol for custom API endpoints.
 * Determines the native API contract; legacy unsupported values remain readable.
 */
export type CustomEndpointApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

/**
 * Custom endpoint protocol config.
 * Set when user configures an arbitrary API endpoint (Ollama, DashScope, vLLM, etc.).
 */
export interface CustomEndpointConfig {
  api: CustomEndpointApi;
  /** Explicit capability hint for arbitrary endpoints — never guessed automatically. */
  supportsImages?: boolean;
}

/**
 * Per-connection behavior when the user sends a message while the agent is
 * still streaming/processing a previous turn.
 *
 * - 'steer': Try to deliver the message into the in-flight turn (Pi's native
 *   `.steer()` or Claude's PreToolUse `additionalContext` hook). Falls back to
 *   abort+queue when the backend can't steer.
 * - 'queue': Hold the message; let the current turn finish naturally; replay
 *   as a new turn afterwards. No abort, no destructive interruption.
 *
 * Default is {@link defaultMidStreamBehavior}; reads
 * everywhere should go through {@link resolveMidStreamBehavior} so connections
 * created before this field existed still pick up the right default.
 */
export type MidStreamBehavior = 'steer' | 'queue';

/**
 * LLM Connection configuration.
 * Stored in config.llmConnections array.
 */
export interface LlmConnection {
  /** URL-safe identifier (e.g., 'anthropic-api', 'ollama-local') */
  slug: string;

  /** Display name shown in UI (e.g., 'Anthropic (API Key)', 'Ollama') */
  name: string;

  /** The Pi provider id (`anthropic`, `claude-code`, `openai-codex`, `openrouter`, ...), or `custom` for an endpoint of the user's own */
  type: string;

  /** Custom base URL (required for *_compat providers, optional override for others) */
  baseUrl?: string;

  /** Authentication mechanism */
  authType: LlmAuthType;

  /** Override available models (for custom endpoints that don't support model listing) */
  models?: Array<ModelDefinition | string>;

  /** Default model for this connection */
  defaultModel?: string;

  /**
   * Custom endpoint protocol config.
   * Set when user configures an arbitrary API endpoint (Ollama, DashScope, vLLM, etc.).
   * Determines which streaming adapter the Pi SDK uses for requests.
   */
  customEndpoint?: CustomEndpointConfig;

  /**
   * Behavior when the user sends a message while the agent is still streaming.
   * Optional for backward compat with config.json from before this field existed —
   * read via {@link resolveMidStreamBehavior} which falls back to a per-provider
   * default ({@link defaultMidStreamBehavior}).
   */
  midStreamBehavior?: MidStreamBehavior;

  // --- Timestamps ---

  /** Whose it is: 'install', 'workspace:<id>' or 'user:<id>' (set when it is read; a connection never changes scope). */
  scope?: string;

  /** Timestamp when connection was created */
  createdAt: number;
}

/**
 * LLM Connection with authentication status.
 * Used by UI to show which connections are ready to use.
 */
export interface LlmConnectionWithStatus extends LlmConnection {
  runtimeSupported?: boolean;
  /** Whether the connection has valid credentials */
  isAuthenticated: boolean;

  /** Error message if authentication check failed */
  authError?: string;

  /** Whether this is the global default connection */
  isDefault?: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * The Pi provider a connection's credential belongs to: its `type`, except a custom endpoint, which speaks one of
 * the two protocols (`openai` or `anthropic`) and has no provider without a key.
 */
export function piProviderOf(connection: Pick<LlmConnection, 'type' | 'authType' | 'customEndpoint'>): string | undefined {
  if (connection.type !== CUSTOM_CONNECTION_TYPE) return connection.type;
  if (connection.authType === 'none') return undefined;
  return connection.customEndpoint?.api === 'anthropic-messages' ? 'anthropic' : 'openai';
}

/**
 * Returns true when `modelId` must NOT be used as the mini/summarization model
 * given the current auth flavor.
 *
 * - `codex-mini-latest` is always denied (Pi SDK rejects it outright).
 * - When the provider is `openai-codex` (ChatGPT Plus/Pro OAuth or
 *   ChatGPT-JWT API key), all `*codex-mini*` variants (e.g. `gpt-5.1-codex-mini`)
 *   are denied — the ChatGPT backend refuses them with: "The '<model>' model is
 *   not supported when using Codex with a ChatGPT account."
 *   A regular OpenAI API key uses provider `'openai'`, which is unaffected.
 */
export function isDeniedMiniModelId(modelId: string, provider?: string): boolean {
  const bare = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;
  if (bare === 'codex-mini-latest') return true;
  if (provider === 'openai-codex' && bare.includes('codex-mini')) return true;
  return false;
}

/**
 * Get the mini/utility model ID for a connection.
 * Search: any model with "mini", "flash" or "haiku" in its id/name, else the last model in the list.
 *
 * Auth-flavor-aware: skips models that the connection's provider would reject
 * (e.g. `gpt-5.1-codex-mini` under ChatGPT-account auth). See
 * {@link isDeniedMiniModelId}.
 *
 * Used for mini agent, title generation, and mini completions.
 */
export function getMiniModel(
  connection: Pick<LlmConnection, 'models' | 'type' | 'defaultModel'>,
): string | undefined {
  return findSmallModel(connection);
}

/**
 * Get the summarization model ID for a connection.
 * Same provider-aware logic as getMiniModel(), but separate
 * so summarization and mini agent models can diverge independently.
 *
 * Used for response summarization and API tool summarization.
 */
export function getSummarizationModel(
  connection: Pick<LlmConnection, 'models' | 'type' | 'defaultModel'>,
): string | undefined {
  return findSmallModel(connection);
}

/**
 * Provider-aware small model resolution.
 * Shared implementation for getMiniModel() and getSummarizationModel().
 *
 *   - the connection's default model when it is a small one: an aggregator (OpenRouter) lists hundreds of models,
 *     some of them retired, so the first small one in its list is arbitrary
 *   - find "mini", "flash" or "haiku"
 *   - otherwise: last model in the list
 *
 * Skips models denied by {@link isDeniedMiniModelId} for the connection's
 * auth flavor.
 */
function findSmallModel(
  connection: Pick<LlmConnection, 'models' | 'type' | 'defaultModel'>,
): string | undefined {
  if (!connection.models || connection.models.length === 0) return undefined;

  const toId = (m: ModelDefinition | string) => typeof m === 'string' ? m : m.id;

  const toSearchStr = (m: ModelDefinition | string) =>
    typeof m === 'string' ? m.toLowerCase() : `${m.id} ${m.name} ${m.shortName}`.toLowerCase();

  const isAllowedModel = (m: ModelDefinition | string): boolean =>
    !isDeniedMiniModelId(toId(m), connection.type);

  // Claude models (Anthropic, a Claude subscription, Bedrock) have no mini/flash: their small one is Haiku.
  const keywords = ['mini', 'flash', 'haiku'];

  const candidates = connection.defaultModel ? [connection.defaultModel, ...connection.models] : connection.models;
  const match = candidates.find(m => isAllowedModel(m) && keywords.some(k => toSearchStr(m).includes(k)));
  if (match) return toId(match);

  // Fallback: last allowed model in the list, otherwise final entry.
  const fallback = [...connection.models].reverse().find(isAllowedModel);
  return fallback ? toId(fallback) : toId(connection.models[connection.models.length - 1]!);
}

/**
 * Generate a URL-safe slug from a display name.
 * @param name - Display name to convert
 * @returns URL-safe slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if a slug is valid (URL-safe, non-empty).
 * @param slug - Slug to validate
 * @returns true if valid
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * Get credential key for an LLM connection.
 * Format: llm::{slug}::{credentialType}
 *
 * @param slug - Connection slug
 * @param credentialType - Type of credential ('api_key' or 'oauth_token')
 * @returns Credential key string
 */
export function getLlmCredentialKey(slug: string, credentialType: 'api_key' | 'oauth_token'): string {
  return `llm::${slug}::${credentialType}`;
}

/**
 * Credential storage type for each auth mechanism.
 */
export type LlmCredentialStorageType =
  | 'api_key'           // Single token stored as value
  | 'oauth_token'       // OAuth tokens (access, refresh, expiry)
  | 'iam_credentials'   // AWS-style (accessKeyId, secretAccessKey, region)
  | 'service_account'   // JSON file contents
  | null;               // No storage needed (environment or none)

/**
 * Map LlmAuthType to credential storage type.
 * Determines how credentials are stored in the credential manager.
 *
 * @param authType - LLM auth type
 * @returns Credential storage type or null if no credential storage needed
 */
export function authTypeToCredentialStorageType(authType: LlmAuthType): LlmCredentialStorageType {
  switch (authType) {
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token':
      return 'api_key';
    case 'oauth':
      return 'oauth_token';
    case 'iam_credentials':
      return 'iam_credentials';
    case 'service_account_file':
      return 'service_account';
    case 'environment':
    case 'none':
    case 'cli_login':
      return null;
  }
}

/**
 * @deprecated Use authTypeToCredentialStorageType instead.
 * Kept for backwards compatibility during migration.
 */
export function authTypeToCredentialType(authType: LlmAuthType): 'api_key' | 'oauth_token' | null {
  const storageType = authTypeToCredentialStorageType(authType);
  if (storageType === 'api_key' || storageType === 'oauth_token') {
    return storageType;
  }
  return null;
}

/**
 * Check if an auth type requires a custom endpoint URL.
 * @param authType - LLM auth type
 * @returns true if endpoint URL field should be shown in UI
 */
export function authTypeRequiresEndpoint(authType: LlmAuthType): boolean {
  return authType === 'api_key_with_endpoint';
}

/**
 * Check if a connection type is the custom endpoint, which uses a base URL and an explicit model list.
 */
export function isCompatProvider(type: string): boolean {
  return type === CUSTOM_CONNECTION_TYPE;
}

/**
 * Check if a connection points to a local model runtime (loopback URL).
 */
export function isLocalConnection(conn: Pick<LlmConnection, 'baseUrl'>): boolean {
  if (!conn.baseUrl?.trim()) return false;
  try {
    const hostname = new URL(conn.baseUrl.trim()).hostname;
    const h = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

/**
 * Default mid-stream send behavior: 'steer'. Pi's native `.steer()` is non-destructive (delivers after the current
 * tool finishes, keeps full context).
 */
export function defaultMidStreamBehavior(): MidStreamBehavior {
  return 'steer';
}

/**
 * Read the effective mid-stream behavior for a connection.
 *
 * Single source of truth — every call site that needs to decide steer-vs-queue
 * should go through here so legacy connections (created before the field
 * existed) and connections with corrupt/unexpected values fall through to the
 * provider-appropriate default.
 */
export function resolveMidStreamBehavior(
  connection: Pick<LlmConnection, 'midStreamBehavior'>,
): MidStreamBehavior {
  if (connection.midStreamBehavior === 'steer' || connection.midStreamBehavior === 'queue') {
    return connection.midStreamBehavior;
  }
  return defaultMidStreamBehavior();
}

/**
 * Return a new LlmConnection with the given model's `supportsImages` override set.
 *
 * Centralizes the string-vs-object normalization for `connection.models[]`:
 *   - string entry → promoted to `{ id, name, shortName, supportsImages: enabled }`
 *   - object entry → only `supportsImages` is updated
 *   - model not in array → connection returned unchanged (defensive)
 *
 * Pure function — does not mutate the input. Storage round-trip is handled
 * upstream via `saveLlmConnection`. The stored object form for custom-endpoint
 * models is `{ id, name?, shortName?, contextWindow?, supportsImages? }`
 * (passthrough-validated by the storage schema). `name` and `shortName` default
 * to the model's `id` when promoting so that downstream renderer surfaces that
 * read `m.name` (the trigger button display, picker row labels) keep showing a
 * label after the toggle promotes a string entry. The `ModelDefinition` cast
 * matches the existing shape produced by `api-key-input.tsx` and the Pi driver.
 */
export function setModelSupportsImages(
  connection: LlmConnection,
  modelId: string,
  enabled: boolean,
): LlmConnection {
  if (!connection.models) return connection;
  const idOf = (m: ModelDefinition | string) => (typeof m === 'string' ? m : m.id);
  const idx = connection.models.findIndex(m => idOf(m) === modelId);
  if (idx === -1) return connection;

  const entry = connection.models[idx]!;
  const nextEntry =
    typeof entry === 'string'
      ? { id: entry, name: entry, shortName: entry, supportsImages: enabled }
      : { ...entry, supportsImages: enabled };

  const nextModels = connection.models.slice();
  nextModels[idx] = nextEntry as ModelDefinition;
  return { ...connection, models: nextModels };
}

/**
 * Resolve whether a given model on a connection accepts image input.
 *
 * For `custom` (custom-endpoint) connections this mirrors the precedence used
 * by Pi's `buildCustomEndpointModelDef`:
 *   per-model `supportsImages` override
 *   ?? connection-level `customEndpoint.supportsImages` default
 *   ?? false
 *
 * For other connections the renderer doesn't own the catalog — Pi SDK's
 * bundled provider definitions and Anthropic's API do. This helper conservatively
 * returns `true` there (we don't know better; the upstream decides). The
 * pre-flight banner gates on `custom` separately, so this just reports what
 * the renderer can know with confidence.
 */
export function modelSupportsImages(
  connection: Pick<LlmConnection, 'type' | 'models' | 'customEndpoint'>,
  modelId: string,
): boolean {
  if (!isCompatProvider(connection.type)) return true;

  const entry = connection.models?.find(m =>
    (typeof m === 'string' ? m : m.id) === modelId,
  );
  if (entry && typeof entry !== 'string' && typeof entry.supportsImages === 'boolean') {
    return entry.supportsImages;
  }
  return connection.customEndpoint?.supportsImages ?? false;
}


/**
 * Resolve the effective LLM connection slug from available fallbacks.
 *
 * Single source of truth for the fallback chain used everywhere in the UI:
 *   1. Explicit session connection (locked after first message)
 *   2. Workspace-level default override
 *   3. Global default (isDefault flag on a connection)
 *   4. First available connection
 *
 * @param sessionConnection  - Per-session connection slug (session.llmConnection)
 * @param workspaceDefault   - Workspace-level default connection slug
 * @param connections        - All available connections (with status metadata)
 * @returns The resolved slug, or undefined when no connections exist
 */
export function resolveEffectiveConnectionSlug(
  sessionConnection: string | undefined,
  workspaceDefault: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug' | 'isDefault'>[],
): string | undefined {
  return sessionConnection
    ?? workspaceDefault
    ?? connections.find(c => c.isDefault)?.slug
    ?? connections[0]?.slug
}

/**
 * Check if a session's locked connection is unavailable (deleted/removed).
 * Returns true only when a session has an explicit llmConnection that doesn't
 * match any current connection. Sessions without a stored connection (using
 * the fallback chain) are never "unavailable".
 *
 * @param sessionConnection - Per-session connection slug (session.llmConnection)
 * @param connections - All available connections
 * @returns true if the session's connection no longer exists
 */
export function isSessionConnectionUnavailable(
  sessionConnection: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug'>[],
): boolean {
  if (!sessionConnection) return false
  return !connections.some(c => c.slug === sessionConnection)
}

/**
 * Check if an auth type uses browser OAuth flow.
 * @param authType - LLM auth type
 * @returns true if OAuth browser flow should be triggered
 */
export function authTypeIsOAuth(authType: LlmAuthType): boolean {
  return authType === 'oauth';
}

/**
 * Check if a connection type supports a given auth type: a custom endpoint takes a key with its endpoint or none,
 * every Pi provider the rest.
 */
export function isValidProviderAuthCombination(type: string, authType: LlmAuthType): boolean {
  const valid: LlmAuthType[] = isCompatProvider(type)
    ? ['api_key_with_endpoint', 'none']
    : ['api_key', 'oauth', 'iam_credentials', 'environment', 'none', 'cli_login'];
  return valid.includes(authType);
}

/**
 * Maps bare Anthropic model IDs → Bedrock cross-region inference profile IDs.
 * Uses US inference profiles (us.*) — required for on-demand throughput with
 * newer Claude models. Direct model IDs (anthropic.claude-*) are rejected
 * by Bedrock with "Retry your request with the ID or ARN of an inference profile".
 *
 * Source: Pi SDK registry (models.generated.js) — us.* variants
 */
const BEDROCK_MODEL_MAP: Record<string, string> = {
  'claude-opus-5-5': 'us.anthropic.claude-opus-5-5',
  'claude-opus-5': 'us.anthropic.claude-opus-5',
  'claude-opus-4-8': 'us.anthropic.claude-opus-4-8',
  'claude-opus-4-7': 'us.anthropic.claude-opus-4-7',
  'claude-fable-5-1': 'us.anthropic.claude-fable-5-1',
  'claude-fable-5': 'us.anthropic.claude-fable-5',
  'claude-sonnet-5': 'us.anthropic.claude-sonnet-5',
  'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
  'claude-haiku-4-5-20251001': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  // Older models (for migration of existing connections)
  'claude-opus-4-6': 'us.anthropic.claude-opus-4-6-v1',
  'claude-opus-4-5-20251101': 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-sonnet-4-5-20250929': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // Also map base IDs (without region prefix) to US inference profiles
  'anthropic.claude-opus-5-5': 'us.anthropic.claude-opus-5-5',
  'anthropic.claude-opus-5': 'us.anthropic.claude-opus-5',
  'anthropic.claude-opus-4-8': 'us.anthropic.claude-opus-4-8',
  'anthropic.claude-opus-4-7': 'us.anthropic.claude-opus-4-7',
  'anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-6-v1',
  'anthropic.claude-fable-5-1': 'us.anthropic.claude-fable-5-1',
  'anthropic.claude-fable-5': 'us.anthropic.claude-fable-5',
  'anthropic.claude-sonnet-5': 'us.anthropic.claude-sonnet-5',
  'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-opus-4-5-20251101-v1:0': 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
}

/** Reverse map: all known Bedrock ID variants → bare Anthropic ID */
const BEDROCK_REVERSE_MAP: Record<string, string> = {
  // US inference profiles
  'us.anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'us.anthropic.claude-opus-5': 'claude-opus-5',
  'us.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'us.anthropic.claude-fable-5-1': 'claude-fable-5-1',
  'us.anthropic.claude-fable-5': 'claude-fable-5',
  'us.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'us.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'us.anthropic.claude-sonnet-5': 'claude-sonnet-5',
  'us.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'us.anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  'us.anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
  // EU inference profiles
  'eu.anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'eu.anthropic.claude-opus-5': 'claude-opus-5',
  'eu.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'eu.anthropic.claude-fable-5-1': 'claude-fable-5-1',
  'eu.anthropic.claude-fable-5': 'claude-fable-5',
  'eu.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'eu.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'eu.anthropic.claude-sonnet-5': 'claude-sonnet-5',
  'eu.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'eu.anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  'eu.anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
  // Global inference profiles
  'global.anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'global.anthropic.claude-opus-5': 'claude-opus-5',
  'global.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'global.anthropic.claude-fable-5-1': 'claude-fable-5-1',
  'global.anthropic.claude-fable-5': 'claude-fable-5',
  'global.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'global.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'global.anthropic.claude-sonnet-5': 'claude-sonnet-5',
  'global.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'global.anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  // Base IDs (no region prefix)
  'anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'anthropic.claude-opus-5': 'claude-opus-5',
  'anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'anthropic.claude-fable-5-1': 'claude-fable-5-1',
  'anthropic.claude-fable-5': 'claude-fable-5',
  'anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'anthropic.claude-sonnet-5': 'claude-sonnet-5',
  'anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  'anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
}

/**
 * Derive the Bedrock inference profile region prefix from an AWS region string.
 * Returns 'us', 'eu', or 'us' (default fallback for regions without inference profiles).
 */
export function deriveBedrockRegionPrefix(awsRegion?: string): string {
  if (!awsRegion) return 'us'
  if (awsRegion.startsWith('eu-')) return 'eu'
  // US regions and all others (ap-*, me-*, etc.) use US inference profiles
  return 'us'
}

/**
 * Map a bare Anthropic model ID to its Bedrock-native equivalent.
 * Uses the specified region prefix (default: 'us') for inference profile IDs.
 * Pass-through if already native or unknown.
 */
export function toBedrockNativeId(modelId: string, regionPrefix?: string): string {
  const normalizedModelId = normalizeDeprecatedModelId(modelId)
  const nativeId = BEDROCK_MODEL_MAP[normalizedModelId]
  if (!nativeId) return normalizedModelId
  if (!regionPrefix || regionPrefix === 'us') return nativeId
  // BEDROCK_MODEL_MAP stores us.* variants — swap the region prefix
  return nativeId.replace(/^us\./, `${regionPrefix}.`)
}

/** Map a Bedrock-native model ID back to its bare Anthropic equivalent. Pass-through if already bare or unknown. */
export function fromBedrockNativeId(modelId: string): string {
  const normalizedModelId = normalizeDeprecatedModelId(modelId)
  return BEDROCK_REVERSE_MAP[normalizedModelId] ?? normalizedModelId
}

/**
 * Normalize a model ID for Bedrock storage/usage.
 * Strips pi/ prefix and maps bare Anthropic IDs to Bedrock-native format.
 * Idempotent — already-native IDs pass through unchanged.
 */
export function normalizeBedrockModelId(
  modelId: string | undefined,
  regionPrefix?: string,
): string {
  if (!modelId) return '';
  const bare = modelId.startsWith('pi/') ? modelId.slice(3) : modelId
  return toBedrockNativeId(bare, regionPrefix)
}
