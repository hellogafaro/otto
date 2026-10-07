/**
 * Model Refresh Service
 *
 * Centralized service for fetching and refreshing model lists across all providers.
 * Replaces the scattered fetchAndStore*Models() functions and startCodexModelRefresh().
 *
 * Fallback chain (same for every provider):
 * 1. Provider runtime discovery via backend driver dispatch
 * 2. Persisted connection.models — previously fetched, survives offline/restart
 * 3. MODEL_REGISTRY — hardcoded offline seed data, last resort
 */

import type { ModelFetcher, ModelFetcherCredentials } from '@otto/shared/config'
import type { ModelDefinition } from '@otto/shared/config'
import { INSTALL_SCOPE, getAllConnections } from '@otto/shared/connections'
import {
  contextOfScope,
  getLlmConnection,
  updateLlmConnection,
  isCompatProvider,
  getModelsForProviderType,
} from '@otto/shared/config'
import { PiModelFetcher } from './pi'
import { handlerLog } from './runtime'

/** Copilot models are server-managed — refresh every 10 minutes to pick up policy changes. */
const COPILOT_REFRESH_INTERVAL_MS = 10 * 60 * 1000

// ============================================================
// Types
// ============================================================

/** The credentials of the connection of this slug in this exact scope. */
type CredentialResolver = (slug: string, scope: string) => Promise<ModelFetcherCredentials>

/** Timers and in-flight refreshes are kept per connection: the install's by its slug, any other scope's by scope and slug. */
const keyOf = (slug: string, scope: string) => (scope === INSTALL_SCOPE ? slug : `${scope}:${slug}`)

// ============================================================
// ModelRefreshService
// ============================================================

class ModelRefreshService {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private inFlight = new Map<string, Promise<void>>()

  constructor(
    private fetcher: ModelFetcher,
    private getCredentials: CredentialResolver,
  ) {}

