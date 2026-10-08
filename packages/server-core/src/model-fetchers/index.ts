import { INSTALL_SCOPE, getAllConnections, getConnection } from '@otto/shared/connections'
import { contextOfScope, getLlmConnection, updateLlmConnection } from '@otto/shared/config/storage'
import { fetchOpenAiModels } from './openai'
import { handlerLog } from './runtime'

type CredentialResolver = (slug: string, scope: string) => Promise<{ apiKey?: string }>
const keyOf = (slug: string, scope: string) => `${scope}:${slug}`

class ModelRefreshService {
  private inFlight = new Map<string, Promise<void>>()
  private controllers = new Map<string, AbortController>()

  constructor(private getCredentials: CredentialResolver) {}

  async refreshConnection(slug: string, scope: string = INSTALL_SCOPE): Promise<void> {
    const key = keyOf(slug, scope)
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const controller = new AbortController()
    this.controllers.set(key, controller)
    const promise = this.refreshModels(slug, scope, controller.signal).finally(() => {
      this.inFlight.delete(key)
      this.controllers.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  private async refreshModels(slug: string, scope: string, signal: AbortSignal): Promise<void> {
    const where = contextOfScope(scope)
    const connection = getLlmConnection(slug, where)
    if (!connection || connection.scope !== scope || connection.type !== 'openai' || connection.authType !== 'api_key') return
    const stored = getConnection(slug, where)
    try {
      const credentials = await this.getCredentials(slug, scope)
      signal.throwIfAborted()
      const catalog = await fetchOpenAiModels({ apiKey: credentials.apiKey ?? '', baseUrl: connection.baseUrl, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      signal.throwIfAborted()
      const currentDefault = connection.defaultModel?.replace(/^pi\//, '')
      const defaultModel = currentDefault && catalog.models.some((model) => model.id === currentDefault) ? currentDefault : catalog.models[0]?.id
      const current = getLlmConnection(slug, where)
      if (!current || getConnection(slug, where)?.id !== stored?.id || current.scope !== scope || current.type !== 'openai' || current.authType !== 'api_key' || current.baseUrl !== connection.baseUrl) return
      updateLlmConnection(slug, { models: catalog.models, defaultModel }, { where })
    } catch {
      handlerLog.warn('OpenAI model refresh failed; the stored catalog is unchanged.')
    }
  }

  startAll(): void {
    for (const connection of getAllConnections()) {
      if (connection.type !== 'openai' || connection.authType !== 'api_key') continue
      void this.refreshConnection(connection.slug, connection.scope)
    }
  }

  stopAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
  }

  async refreshNow(slug: string, scope: string = INSTALL_SCOPE): Promise<void> {
    await this.refreshConnection(slug, scope)
  }

  stopConnection(slug: string, scope: string = INSTALL_SCOPE): void {
    this.controllers.get(keyOf(slug, scope))?.abort()
  }
}

let service: ModelRefreshService | undefined

export function getModelRefreshService(): ModelRefreshService {
  if (!service) throw new Error('ModelRefreshService not initialized. Call initModelRefreshService() first.')
  return service
}

export function initModelRefreshService(getCredentials: CredentialResolver): ModelRefreshService {
  service = new ModelRefreshService(getCredentials)
  return service
}

export { setFetcherPlatform } from './runtime'
