/**
 * Credential Manager
 *
 * Main interface for credential storage. Uses encrypted file storage
 * for cross-platform compatibility without OS keychain prompts.
 */

import type { CredentialBackend } from './backends/types.ts';
import type { CredentialId, StoredCredential, CredentialHealthStatus, CredentialHealthIssue } from './types.ts';
import type { LlmAuthType, LlmProviderType } from '../config/llm-connections.ts';
import { SecureStorageBackend } from './backends/secure-storage.ts';
import { deleteDecisionKey, getDecisionKey, setDecisionKey } from '../decisions/keys.ts';
import { deleteCredential, getCredential, setCredential } from '../connections/index.ts';
import { deleteSourceCredential, deleteWorkspaceSourceCredentials, getSourceCredential, setSourceCredential } from '../sources/rows.ts';
import { SOURCE_CREDENTIAL_TYPES } from './types.ts';
import { debug } from '../utils/debug.ts';

export class CredentialManager {
  private backends: CredentialBackend[] = [];
  private writeBackend: CredentialBackend | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Explicitly initialize the credential manager.
   * This is optional - methods auto-initialize via ensureInitialized().
   * Use this for eager initialization at app startup if desired.
   */
  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Internal: ensure initialization has completed.
   * Called automatically by all public methods.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // Prevent race condition with concurrent initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    // Clear promise on failure so initialization can be retried
    this.initPromise = this._doInitialize().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const potentialBackends: CredentialBackend[] = [
      new SecureStorageBackend(),
    ];
    const availableBackends: CredentialBackend[] = [];

    // Check which backends are available
    for (const backend of potentialBackends) {
      if (await backend.isAvailable()) {
        availableBackends.push(backend);
        debug(`[CredentialManager] Backend available: ${backend.name} (priority ${backend.priority})`);
      }
    }

    // Sort by priority (highest first)
    availableBackends.sort((a, b) => b.priority - a.priority);
    this.backends = availableBackends;

    // Use the first available backend for writing
    this.writeBackend = this.backends[0] || null;

    if (this.writeBackend) {
      debug(`[CredentialManager] Using backend: ${this.writeBackend.name}`);
    } else {
      debug(`[CredentialManager] WARNING: No backend available.`);
    }