  /**
   * Fetch models for a connection through the fallback chain.
   * Deduplicates concurrent calls for the same slug — if a refresh is already
   * in progress, callers share the same promise instead of racing.
   */
  async refreshConnection(slug: string, scope: string = INSTALL_SCOPE): Promise<void> {
    const key = keyOf(slug, scope)
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const promise = this._doRefresh(slug, scope).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  /**
   * Internal: actual refresh logic with fallback chain.
   * Skips custom endpoints (their models are the ones the user listed).
   * Preserves user's defaultModel if still valid.
   * Updates connection.models in storage on success.
   */
  private async _doRefresh(slug: string, scope: string): Promise<void> {
    const connection = getLlmConnection(slug, contextOfScope(scope))
    if (!connection) {
      handlerLog.warn(`Model refresh: connection not found: ${slug}`)
      return
    }

    // Skip custom endpoints — users configure models manually
    if (isCompatProvider(connection.type)) {
      return
    }
    if (process.env.OTTO_MASTRA_CHAT === '1' && (connection.type !== 'openai' || connection.authType !== 'api_key')) return

    let newModels: ModelDefinition[] | null = null
    let serverDefault: string | undefined

    // Layer 1: Provider API/SDK
    try {
      const credentials = await this.getCredentials(slug, scope)
      handlerLog.info(`Model refresh [${slug}]: fetching (provider=${connection.type}, hasOAuthRefresh=${!!credentials.oauthRefreshToken}, hasOAuthAccess=${!!credentials.oauthAccessToken})`)
      const result = await this.fetcher.fetchModels(connection, credentials)
      newModels = result.models
      serverDefault = result.serverDefault
      handlerLog.info(`Model refresh [${slug}]: fetched ${newModels.length} models from provider: ${newModels.map(m => m.id).join(', ')}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      handlerLog.warn(`Model refresh [${slug}]: provider fetch failed: ${msg}`)
    }

    // Layer 2: Persisted connection.models (keep what we have)
    if (!newModels && connection.models && connection.models.length > 0) {
      handlerLog.warn(`Model refresh [${slug}]: keeping ${connection.models.length} stale persisted models (live fetch failed)`)
      return // Nothing to update
    }

    // Layer 3: MODEL_REGISTRY hardcoded fallback
    if (!newModels) {
      if (process.env.OTTO_MASTRA_CHAT === '1' && connection.type === 'openai') return
      const registryModels = getModelsForProviderType(connection.type)
      if (registryModels.length > 0) {
        newModels = registryModels
        handlerLog.info(`Model refresh [${slug}]: using ${newModels.length} models from MODEL_REGISTRY`)
      }
    }

    if (!newModels || newModels.length === 0) {
      handlerLog.warn(`Model refresh [${slug}]: no models available from any source`)
      return
    }

    // Preserve user's defaultModel if still valid
    const currentDefault = process.env.OTTO_MASTRA_CHAT === '1' && connection.type === 'openai' ? connection.defaultModel?.replace(/^pi\//, '') : connection.defaultModel
    const stillValid = currentDefault && newModels.some(m => m.id === currentDefault)
    const newDefault = stillValid
      ? currentDefault
      : serverDefault ?? newModels[0]?.id

    updateLlmConnection(slug, {
      models: newModels,
      ...(newDefault && (!stillValid || currentDefault !== connection.defaultModel) ? { defaultModel: newDefault } : {}),
    }, { where: contextOfScope(scope) })
  }

  /**
   * Start periodic refresh timers for all existing connections.
   * Also runs an immediate non-blocking fetch for each.
   * Call on app startup after IPC handlers are registered.
   */
  startAll(): void {
    for (const conn of getAllConnections()) {
      // a custom endpoint's models are the ones the user listed
      if (isCompatProvider(conn.type)) continue

      // Immediate non-blocking fetch
      this.refreshConnection(conn.slug, conn.scope).catch(err => {
        handlerLog.warn(`Initial model refresh failed for ${conn.slug}: ${err instanceof Error ? err.message : err}`)
      })

      // Set up periodic refresh: Copilot connections get their own interval
      // (models are server-managed by GitHub policy), other providers use
      // the fetcher's generic interval (0 = no periodic refresh for static SDK models).
      const isCopilot = conn.type === 'github-copilot'
      if (isCopilot) {
        this.startTimer(conn.slug, conn.scope, COPILOT_REFRESH_INTERVAL_MS)
      } else if (this.fetcher.refreshIntervalMs > 0) {
        this.startTimer(conn.slug, conn.scope, this.fetcher.refreshIntervalMs)
      }
    }
  }

  /**
   * Stop all refresh timers. Call on app quit.
   */
  stopAll(): void {
    for (const [slug, timer] of this.timers) {
      clearInterval(timer)
      handlerLog.info(`Stopped model refresh timer for ${slug}`)
    }
    this.timers.clear()
  }

  /**
   * Trigger an immediate refresh for a specific connection.
   * Also starts a periodic timer if the fetcher supports it.
   * Called when: connection created, auth completed, user clicks refresh.
   */
  async refreshNow(slug: string, scope: string = INSTALL_SCOPE): Promise<void> {
    await this.refreshConnection(slug, scope)

    // Ensure periodic timer is running
    const connection = getLlmConnection(slug, contextOfScope(scope))
    if (!connection || isCompatProvider(connection.type)) return

    const isCopilot = connection.type === 'github-copilot'
    if (isCopilot && !this.timers.has(keyOf(slug, scope))) {
      this.startTimer(slug, scope, COPILOT_REFRESH_INTERVAL_MS)
    } else if (this.fetcher.refreshIntervalMs > 0 && !this.timers.has(keyOf(slug, scope))) {
      this.startTimer(slug, scope, this.fetcher.refreshIntervalMs)
    }
  }

  /**
   * Stop timer for a specific connection (e.g., when deleted).
   */
  stopConnection(slug: string, scope: string = INSTALL_SCOPE): void {
    const key = keyOf(slug, scope)
    const timer = this.timers.get(key)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(key)
    }
  }

  private startTimer(slug: string, scope: string, intervalMs: number): void {
    // Don't create duplicate timers
    const key = keyOf(slug, scope)
    if (this.timers.has(key)) return

    const timer = setInterval(async () => {
      try {
        await this.refreshConnection(slug, scope)
      } catch (err) {
        handlerLog.warn(`Periodic model refresh failed for ${slug}: ${err instanceof Error ? err.message : err}`)
      }
    }, intervalMs)

    this.timers.set(key, timer)
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let _service: ModelRefreshService | null = null

/**
 * Get the ModelRefreshService singleton.
 * Must be initialized with initModelRefreshService() before use.
 */
export function getModelRefreshService(): ModelRefreshService {
  if (!_service) {
    throw new Error('ModelRefreshService not initialized. Call initModelRefreshService() first.')
  }
  return _service
}

/**
 * Initialize the ModelRefreshService with a credential resolver.
 * Called once during app startup.
 */
export function initModelRefreshService(getCredentials: CredentialResolver): ModelRefreshService {
  _service = new ModelRefreshService(new PiModelFetcher(), getCredentials)
  return _service
}

export { setFetcherPlatform } from './runtime'
