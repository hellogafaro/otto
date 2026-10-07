/**
 * Pi Model Fetcher
 *
 * Provider-agnostic wrapper that delegates model discovery to backend drivers.
 */

import type { ModelFetcher, ModelFetchResult, ModelFetcherCredentials } from '@otto/shared/config'
import type { LlmConnection } from '@otto/shared/config'
import { fetchBackendModels } from '@otto/shared/agent/backend'
import { fetchOpenAiModels, OPENAI_UNSUPPORTED } from './openai'

export class PiModelFetcher implements ModelFetcher {
  /** No periodic refresh — SDK models are static, updated on app upgrade */
  readonly refreshIntervalMs = 0

  async fetchModels(
    connection: LlmConnection,
    credentials: ModelFetcherCredentials,
  ): Promise<ModelFetchResult> {
    if (process.env.OTTO_MASTRA_CHAT === '1' && connection.type === 'openai') {
      if (connection.authType !== 'api_key') throw new Error(OPENAI_UNSUPPORTED)
      return fetchOpenAiModels({ apiKey: credentials.apiKey ?? '', baseUrl: connection.baseUrl })
    }
    if (process.env.OTTO_MASTRA_CHAT === '1') throw new Error(OPENAI_UNSUPPORTED)
    // Copilot OAuth needs longer timeout (CLI startup + API call)
    const isCopilot = connection.type === 'github-copilot'
    return fetchBackendModels({
      connection,
      credentials,
      timeoutMs: isCopilot ? 30_000 : 15_000,
    })
  }
}
