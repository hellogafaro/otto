import type { EventBus, BaseEventPayload } from '../event-bus.ts'
import type { AutomationHandler, AutomationsConfigProvider } from './types.ts'
import { APP_EVENTS, type AutomationEvent, type ScriptActionResult, type AppEvent } from '../types.ts'
import { matcherMatches } from '../utils.ts'
import { appendAutomationHistoryEntry } from '../history-store.ts'
import { isNativeRoutineConfigSupported, UNSUPPORTED_NATIVE_ROUTINE } from '../routine-runner.ts'

export interface ScriptHandlerOptions {
  workspaceId: string
  workspaceRootPath: string
  onScriptResults?: (results: ScriptActionResult[]) => void
  onError?: (event: AutomationEvent, error: Error) => void
}

export class ScriptHandler implements AutomationHandler {
  private bus: EventBus | null = null
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null

  constructor(private readonly options: ScriptHandlerOptions, private readonly configProvider: AutomationsConfigProvider) {}

  subscribe(bus: EventBus): void {
    this.bus = bus
    this.boundHandler = this.handleEvent.bind(this)
    bus.onAny(this.boundHandler)
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (!APP_EVENTS.includes(event as AppEvent)) return
    const results: ScriptActionResult[] = []
    for (const matcher of this.configProvider.getMatchersForEvent(event)) {
      if (isNativeRoutineConfigSupported({ type: 'event', actions: matcher.actions })) continue
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue
      const actions = matcher.actions.filter((action) => action.type === 'script')
      if (!actions.length) continue
      for (const action of actions) {
        results.push({ type: 'script', script: action.script, success: false, exitCode: null, blocked: true, stdout: '', stderr: UNSUPPORTED_NATIVE_ROUTINE, durationMs: 0 })
      }
      this.options.onError?.(event, new Error(UNSUPPORTED_NATIVE_ROUTINE))
      await appendAutomationHistoryEntry(this.options.workspaceRootPath, { id: matcher.id, ts: Date.now(), ok: false, error: UNSUPPORTED_NATIVE_ROUTINE })
    }
    if (results.length) this.options.onScriptResults?.(results)
  }

  dispose(): void {
    if (this.bus && this.boundHandler) this.bus.offAny(this.boundHandler)
    this.bus = null
    this.boundHandler = null
  }
}
