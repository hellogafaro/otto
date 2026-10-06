/**
 * Model Fetcher Registry: every fetchable connection is a Pi provider (custom endpoints list their own models).
 */

import type { ModelFetcherMap } from '@otto/shared/config'
import { PiModelFetcher } from './pi'

export const MODEL_FETCHERS: ModelFetcherMap = {
  pi: new PiModelFetcher(),
}
