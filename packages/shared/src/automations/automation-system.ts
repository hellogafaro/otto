/**
 * AutomationSystem - the event side of routines, one per workspace
 *
 * - Owns the workspace's EventBus and the handlers (prompt, webhook, script) that run the active event routines
 *   (`config.type = 'event'`, read from the `routines` table at every event, so a change applies at once)
 * - Diffs session metadata into events (labels, flags, status, permission mode)
 * - Schedules nothing: schedule routines are fired by the routines scheduler (./routine-runner.ts)
 */

import { initDb, type Db } from '../db/index.ts';
import { createLogger } from '../utils/debug.ts';
import { WorkspaceEventBus, type EventPayloadMap } from './event-bus.ts';
import { PromptHandler, WebhookHandler, ScriptHandler, type AutomationsConfigProvider } from './handlers/index.ts';
import { type AutomationsConfig, type AutomationEvent, type AutomationMatcher, type PendingPrompt, type WebhookActionResult, type ScriptActionResult, type AppEvent, type AgentEvent, type SdkAutomationCallbackMatcher, type SdkAutomationInput } from './types.ts';
import { matcherMatchesSdk } from './utils.ts';
import { resolveWebhookAction } from './routine-runner.ts';
import { getEventRoutines, getRoutines } from './routines.ts';
import type { Routine } from './routine-types.ts';

const log = createLogger('automation-system');

// Re-export SessionMetadataSnapshot from types (single source of truth)
export type { SessionMetadataSnapshot } from './types.ts';
import type { SessionMetadataSnapshot } from './types.ts';

// ============================================================================
// AutomationSystem Options
// ============================================================================

export interface AutomationSystemOptions {
  /** Workspace root path */
  workspaceRootPath: string;
  /** Workspace ID: whose routines run here, for logging and events */
  workspaceId: string;
  /** Working directory for command execution */
  workingDir?: string;
  /** Active source slugs for permission rules */
  activeSourceSlugs?: string[];
  /** Called when prompts are ready to be executed */
  onPromptsReady?: (prompts: PendingPrompt[]) => void;
  /** Called when webhook results are available */
  onWebhookResults?: (results: WebhookActionResult[]) => void;
  /** Called when script results are available */
  onScriptResults?: (results: ScriptActionResult[]) => void;
  /** Called when an error occurs during automation execution */
  onError?: (event: AutomationEvent, error: Error) => void;
  /** The database (default: the process-wide one) */
  db?: Db;
}

/** An event routine as the handlers' matcher: its id and title, and each webhook action's secret read into `auth`. */
function toMatcher(routine: Routine): AutomationMatcher {
  const { config } = routine;
  return {
    id: routine.id,
    name: routine.title,
    matcher: config.matcher,
    permissionMode: config.permissionMode,
    conditions: config.conditions,
    semanticCondition: config.semanticCondition,
    telegramTopic: config.telegramTopic,
    actions: config.actions.map((action) => {
      if (action.type !== 'webhook') return action;
      try {
        return resolveWebhookAction(action);
      } catch (error) {
        log.debug(`[AutomationSystem] Webhook credentials of ${routine.id} not read: ${error}`);
        const { secretId: _secretId, ...rest } = action;
        return rest;
      }
    }),
  };
}

// ============================================================================
// AutomationSystem Implementation
// ============================================================================

export class AutomationSystem implements AutomationsConfigProvider {
  readonly eventBus: WorkspaceEventBus;

  private readonly options: AutomationSystemOptions;
  private promptHandler: PromptHandler | null = null;
  private webhookHandler: WebhookHandler | null = null;
  private scriptHandler: ScriptHandler | null = null;
  private disposed = false;

  // Session metadata tracking (moved from SessionManager)
  private readonly lastKnownMetadata: Map<string, SessionMetadataSnapshot> = new Map();

  constructor(options: AutomationSystemOptions) {
    this.options = options;
    this.eventBus = new WorkspaceEventBus(options.workspaceId);
    this.createHandlers();
    log.debug(`[AutomationSystem] Created for workspace: ${options.workspaceId}`);
  }