    this.initialized = true;
  }

  /** Get the name of the active write backend */
  getActiveBackendName(): string | null {
    return this.writeBackend?.name || null;
  }

  /**
   * Get a credential by ID, trying all backends.
   * Automatically initializes if needed.
   */
  async get(id: CredentialId): Promise<StoredCredential | null> {
    await this.ensureInitialized();

    for (const backend of this.backends) {
      try {
        const cred = await backend.get(id);
        if (cred) {
          debug(`[CredentialManager] Found ${id.type} in ${backend.name}`);
          return cred;
        }
      } catch (err) {
        debug(`[CredentialManager] Error reading from ${backend.name}:`, err);
      }
    }

    return null;
  }

  /**
   * Set a credential using the write backend.
   * Automatically initializes if needed.
   */
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    await this.ensureInitialized();

    if (!this.writeBackend) {
      throw new Error('No writable credential backend available');
    }

    await this.writeBackend.set(id, credential);
    debug(`[CredentialManager] Saved ${id.type} to ${this.writeBackend.name}`);
  }

  /**
   * Delete a credential from all backends.
   * Automatically initializes if needed.
   */
  async delete(id: CredentialId): Promise<boolean> {
    await this.ensureInitialized();

    let deleted = false;
    for (const backend of this.backends) {
      try {
        if (await backend.delete(id)) {
          deleted = true;
          debug(`[CredentialManager] Deleted ${id.type} from ${backend.name}`);
        }
      } catch (err) {
        debug(`[CredentialManager] Error deleting from ${backend.name}:`, err);
      }
    }

    return deleted;
  }

  /**
   * List credentials matching a filter.
   * Automatically initializes if needed.
   */
  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    await this.ensureInitialized();

    const seen = new Set<string>();
    const results: CredentialId[] = [];

    for (const backend of this.backends) {
      try {
        const ids = await backend.list(filter);
        for (const id of ids) {
          const key = JSON.stringify(id);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(id);
          }
        }
      } catch (err) {
        debug(`[CredentialManager] Error listing from ${backend.name}:`, err);
      }
    }

    return results;
  }

  // ============================================================
  // Convenience Methods
  // ============================================================

  /** Get workspace MCP OAuth credentials */
  async getWorkspaceOAuth(workspaceId: string): Promise<{
    accessToken: string;
    tokenType?: string;
    clientId?: string;
  } | null> {
    const cred = await this.get({ type: 'workspace_oauth', workspaceId });
    if (!cred) return null;
    return {
      accessToken: cred.value,
      tokenType: cred.tokenType,
      clientId: cred.clientId,
    };
  }

  /** Set workspace MCP OAuth credentials */
  async setWorkspaceOAuth(workspaceId: string, credentials: {
    accessToken: string;
    tokenType?: string;
    clientId?: string;
  }): Promise<void> {
    await this.set(
      { type: 'workspace_oauth', workspaceId },
      {
        value: credentials.accessToken,
        tokenType: credentials.tokenType,
        clientId: credentials.clientId,
      }
    );
  }

  /** Delete all credentials for a workspace (the old file's, and its sources' secrets) */
  async deleteWorkspaceCredentials(workspaceId: string): Promise<void> {
    const allCreds = await this.list({ workspaceId });
    for (const cred of allCreds) {
      await this.delete(cred);
    }
    deleteWorkspaceSourceCredentials(workspaceId);
  }

  // ============================================================
  // Source Credentials
  // ============================================================
  //
  // A source's credential is the one secret of its `sources` row (`@otto/shared/sources`), not an entry of
  // this file: these methods take the same `CredentialId` (`source_oauth`, `source_bearer`, `source_apikey`,
  // `source_basic`; `workspaceId` is the workspace's id, `sourceId` the source's slug) and read and write that secret.
  // The raw `get` / `set` / `delete` above still address `credentials.enc`, which is only read, by the importer of sources.

  private sourceKey(id: CredentialId): { workspaceId: string; slug: string; type: (typeof SOURCE_CREDENTIAL_TYPES)[number] } {
    const type = SOURCE_CREDENTIAL_TYPES.find((candidate) => candidate === id.type);
    if (!type || !id.workspaceId || !id.sourceId) throw new Error(`${id.type} is not a source credential id`);
    return { workspaceId: id.workspaceId, slug: id.sourceId, type };
  }

  /** The credential of this kind the source keeps, or null. */
  async getSourceCredential(id: CredentialId): Promise<StoredCredential | null> {
    const { workspaceId, slug, type } = this.sourceKey(id);
    return getSourceCredential(workspaceId, slug, type) ?? null;
  }

  /** Replaces the credential of the source. */
  async setSourceCredential(id: CredentialId, credential: StoredCredential): Promise<void> {
    const { workspaceId, slug, type } = this.sourceKey(id);
    await setSourceCredential(workspaceId, slug, type, credential);
  }

  /** Removes the credential of this kind the source keeps; true when there was one. Synchronous: the config save cannot wait. */
  deleteSourceCredential(id: CredentialId): boolean {
    const { workspaceId, slug, type } = this.sourceKey(id);
    return deleteSourceCredential(workspaceId, slug, type);
  }

  // Note: OpenAI API key methods removed - Codex uses native ChatGPT OAuth flow

  // ============================================================
  // LLM Connection Credentials
  // ============================================================
  //
  // A connection's credential is the one secret of its `connections` row (`@otto/shared/connections`),
  // not an entry of this file: these methods keep their names for the callers and read and write that
  // secret. An OAuth refresh rewrites it in place. A slug with no connection yet (sign-in finished before
  // the setup saved it, a connection test) is held in memory until the setup creates the connection.
  // `scope` addresses the connection of that exact scope (`install` when left out): a connection a chat uses carries its own.

  /** The API key of a connection, or null. */
  async getLlmApiKey(connectionSlug: string, scope?: string): Promise<string | null> {
    return getCredential(connectionSlug, scope)?.apiKey || null;
  }

  /** Replaces the credential of a connection with an API key. */
  async setLlmApiKey(connectionSlug: string, apiKey: string, scope?: string): Promise<void> {
    setCredential(connectionSlug, { apiKey }, scope);
  }

  /** Removes the credential of a connection. Returns true if there was one. */
  async deleteLlmApiKey(connectionSlug: string, scope?: string): Promise<boolean> {
    const had = !!getCredential(connectionSlug, scope)?.apiKey;
    deleteCredential(connectionSlug, scope);
    return had;
  }

  // ============================================================
  // Decision Layer Credentials (Jev / System One providers)
  // ============================================================

  /**
   * Get the API key stored for a decision provider (a secret, see decisions/keys.ts).
   * Keys reused from an LLM connection are read via getLlmApiKey instead.
   */
  async getDecisionApiKey(provider: string): Promise<string | null> {
    return getDecisionKey(provider);
  }

  /** Store the API key for a decision provider. */
  async setDecisionApiKey(provider: string, apiKey: string): Promise<void> {
    setDecisionKey(provider, apiKey);
  }

  /** Delete the API key for a decision provider. Returns true if one was removed. */
  async deleteDecisionApiKey(provider: string): Promise<boolean> {
    return deleteDecisionKey(provider);
  }

  /** The OAuth tokens of a connection, or null. */
  async getLlmOAuth(connectionSlug: string, scope?: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    /** OIDC id_token (used by OpenAI/Codex) */
    idToken?: string;
  } | null> {
    const { accessToken, refreshToken, expiresAt, idToken } = getCredential(connectionSlug, scope) ?? {};
    return accessToken ? { accessToken, refreshToken, expiresAt, idToken } : null;
  }

  /** Replaces the credential of a connection with OAuth tokens (a refresh rewrites it in place). */
  async setLlmOAuth(connectionSlug: string, credentials: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    /** OIDC id_token (used by OpenAI/Codex) */
    idToken?: string;
  }, scope?: string): Promise<void> {
    const { accessToken, refreshToken, expiresAt, idToken } = credentials;
    setCredential(connectionSlug, { accessToken, refreshToken, expiresAt, idToken }, scope);
  }

  /** Removes the credential of a connection, whatever kind it is. */
  async deleteLlmCredentials(connectionSlug: string, scope?: string): Promise<void> {
    deleteCredential(connectionSlug, scope);
  }

  // ============================================================
  // IAM Credentials (AWS Bedrock)
  // ============================================================

  /** The IAM credentials of a connection, or null. */
  async getLlmIamCredentials(connectionSlug: string, scope?: string): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    sessionToken?: string;
  } | null> {
    const { accessKeyId, secretAccessKey, region, sessionToken } = getCredential(connectionSlug, scope) ?? {};
    return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, region, sessionToken } : null;
  }

  /** Replaces the credential of a connection with IAM credentials. */
  async setLlmIamCredentials(connectionSlug: string, credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    sessionToken?: string;
  }, scope?: string): Promise<void> {
    const { accessKeyId, secretAccessKey, region, sessionToken } = credentials;
    setCredential(connectionSlug, { accessKeyId, secretAccessKey, region, sessionToken }, scope);
  }

  // ============================================================
  // Service Account Credentials (GCP Vertex)
  // ============================================================

  /** The service account of a connection, or null. */
  async getLlmServiceAccount(connectionSlug: string, scope?: string): Promise<{
    serviceAccountJson: string;
    projectId?: string;
    region?: string;
    email?: string;
  } | null> {
    const { serviceAccountJson, projectId, region, email } = getCredential(connectionSlug, scope) ?? {};
    return serviceAccountJson ? { serviceAccountJson, projectId, region, email } : null;
  }

  /** Replaces the credential of a connection with a service account. */
  async setLlmServiceAccount(connectionSlug: string, credentials: {
    serviceAccountJson: string;
    projectId?: string;
    region?: string;
    email?: string;
  }, scope?: string): Promise<void> {
    const { serviceAccountJson, projectId, region, email } = credentials;
    setCredential(connectionSlug, { serviceAccountJson, projectId, region, email }, scope);
  }

  // ============================================================
  // Unified Credential Checking
  // ============================================================

  /**
   * Check if an LLM connection has valid credentials.
   * Uses the new LlmAuthType system - routes by auth mechanism.
   *
   * @param connectionSlug - The connection slug
   * @param authType - The auth type to check
   * @param providerType - Optional provider type for OAuth routing
   * @returns true if credentials exist and are valid
   */
  async hasLlmCredentials(
    connectionSlug: string,
    authType: LlmAuthType,
    providerType?: LlmProviderType,
    scope?: string
  ): Promise<boolean> {
    switch (authType) {
      // No credentials needed (cli_login: the CLI's own sign-in)
      case 'none':
      case 'environment':
      case 'cli_login':
        return true;

      // API key variants - all use the same storage
      case 'api_key':
      case 'api_key_with_endpoint':
      case 'bearer_token':
        return this.hasLlmApiKeyCredential(connectionSlug, scope);

      // OAuth - browser flow
      case 'oauth':
        return this.hasLlmOAuthCredential(connectionSlug, providerType, scope);

      // AWS IAM credentials
      case 'iam_credentials':
        return this.hasLlmIamCredential(connectionSlug, scope);

      // GCP service account
      case 'service_account_file':
        return this.hasLlmServiceAccountCredential(connectionSlug, scope);

      default:
        // Exhaustive check - TypeScript will error if we miss a case
        authType satisfies never;
        return false;
    }
  }

  /**
   * Check if connection has valid API key credential.
   * @internal
   */
  private async hasLlmApiKeyCredential(connectionSlug: string, scope?: string): Promise<boolean> {
    const apiKey = await this.getLlmApiKey(connectionSlug, scope);
    return !!apiKey;
  }

  /**
   * Check if connection has valid OAuth credential.
   * @internal
   */
  private async hasLlmOAuthCredential(
    connectionSlug: string,
    providerType?: LlmProviderType,
    scope?: string
  ): Promise<boolean> {
    const oauth = await this.getLlmOAuth(connectionSlug, scope);
    if (!oauth) return false;

    // Check if expired
    if (oauth.expiresAt && this.isExpired({ value: oauth.accessToken, expiresAt: oauth.expiresAt })) {
      return !!oauth.refreshToken; // Can refresh
    }
    return true;
  }

  /**
   * Check if connection has valid IAM credential.
   * @internal
   */
  private async hasLlmIamCredential(connectionSlug: string, scope?: string): Promise<boolean> {
    const cred = await this.getLlmIamCredentials(connectionSlug, scope);
    return !!cred?.accessKeyId && !!cred?.secretAccessKey;
  }

  /**
   * Check if connection has valid service account credential.
   * @internal
   */
  private async hasLlmServiceAccountCredential(connectionSlug: string, scope?: string): Promise<boolean> {
    const cred = await this.getLlmServiceAccount(connectionSlug, scope);
    return !!cred?.serviceAccountJson;
  }

  /**
   * Check if a credential is expired (with 5-minute buffer).
   *
   * If expiresAt is not set:
   * - OAuth tokens (have refreshToken): treated as expired to force refresh attempt
   * - API keys (no refreshToken): treated as never expiring
   *
   * This prevents OAuth tokens from being treated as valid forever when
   * the provider doesn't return expires_in in the token response.
   */
  isExpired(credential: StoredCredential): boolean {
    if (credential.expiresAt) {
      // Consider expired if within 5 minutes of expiry
      return Date.now() > credential.expiresAt - 5 * 60 * 1000;
    }

    // No expiresAt set - behavior depends on credential type
    if (credential.refreshToken) {
      // OAuth token without expiry - treat as expired to force refresh
      // This is safer than assuming it's valid forever
      debug('[CredentialManager] OAuth token missing expiresAt - treating as expired');
      return true;
    }

    // API key without expiry - these typically don't expire
    return false;
  }

  // ============================================================
  // Health Check
  // ============================================================

  /**
   * Check the health of the credential store.
   *
   * This validates:
   * 1. The credential file can be read and decrypted (if it exists)
   * 2. The default LLM connection has valid credentials
   *
   * Use this on app startup to detect issues before users hit cryptic errors.
   *
   * @returns Health status with any issues found
   */
  async checkHealth(): Promise<CredentialHealthStatus> {
    const issues: CredentialHealthIssue[] = [];

    try {
      await this.ensureInitialized();

      // 1. Try to list credentials - this triggers decryption
      // If file is corrupted or can't be decrypted, this will throw
      await this.list({});

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lowerMsg = errorMsg.toLowerCase();

      // Detect decryption failures (usually means machine migration)
      if (lowerMsg.includes('decrypt') || lowerMsg.includes('cipher') || lowerMsg.includes('authentication tag')) {
        issues.push({
          type: 'decryption_failed',
          message: 'Credentials from another machine detected. Please re-authenticate.',
          error: errorMsg,
        });
      } else if (lowerMsg.includes('json') || lowerMsg.includes('parse') || lowerMsg.includes('unexpected')) {
        issues.push({
          type: 'file_corrupted',
          message: 'Credential file is corrupted. Please re-authenticate.',
          error: errorMsg,
        });
      } else {
        // Unknown error - treat as corruption
        issues.push({
          type: 'file_corrupted',
          message: 'Failed to read credentials. Please re-authenticate.',
          error: errorMsg,
        });
      }

      return { healthy: false, issues };
    }

    // 2. Check if default connection has credentials
    // Import lazily to avoid circular dependency
    try {
      const { getDefaultLlmConnection, getLlmConnection } = await import('../config/storage.ts');
      const defaultSlug = getDefaultLlmConnection();

      if (defaultSlug) {
        const connection = getLlmConnection(defaultSlug);
        if (connection && connection.authType !== 'none' && connection.authType !== 'environment') {
          const hasCredentials = await this.hasLlmCredentials(
            defaultSlug,
            connection.authType,
            connection.providerType
          );
          if (!hasCredentials) {
            issues.push({
              type: 'no_default_credentials',
              message: `No credentials found for default connection "${connection.name}".`,
            });
          }
        }
      }
    } catch (configError) {
      // Config not yet initialized - skip this check
      debug('[CredentialManager] Skipping default connection check - config not available');
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }
}

// Singleton instance
let manager: CredentialManager | null = null;

export function getCredentialManager(): CredentialManager {
  if (!manager) {
    manager = new CredentialManager();
  }
  return manager;
}
