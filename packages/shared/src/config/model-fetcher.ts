/**
 * Model Fetcher — Centralized Model Discovery
 *
 * Interface for fetching a connection's available models (Pi's catalog, or
 * Copilot's live list). A custom endpoint is excluded: it points to an arbitrary
 * endpoint where the user configures models manually.
 */

import type { ModelDefinition } from './models';
import type { LlmConnection } from './llm-connections';

// ============================================================
// Types
// ============================================================

/**
 * Result of a model fetch operation.
 */
export interface ModelFetchResult {
  models: ModelDefinition[];
  /** Which model the provider considers the default (optional) */
  serverDefault?: string;
}

/**
 * Credentials needed to fetch models from a provider.
 * The ModelRefreshService resolves these from the credential manager.
 */
export interface ModelFetcherCredentials {
  apiKey?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthIdToken?: string;
}

/**
 * Plugin interface for provider-specific model discovery.
 *
 * The implementation lives in packages/server-core/src/model-fetchers/.
 */
export interface ModelFetcher {
  /**
   * Fetch models from the provider API/SDK.
   * Throws on failure — the ModelRefreshService handles fallback.
   */
  fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult>;

  /**
   * Refresh interval in milliseconds.
   * 0 = fetch on auth/startup only, no periodic refresh.
   */
  readonly refreshIntervalMs: number;
}