  // ============================================================================
  // AutomationsConfigProvider Implementation
  // ============================================================================

  private get db(): Db {
    return this.options.db ?? initDb();
  }

  /** The workspace's active event routines as the handlers' config. */
  getConfig(): AutomationsConfig {
    const automations: AutomationsConfig['automations'] = {};
    for (const routine of getRoutines(this.options.workspaceId, this.db)) {
      const event = routine.config.event as AutomationEvent | undefined;
      if (routine.pausedAt !== null || routine.config.type !== 'event' || !event) continue;
      (automations[event] ??= []).push(toMatcher(routine));
    }
    return { automations };
  }

  getMatchersForEvent(event: AutomationEvent): AutomationMatcher[] {
    return getEventRoutines(this.options.workspaceId, event, this.db).map(toMatcher);
  }

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Create and register all handlers.
   */
  private createHandlers(): void {
    // Prompt handler
    this.promptHandler = new PromptHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onPromptsReady: this.options.onPromptsReady,
        onError: this.options.onError,
      },
      this
    );
    this.promptHandler.subscribe(this.eventBus);

    // Webhook handler
    this.webhookHandler = new WebhookHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onWebhookResults: this.options.onWebhookResults,
        onError: this.options.onError,
      },
      this
    );
    this.webhookHandler.subscribe(this.eventBus);

    // Script handler
    this.scriptHandler = new ScriptHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onScriptResults: this.options.onScriptResults,
        onError: this.options.onError,
      },
      this
    );
    this.scriptHandler.subscribe(this.eventBus);

    log.debug(`[AutomationSystem] Handlers created and subscribed`);
  }

  // ============================================================================
  // Session Metadata Diffing
  // ============================================================================

  /**
   * Update session metadata and emit events for changes.
   *
   * This replaces the diffing logic that was in SessionManager.
   * Call this whenever session metadata changes.
   *
   * @param sessionId - The session ID
   * @param next - The new metadata snapshot
   * @returns The events that were emitted
   */
  async updateSessionMetadata(
    sessionId: string,
    next: SessionMetadataSnapshot
  ): Promise<AppEvent[]> {
    const prev = this.lastKnownMetadata.get(sessionId) ?? {};
    const emittedEvents: AppEvent[] = [];
    const timestamp = Date.now();

    // Common fields for all events
    const sessionName = next.sessionName;
    const labels = next.labels ?? [];

    // Permission mode change
    if (prev.permissionMode !== next.permissionMode) {
      await this.eventBus.emit('PermissionModeChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        labels,
        oldMode: prev.permissionMode ?? '',
        newMode: next.permissionMode ?? '',
      });
      emittedEvents.push('PermissionModeChange');
    }

    // Labels (array diff)
    const prevLabels = new Set(prev.labels ?? []);
    const nextLabels = new Set(next.labels ?? []);

    for (const label of nextLabels) {
      if (!prevLabels.has(label)) {
        await this.eventBus.emit('LabelAdd', {
          sessionId,
          sessionName,
          workspaceId: this.options.workspaceId,
          timestamp,
          labels: [...nextLabels],
          label,
        });
        emittedEvents.push('LabelAdd');
      }
    }

    for (const label of prevLabels) {
      if (!nextLabels.has(label)) {
        await this.eventBus.emit('LabelRemove', {
          sessionId,
          sessionName,
          workspaceId: this.options.workspaceId,
          timestamp,
          labels: [...nextLabels],
          label,
        });
        emittedEvents.push('LabelRemove');
      }
    }

    // Flag change
    const wasFlagged = prev.isFlagged ?? false;
    const isFlagged = next.isFlagged ?? false;
    if (wasFlagged !== isFlagged) {
      await this.eventBus.emit('FlagChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        labels,
        isFlagged,
      });
      emittedEvents.push('FlagChange');
    }

    // Session status change
    if (prev.sessionStatus !== next.sessionStatus) {
      await this.eventBus.emit('SessionStatusChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        labels,
        oldState: prev.sessionStatus ?? '',
        newState: next.sessionStatus ?? '',
      });
      emittedEvents.push('SessionStatusChange');
    }

    // Update stored metadata
    this.lastKnownMetadata.set(sessionId, { ...next });

    if (emittedEvents.length > 0) {
      log.debug(`[AutomationSystem] Emitted ${emittedEvents.length} events for session ${sessionId}: ${emittedEvents.join(', ')}`);
    }

    return emittedEvents;
  }

  /**
   * Remove session metadata tracking.
   * Call this when a session is deleted.
   */
  removeSessionMetadata(sessionId: string): void {
    this.lastKnownMetadata.delete(sessionId);
    log.debug(`[AutomationSystem] Removed metadata for session ${sessionId}`);
  }

  /**
   * Get stored metadata for a session.
   */
  getSessionMetadata(sessionId: string): SessionMetadataSnapshot | undefined {
    return this.lastKnownMetadata.get(sessionId);
  }

  /**
   * Set initial metadata for a session (without emitting events).
   * Call this when loading existing sessions.
   */
  setInitialSessionMetadata(sessionId: string, metadata: SessionMetadataSnapshot): void {
    this.lastKnownMetadata.set(sessionId, { ...metadata });
  }

  // ============================================================================
  // Direct Event Emission
  // ============================================================================

  /**
   * Emit a LabelConfigChange event.
   * Call this when labels/config.json changes.
   */
  async emitLabelConfigChange(): Promise<void> {
    await this.eventBus.emit('LabelConfigChange', {
      workspaceId: this.options.workspaceId,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit an event directly (for edge cases).
   */
  async emit<T extends AutomationEvent>(event: T, payload: EventPayloadMap[T]): Promise<void> {
    await this.eventBus.emit(event, payload);
  }

  // ============================================================================
  // Agent Event Execution (Backend-Agnostic)
  // ============================================================================

  /**
   * Execute agent event automations directly (without going through the Claude SDK).
   * This is the backend-agnostic entry point for non-Claude backends (Codex, Copilot, Pi)
   * to fire agent events from event routines.
   *
   * For each matching automation matcher, builds env vars and evaluates matching.
   * Command execution has been removed — all automation actions now go through prompt-based
   * execution (creating agent sessions via PromptHandler).
   * Catches all errors — automations must never break the agent flow.
   *
   * @param signal - Optional AbortSignal for cancelling automation execution on abort
   * @returns Number of matched matchers (for diagnostics/testing)
   */
  async executeAgentEvent(event: AgentEvent, input: SdkAutomationInput, signal?: AbortSignal): Promise<number> {
    const matchers = this.getMatchersForEvent(event);
    if (!matchers.length) return 0;

    let matchedCount = 0;

    for (const matcher of matchers) {
      if (!matcherMatchesSdk(matcher, event, input)) continue;

      matchedCount++;

      // Note: Command execution has been removed. Prompt-based execution for
      // non-Claude backends is not yet implemented. This method currently only
      // validates matching (including condition gating) — actual execution is a no-op.
      log.debug(`[AutomationSystem] Matched ${event} automation (prompt-based execution pending)`);
    }

    return matchedCount;
  }

  // ============================================================================
  // SDK Automation Integration
  // ============================================================================

  /**
   * Build SDK hook callbacks from the workspace's event routines.
   *
   * Command execution has been removed — all automation actions now go through prompt-based
   * execution (creating agent sessions via PromptHandler). Agent event automations are not
   * currently supported via prompts, so this returns empty.
   */
  buildSdkHooks(): Partial<Record<AgentEvent, SdkAutomationCallbackMatcher[]>> {
    return {};
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Check if the system has been disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Dispose the automation system, cleaning up all resources.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    log.debug(`[AutomationSystem] Disposing for workspace: ${this.options.workspaceId}`);

    // Dispose handlers
    this.promptHandler?.dispose();
    this.webhookHandler?.dispose();
    this.scriptHandler?.dispose();

    // Dispose event bus
    this.eventBus.dispose();

    // Clear metadata
    this.lastKnownMetadata.clear();

    this.disposed = true;
    log.debug(`[AutomationSystem] Disposed`);
  }
}
