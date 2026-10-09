/**
 * ISessionManager — abstract interface for the session lifecycle engine.
 *
 * Handler code in server-core programs against this interface;
 * concrete implementations (Electron SessionManager, headless, etc.)
 * satisfy it at runtime.
 */

import type { Workspace, WorkspaceInfo, ActiveSessionInfo } from '@otto/core/types'
import type { StoredAttachment, AnnotationV1 } from '@otto/core/types'
import type { PermissionMode } from '@otto/shared/agent/mode-types'
import type { ThinkingLevel } from '@otto/shared/agent/thinking-levels'
import type { AuthResult } from '@otto/shared/agent'
import type {
  Session,
  SessionStatus,
  CreateSessionOptions,
  FileAttachment,
  SendMessageOptions,
  PermissionResponseOptions,
  CredentialResponse,
  PermissionModeState,
  UnreadSummary,
  ShareResult,
} from '@otto/shared/protocol'
import type { SessionBundle, DispatchMode } from '@otto/shared/sessions'
import type { EventSink } from '../transport'

export interface ISessionManager {
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  waitForInit(): Promise<void>
  initialize(): Promise<void>
  cleanup(): void | Promise<void>
  setEventSink(sink: EventSink): void
  flushAllSessions(): Promise<void>

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  /** `viewerId` narrows to the chats that user is a member of (and gives their own unread state); omit it only for server-side callers. */
  getSessions(workspaceId?: string, viewerId?: string | null): Session[]
  /** Whether the user may see the chat; a chat that does not exist is not visible. */
  canSeeSession(sessionId: string, userId: string | null): boolean
  /** Who owns a workspace; the host wires it from the database. */
  setWorkspaceOwners(owners: (workspaceId: string) => string[]): void
  /** A chat with every message, or (with `page`) the newest page or the one before `page.beforeId`, with `olderMessageCount`. */
  getSession(sessionId: string, page?: { beforeId?: string; limit?: number }, viewerId?: string | null): Promise<Session | null>
  /** Creates a session and (unless `internal.emitCreatedEvent === false`) announces it to the
   *  renderer so it hydrates full metadata instead of fabricating a "New Chat" placeholder. */
  createSession(
    workspaceId: string,
    options?: CreateSessionOptions,
    internal?: { emitCreatedEvent?: boolean; createdBy?: string | null; contextEntity?: string },
  ): Promise<Session>
  /** `callerId` (a person's request): only the chat's creator may delete it. */
  deleteSession(sessionId: string, callerId?: string | null): Promise<void>

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  flagSession(sessionId: string): Promise<void>
  unflagSession(sessionId: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, name: string): Promise<void>
  setSessionStatus(sessionId: string, status: SessionStatus): Promise<void>
  /** Read state is per member person; `userId` omitted = the chat's creator (server-side callers). */
  markSessionRead(sessionId: string, userId?: string | null): Promise<void>
  markSessionUnread(sessionId: string, userId?: string | null): Promise<void>
  markAllSessionsRead(workspaceId: string, viewerId?: string | null): Promise<void>
  setActiveViewingSession(sessionId: string | null, workspaceId: string, userId?: string | null): void
  /** Members (docs/schema.md "Chats"): the creator adds people or agents and removes members; anyone else may leave. */
  addSessionMembers(sessionId: string, callerId: string | null, actors: string[]): Promise<void>
  removeSessionMember(sessionId: string, callerId: string | null, actor: string): Promise<void>
  leaveSession(sessionId: string, callerId: string | null): Promise<void>

