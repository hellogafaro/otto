/**
 * Module-level PlatformServices for model fetchers.
 * Avoids circular imports (index.ts → registry.ts → fetchers → index.ts).
 * Must be initialized via setFetcherPlatform() before any model fetching.
 */
import { createScopedLogger, CONSOLE_LOGGER, type PlatformServices, type Logger } from '../runtime/platform'

// Scoped logger — upgraded from console fallback when setFetcherPlatform() is called.
// ES module live binding: importers of `handlerLog` see the updated value automatically.
export let handlerLog: Logger = createScopedLogger(CONSOLE_LOGGER, 'handler')

export function setFetcherPlatform(platform: PlatformServices): void {
  handlerLog = createScopedLogger(platform.logger, 'handler')
}