  // ---------------------------------------------------------------------------
  // Session configuration
  // ---------------------------------------------------------------------------

  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void
  updateWorkingDirectory(sessionId: string, path: string): void
  setSessionSources(sessionId: string, sourceSlugs: string[]): Promise<void>
  setSessionLabels(sessionId: string, labels: string[]): void
  setSessionProjectId(sessionId: string, projectId: string | null): Promise<void>
  setSessionConnection(sessionId: string, connectionSlug: string): Promise<void>
  updateSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void>

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  sendMessage(
    sessionId: string,
    message: string,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[],
    options?: SendMessageOptions,
    existingMessageId?: string,
    _isAuthRetry?: boolean,
    onAck?: (messageId: string) => void,
  ): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean, expectedRunId?: string): Promise<void>
  addMessageAnnotation(sessionId: string, messageId: string, annotation: AnnotationV1): void
  removeMessageAnnotation(sessionId: string, messageId: string, annotationId: string): void
  updateMessageAnnotation(
    sessionId: string,
    messageId: string,
    annotationId: string,
    patch: Partial<AnnotationV1>,
  ): void

  // ---------------------------------------------------------------------------
  // Permissions & credentials
  // ---------------------------------------------------------------------------

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: PermissionResponseOptions,
    userId?: string,
  ): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>
  respondToNativeQuestion(sessionId: string, requestId: string, answer: string | string[], userId?: string): Promise<boolean>
  getSessionPermissionModeState(sessionId: string): PermissionModeState | null

  // ---------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------

  setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void>
  markPendingPlanExecutionDispatched(sessionId: string): Promise<boolean>
  clearPendingPlanExecution(sessionId: string): Promise<void>
  getPendingPlanExecution(sessionId: string): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null
  markCompactionComplete(sessionId: string): Promise<void>

  /**
   * Send the plan-approval "I approve this plan, please execute it" message
   * to the session as if the user had clicked "Accept plan" in the desktop UI.
   * If the session is in Explore (safe) mode, also switches it to allow-all
   * so the plan can actually run without per-tool prompts.
   *
   * Used by the messaging gateway so Telegram/WhatsApp accept buttons produce
   * the same server-side effect as the desktop accept button.
   */
  acceptPlan(sessionId: string, planPath?: string): Promise<void>

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  shareToViewer(sessionId: string): Promise<ShareResult>
  updateShare(sessionId: string): Promise<ShareResult>
  revokeShare(sessionId: string): Promise<ShareResult>

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  /**
   * Export a session as a portable bundle.
   * Flushes pending writes, serializes session data + files.
   * Session must be stopped before export.
   */
  exportSession(sessionId: string, workspaceId: string): Promise<SessionBundle | null>

  /**
   * Export a session as a summary-based payload for cross-server transfer.
   * Generates a mini-model summary instead of shipping the full transcript.
   */
  exportRemoteSessionTransfer(
    sessionId: string,
    workspaceId: string,
    userId?: string,
  ): Promise<import('@otto/shared/protocol').RemoteSessionTransferPayload | null>

  /**
   * Import a session bundle into a target workspace.
   * Creates session directory, writes JSONL + files, registers in memory.
   * Returns the new session ID and any compatibility warnings.
   */
  importSession(
    workspaceId: string,
    bundle: SessionBundle,
    mode: DispatchMode,
    /** Actor ('user:<id>') the imported chat belongs to. */
    createdBy?: string,
  ): Promise<{ sessionId: string; warnings?: string[] }>

  /**
   * Import a summary-based remote transfer payload into a target workspace.
   */
  importRemoteSessionTransfer(
    workspaceId: string,
    payload: import('@otto/shared/protocol').RemoteSessionTransferPayload,
    createdBy?: string,
  ): Promise<import('@otto/shared/protocol').ImportRemoteSessionTransferResult>

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  getSessionPath(sessionId: string): string | null
  refreshTitle(sessionId: string, options?: { onlyIfName?: string }, userId?: string): Promise<{ success: boolean; title?: string; error?: string }>
  refreshBadge(): void
  getUnreadSummary(viewerId?: string | null): UnreadSummary

  // ---------------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------------

  getWorkspaces(): Workspace[]
  /** Return client-safe workspace list (no rootPath) for remote clients. */
  getWorkspacesInfo(): WorkspaceInfo[]
  setupConfigWatcher(workspaceRootPath: string, workspaceId: string): void
  /**
   * Manually notify the ConfigWatcher of a file change.
   * Workaround for Bun's fs.watch on Linux not detecting atomic renames.
   */
  notifyConfigFileChange(workspaceRootPath: string, relativePath: string): void

  /** Fires the `LabelConfigChange` automation event of a workspace after its labels were edited. */
  emitLabelConfigChange(workspaceId: string): void

  // ---------------------------------------------------------------------------
  // Server-level observability
  // ---------------------------------------------------------------------------

  /** Count of sessions with active backend processes. Pass workspaceId to scope. */
  getActiveSessionCount(workspaceId?: string): number
  /** Automation summary for a workspace (count of configured automations + scheduler state). */
  getWorkspaceAutomationSummary(workspaceId: string): { automationCount: number; schedulerRunning: boolean }
  /** Active sessions across all workspaces (sessions with running backend processes). */
  getActiveSessionsInfo(viewerId?: string | null): ActiveSessionInfo[]

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /**
   * Push runtime updates (e.g. capability toggles) to every active session
   * that uses the given connection. Backstopped by the lazy refresh path in
   * `getOrCreateAgent`.
   */
  completeAuthRequest(sessionId: string, result: AuthResult): Promise<void>
  executePromptAutomation(input: ExecutePromptAutomationInput): Promise<{ sessionId: string }>

}

/**
 * Input for executePromptAutomation. Options-object form replaces the
 * previous positional-args signature once the param list grew past
 * readability — new optional fields (thinkingLevel, future cwd/permissions
 * overrides) can be added without churn at every call site.
 */
export interface ExecutePromptAutomationInput {
  workspaceId: string
  workspaceRootPath: string
  prompt: string
  labels?: string[]
  permissionMode?: PermissionMode
  mentions?: string[]
  llmConnection?: string
  llmConnectionId?: string
  model?: string
  /** Override the workspace default thinking level for the spawned session. */
  thinkingLevel?: ThinkingLevel
  automationName?: string
  /** Matcher id of the automation (stored on the session for the loop guard). */
  automationId?: string
  /** Event that fired the automation. */
  triggerEvent?: string
  /** Chain depth of the new session (see `automationLoopGuard`); 1 when omitted. */
  chainDepth?: number
  /** Actual human actor ('user:<id>') that authorized the routine. */
  createdBy?: string
  /** The agent the new chat talks to (`agents` row id); omitted, the workspace's default agent. */
  agentId?: string
  /** The project the new chat is bound to. */
  projectId?: string
  /**
   * When `false`, `executePromptAutomation` returns as soon as the session is
   * created and the prompt is dispatched, instead of awaiting the whole turn.
   * Used by the automation **Test** action so a long run (tools / >30s output)
   * doesn't trip the RPC client timeout (otto#943). The session
   * still streams live and run errors are logged. Defaults to awaiting completion.
   */
  waitForCompletion?: boolean
}
