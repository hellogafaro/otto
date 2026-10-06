// =============================================================================
// Protocol re-exports (channels, DTOs, events, wire types)
// =============================================================================
export * from '@otto/shared/protocol'

// =============================================================================
// Package re-exports (convenience for renderer imports)
// =============================================================================

// Core types
import type {
  Message as CoreMessage,
  MessageRole as CoreMessageRole,
  TypedError,
  TokenUsage as CoreTokenUsage,
  WorkspaceInfo as CoreWorkspaceInfo,
  Workspace as CoreWorkspace,
  SessionMetadata as CoreSessionMetadata,
  StoredAttachment as CoreStoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
  AnnotationV1,
} from '@otto/core/types';

import type { Agent, AgentInput, AgentUpdate } from '@otto/shared/agents/types';
export type { Agent, AgentInput, AgentUpdate };
import type { LibraryContent, LibraryFilter, LibraryItem, LibraryUpdate } from '@otto/shared/library/types';
export type { LibraryContent, LibraryFilter, LibraryItem, LibraryUpdate };

import type { Project, ProjectFilter, ProjectStatus, ProjectUpdate, Resource } from '@otto/shared/projects/types';
import type { Task, TaskFilter, TaskStatus, TaskUpdate, Timesheet } from '@otto/shared/tasks/types';
import type { Comment } from '@otto/shared/comments/types';
import type { NotificationItem, NotificationType } from '@otto/shared/notifications/types';
import type { DomainChange } from '@otto/shared/protocol';
export type { Comment, DomainChange, NotificationItem, NotificationType };
export type { Project, ProjectFilter, ProjectStatus, ProjectUpdate, Resource, Task, TaskFilter, TaskStatus, TaskUpdate, Timesheet };

import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '@otto/shared/workspaces';
export type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole };

import type { InboxSearch, LibrarySearch, ProjectsSearch, SkillsSearch, TasksSearch } from './section-search';

// Mode types from dedicated subpath export (avoids pulling in SDK)
import type { PermissionMode } from '@otto/shared/agent/modes';
export type { PermissionMode };
export { PERMISSION_MODE_CONFIG } from '@otto/shared/agent/modes';

// Thinking level types
import type { ThinkingLevel } from '@otto/shared/agent/thinking-levels';
export type { ThinkingLevel };
export { THINKING_LEVELS, DEFAULT_THINKING_LEVEL } from '@otto/shared/agent/thinking-levels';

export type {
  CoreMessage as Message,
  CoreMessageRole as MessageRole,
  TypedError,
  CoreTokenUsage as TokenUsage,
  CoreWorkspaceInfo as WorkspaceInfo,
  CoreWorkspace as Workspace,
  CoreSessionMetadata as SessionMetadata,
  CoreStoredAttachment as StoredAttachment,
  ContentBadge,
  ToolDisplayMeta,
  AnnotationV1,
};

// Auth types for onboarding
import type { AuthState, SetupNeeds } from '@otto/shared/auth/types';
import type { AuthType } from '@otto/shared/config/types';
export type { AuthState, SetupNeeds, AuthType };

// Credential health types
import type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType } from '@otto/shared/credentials/types';
export type { CredentialHealthStatus, CredentialHealthIssue, CredentialHealthIssueType };

// Source types for session source selection
import type { LoadedSource, FolderSourceConfig, SourceConnectionStatus } from '@otto/shared/sources/types';
export type { LoadedSource, FolderSourceConfig, SourceConnectionStatus };

// Skill types
import type { LoadedSkill, SkillMetadata } from '@otto/shared/skills/types';
export type { LoadedSkill, SkillMetadata };

// Resource bundle types (cross-workspace export/import)
import type { ExportResourcesOptions, ExportResult, ResourceImportMode, ResourceBundle, ResourceImportResult } from '@otto/shared/resources';
export type { ExportResourcesOptions, ExportResult, ResourceImportMode, ResourceBundle, ResourceImportResult };

// LLM connection types
import type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType } from '@otto/shared/config';
export type { LlmConnection, LlmConnectionWithStatus, LlmAuthType, LlmProviderType };
import type {
  DecisionLayerFeature,
  DecisionLayerSettings,
  DecisionLayerSettingsPatch,
  DecisionLayerStatus,
  DecisionProviderId,
  DecisionServerProbe,
  DecisionTestResult,
} from '@otto/shared/decisions';
export type { DecisionLayerFeature, DecisionLayerSettings, DecisionLayerSettingsPatch, DecisionLayerStatus, DecisionProviderId, DecisionServerProbe, DecisionTestResult };

// =============================================================================
// GUI-only types (not used by server/handler code)
// =============================================================================

/**
 * Browser toolbar window IPC channels (preload <-> BrowserPaneManager).
 * Kept separate from RPC_CHANNELS because these are scoped to toolbar windows.
 */
export const BROWSER_TOOLBAR_CHANNELS = {
  NAVIGATE: 'browser-toolbar:navigate',
  GO_BACK: 'browser-toolbar:go-back',
  GO_FORWARD: 'browser-toolbar:go-forward',
  RELOAD: 'browser-toolbar:reload',
  STOP: 'browser-toolbar:stop',
  OPEN_MENU: 'browser-toolbar:open-menu',
  HIDE: 'browser-toolbar:hide',
  DESTROY: 'browser-toolbar:destroy',
  STATE_UPDATE: 'browser-toolbar:state-update',
  THEME_COLOR: 'browser-toolbar:theme-color',
} as const

/** Tool icon mapping entry from tool-icons.json (with icon resolved to data URL) */
export interface ToolIconMapping {
  id: string
  displayName: string
  /** Data URL of the icon (e.g., data:image/png;base64,...) */
  iconDataUrl: string
  commands: string[]
}

/**
 * Empty-state launch request from the browser empty-state renderer.
 */
export interface BrowserEmptyStateLaunchPayload {
  route: string
  token?: string
}

/**
 * Result of browser empty-state launch handling.
 */
export interface BrowserEmptyStateLaunchResult {
  ok: boolean
  handled: boolean
  reason?: string
}

export type TransportMode = 'local' | 'remote'

export type TransportConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'

export type TransportConnectionErrorKind =
  | 'auth'
  | 'protocol'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown'

export interface TransportConnectionError {
  kind: TransportConnectionErrorKind
  message: string
  code?: string
}

export interface TransportCloseInfo {
  code?: number
  reason?: string
  wasClean?: boolean
}

export interface TransportConnectionState {
  mode: TransportMode
  status: TransportConnectionStatus
  url: string
  attempt: number
  nextRetryInMs?: number
  lastError?: TransportConnectionError
  lastClose?: TransportCloseInfo
  updatedAt: number
}

// =============================================================================
// ElectronAPI — type-safe IPC API exposed to renderer
// =============================================================================

// Re-import types for ElectronAPI
import type { WorkspaceInfo, Workspace, StoredAttachment as StoredAttachmentType } from '@otto/core/types';

// Import protocol types used by ElectronAPI (they come through the `export *` above,
// but we need them in scope for the interface definition)
import type {
  Session,
  UnreadSummary,
  CreateSessionOptions,
  FileAttachment,
  SendMessageOptions,
  SessionEvent,
  PermissionResponseOptions,
  CredentialResponse,
  SessionCommand,
  ShareResult,
  RefreshTitleResult,
  FileSearchResult,
  SessionSearchResult,
  LlmConnectionSetup,
  TestLlmConnectionParams,
  TestLlmConnectionResult,
  SkillFile,
  SessionFile,
  OAuthResult,
  McpToolsResult,
  GitBashStatus,
  ClaudeOAuthResult,
  UpdateInfo,
  WorkspaceSettings,
  PermissionModeState,
  BrowserInstanceInfo,
  DeepLinkNavigation,
  TestAutomationPayload,
  TestAutomationResult,
  WindowCloseRequest,
  DirectoryListingResult,
  RemoteSessionTransferPayload,
  ImportRemoteSessionTransferResult,
} from '@otto/shared/protocol'

export interface ElectronAPI {
  // Session management
  getSessions(): Promise<Session[]>
  getUnreadSummary(): Promise<UnreadSummary>
  markAllSessionsRead(workspaceId: string): Promise<void>
  getSessionMessages(sessionId: string): Promise<Session | null>
  createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachmentType[], options?: SendMessageOptions): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>

  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean, options?: PermissionResponseOptions): Promise<boolean>
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>

  // Consolidated session command handler
  sessionCommand(sessionId: string, command: Extract<SessionCommand, { type: 'markPendingPlanExecutionDispatched' }>): Promise<boolean>
  sessionCommand(sessionId: string, command: Exclude<SessionCommand, { type: 'markPendingPlanExecutionDispatched' }>): Promise<void | ShareResult | RefreshTitleResult | { count: number }>

  // Server info (REMOTE_ELIGIBLE — returns data from whichever server owns the workspace)
  getServerHomeDir(): Promise<string>

  // Server mode configuration
  getServerConfig(): Promise<import('@otto/shared/config/server-config').ServerConfig>
  setServerConfig(config: import('@otto/shared/config/server-config').ServerConfig): Promise<void>
  getServerStatus(): Promise<import('@otto/shared/config/server-config').ServerStatus>

  // App lifecycle
  relaunchApp(): Promise<void>
  removeWorkspace(workspaceId: string): Promise<boolean>
  invokeOnServer(url: string, token: string, channel: string, ...args: any[]): Promise<any>

  // Remote session transfer (main-process orchestrated, supports chunked upload)
  transferSessionToWorkspace(sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number): Promise<{ sessionId: string }>
  onTransferProgress(callback: (progress: { sessionIndex: number; sessionCount: number; chunkSent: number; chunkTotal: number }) => void): () => void

  // Session export/import (cross-workspace transfer)
  exportSession(sessionId: string): Promise<unknown>
  importSession(targetWorkspaceId: string, bundle: unknown, mode: 'move' | 'fork'): Promise<{ sessionId: string; warnings?: string[] }>
  exportRemoteSessionTransfer(sessionId: string): Promise<RemoteSessionTransferPayload>
  importRemoteSessionTransfer(targetWorkspaceId: string, payload: RemoteSessionTransferPayload): Promise<ImportRemoteSessionTransferResult>
  getSessionShareCapabilities(): Promise<{ viewerConfigured: boolean }>

  // Pending plan execution (for reload recovery)
  getPendingPlanExecution(sessionId: string): Promise<{ planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null>
  // Permission mode reconciliation
  getSessionPermissionModeState(sessionId: string): Promise<PermissionModeState | null>

  // Workspace management
  getWorkspaces(): Promise<Workspace[]>
  createWorkspace(folderPath: string, name: string, remoteServer?: { url: string; token: string; remoteWorkspaceId: string }): Promise<Workspace>
  checkWorkspaceSlug(slug: string): Promise<{ exists: boolean; path: string }>
  updateWorkspaceRemoteServer(workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }): Promise<{ success: boolean }>
  // Workspace members and invitations (docs/users-and-workspaces.md). Any member reads the members;
  // owners manage the rest. Failures carry `forbidden`, `not_found`, `invalid` or `conflict` (a workspace keeps an owner).
  getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]>
  getWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]>
  inviteWorkspaceMember(workspaceId: string, email: string): Promise<WorkspaceInvitation>
  revokeWorkspaceInvitation(id: string): Promise<void>
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>
  updateWorkspaceMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>
  leaveWorkspace(workspaceId: string): Promise<void>

  // Server-level workspace operations (for thin client / remote workspace discovery)
  getServerWorkspaces(): Promise<WorkspaceInfo[]>
  createServerWorkspace(name: string): Promise<WorkspaceInfo>

  testRemoteConnection(url: string, token: string): Promise<{
    ok: boolean
    error?: string
    needsWorkspace?: boolean
    remoteWorkspaces?: Array<{ id: string; name: string }>
    remoteWorkspaceId?: string   // auto-set when exactly one workspace
    remoteWorkspaceName?: string // auto-set when exactly one workspace
    serverVersion?: string       // server app version from handshake
  }>

  // Window management
  getWindowWorkspace(): Promise<string | null>
  switchWorkspace(workspaceId: string): Promise<void>
  closeWindow(): Promise<void>
  confirmCloseWindow(): Promise<void>
  /** Cancel a pending close request (renderer handled it by closing a modal/panel). */
  cancelCloseWindow(): Promise<void>
  /** Listen for close requests and receive source metadata. Returns cleanup function. */
  onCloseRequested(callback: (request: WindowCloseRequest) => void): () => void
  /** Show/hide macOS traffic light buttons (for fullscreen overlays) */
  setTrafficLightsVisible(visible: boolean): Promise<void>

  // Event listeners
  onSessionEvent(callback: (event: SessionEvent) => void): () => void
  onUnreadSummaryChanged(callback: (summary: UnreadSummary) => void): () => void

  // File operations
  readFile(path: string): Promise<string>
  /** Read a file as binary data (Uint8Array) */
  readFileBinary(path: string): Promise<Uint8Array>
  /** Read a file as a data URL (data:{mime};base64,...) for binary preview (images, PDFs) */
  readFileDataUrl(path: string): Promise<string>
  /** Read an image file as a size-bounded preview data URL for lightweight thumbnail rendering. */
  readFilePreviewDataUrl(path: string, maxSize?: number): Promise<string>
  openFileDialog(): Promise<string[]>
  readFileAttachment(path: string): Promise<FileAttachment | null>
  /** Re-read a user-attached file by absolute path (bypasses workspace-dir validation).
   *  Used only by draft hydration for paths the user explicitly picked via OS dialog / drag. */
  readUserAttachment(path: string): Promise<FileAttachment | null>
  storeAttachment(attachment: FileAttachment): Promise<import('../../../../packages/core/src/types/index.ts').StoredAttachment>
  generateThumbnail(base64: string, mimeType: string): Promise<string | null>

  // Agents (docs/final-plan.md 2.7). The workspace is the window's. Any member lists, gets and creates (provider left out =
  // the caller's default one); updating and deleting is the agent's creator or a workspace owner. `updateAgent` may send
  // the `updatedAt` last seen as `expectedUpdatedAt`; a stale one is refused. The last agent cannot be deleted.
  getAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  createAgent(input: Omit<AgentInput, 'workspaceId' | 'createdBy' | 'provider'> & { provider?: string }): Promise<Agent>
  updateAgent(id: string, patch: AgentUpdate): Promise<Agent>
  deleteAgent(id: string): Promise<void>

  // Library (files, documents and folders; see docs/library.md). Updates that replace
  // content must send the item's last seen `updatedAt` as `expectedUpdatedAt`.
  createLibraryItem(input: { title: string; mime: string; content: LibraryContent; parentId?: string | null }): Promise<LibraryItem>
  createLibraryFolder(input: { title: string; parentId?: string | null }): Promise<LibraryItem>
  getLibraryItems(filter?: LibraryFilter): Promise<LibraryItem[]>
  getLibraryItem(id: string): Promise<LibraryItem | null>
  readLibraryItem(id: string): Promise<{ item: LibraryItem; content: LibraryContent }>
  updateLibraryItem(id: string, patch: LibraryUpdate): Promise<LibraryItem>
  deleteLibraryItem(id: string): Promise<void>
  /** Returns the absolute filesystem path for a File (only works for file-picker / OS-drag Files). */
  getFilePath(file: File): string | null

  // Filesystem search (for @ mention file selection)
  searchFiles(basePath: string, query: string): Promise<FileSearchResult[]>

  // Server filesystem browsing (remote mode)
  listServerDirectory(dirPath: string): Promise<DirectoryListingResult>
  // Debug: send renderer logs to main process log file
  debugLog(...args: unknown[]): void

  // Theme
  getSystemTheme(): Promise<boolean>
  onSystemThemeChange(callback: (isDark: boolean) => void): () => void

  // System
  getVersions(): { node: string; chrome: string; electron: string }
  /** Returns the renderer host environment without going through RPC. */
  getRuntimeEnvironment(): 'electron' | 'web'
  getHomeDir(): Promise<string>
  isDebugMode(): Promise<boolean>

  // Transport connection status (preload-local, not RPC channels)
  getTransportConnectionState(): Promise<TransportConnectionState>
  onTransportConnectionStateChanged(callback: (state: TransportConnectionState) => void): () => void
  reconnectTransport(): Promise<void>

  /** Fired after a WebSocket reconnect. isStale=true means buffer was evicted — full refresh needed. */
  onReconnected(callback: (isStale: boolean) => void): () => void

  /** Check whether the server registered a handler for a given RPC channel. */
  isChannelAvailable(channel: string): boolean

  // Auto-update
  checkForUpdates(): Promise<UpdateInfo>
  getUpdateInfo(): Promise<UpdateInfo>
  installUpdate(): Promise<void>
  dismissUpdate(version: string): Promise<void>
  getDismissedUpdateVersion(): Promise<string | null>
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  onUpdateDownloadProgress(callback: (progress: number) => void): () => void

  // Release notes

  // System warnings (startup checks)
  getSystemWarnings(): Promise<{ vcredistMissing: boolean; downloadUrl?: string }>

  // Shell operations
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>

  // Menu event listeners
  onMenuNewChat(callback: () => void): () => void
  onMenuOpenSettings(callback: () => void): () => void
  onMenuKeyboardShortcuts(callback: () => void): () => void

  // Deep link navigation listener (for external otto:// URLs)
  onDeepLinkNavigate(callback: (nav: DeepLinkNavigation) => void): () => void

  // Auth
  showDeleteSessionConfirmation(name: string): Promise<boolean>

  // Credential health check (startup validation)
  getCredentialHealth(): Promise<CredentialHealthStatus>

  // Onboarding
  getAuthState(): Promise<AuthState>
  getSetupNeeds(): Promise<SetupNeeds>
  startWorkspaceMcpOAuth(mcpUrl: string): Promise<OAuthResult & { clientId?: string }>
  // Claude OAuth (two-step flow)
  startClaudeOAuth(): Promise<{ success: boolean; authUrl?: string; error?: string }>
  exchangeClaudeCode(code: string, connectionSlug: string): Promise<ClaudeOAuthResult>
  hasClaudeOAuthState(): Promise<boolean>
  clearClaudeOAuthState(): Promise<{ success: boolean }>
  /** Defer onboarding setup — user chose "Setup later" */
  deferSetup(): Promise<{ success: boolean }>

  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  startChatGptOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelChatGptOAuth(): Promise<{ success: boolean }>
  getChatGptAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean; expiresAt?: number; hasRefreshToken?: boolean }>
  chatGptLogout(connectionSlug: string): Promise<{ success: boolean }>
  onChatGptDeviceCode(callback: (data: { userCode: string; verificationUri: string }) => void): () => void

  // GitHub Copilot OAuth
  startCopilotOAuth(connectionSlug: string): Promise<{ success: boolean; error?: string }>
  cancelCopilotOAuth(): Promise<{ success: boolean }>
  getCopilotAuthStatus(connectionSlug: string): Promise<{ authenticated: boolean }>
  copilotLogout(connectionSlug: string): Promise<{ success: boolean }>
  onCopilotDeviceCode(callback: (data: { userCode: string; verificationUri: string }) => void): () => void

  /** Unified LLM connection setup */
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  /** Unified connection test — spawns a lightweight agent subprocess to validate credentials */
  testLlmConnectionSetup(params: TestLlmConnectionParams): Promise<TestLlmConnectionResult>
  // Pi provider discovery (main process only — Pi SDK can't run in renderer)
  getPiApiKeyProviders(): Promise<Array<{ key: string; label: string; placeholder: string }>>
  getPiProviderBaseUrl(provider: string): Promise<string | undefined>
  getPiProviderModels(provider: string): Promise<{ models: Array<{ id: string; name: string; costInput: number; costOutput: number; contextWindow: number; reasoning: boolean }>; totalCount: number }>

  // Session-specific model (overrides global)
  getSessionModel(sessionId: string, workspaceId: string): Promise<string | null>
  setSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void>

  // Workspace Settings (per-workspace configuration)
  getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings | null>
  updateWorkspaceSetting<K extends keyof WorkspaceSettings>(workspaceId: string, key: K, value: WorkspaceSettings[K]): Promise<void>

  // Folder dialog
  openFolderDialog(): Promise<string | null>

  // User Preferences
  readPreferences(): Promise<{ content: string }>
  writePreferences(content: string): Promise<{ success: boolean; error?: string }>

  // Session Drafts (persisted composer state — text + attachment refs)
  getDraft(sessionId: string): Promise<import('@otto/shared/config').SessionDraft | null>
  setDraft(sessionId: string, draft: import('@otto/shared/config').SessionDraft): Promise<void>
  deleteDraft(sessionId: string): Promise<void>
  getAllDrafts(): Promise<Record<string, import('@otto/shared/config').SessionDraft>>

  // Session Info Panel
  getSessionFiles(sessionId: string): Promise<SessionFile[]>
  getSessionNotes(sessionId: string): Promise<string>
  setSessionNotes(sessionId: string, content: string): Promise<void>
  watchSessionFiles(sessionId: string): Promise<void>
  unwatchSessionFiles(): Promise<void>
  onSessionFilesChanged(callback: (sessionId: string) => void): () => void

  // Sources
  getSources(workspaceId: string): Promise<LoadedSource[]>
  createSource(workspaceId: string, config: Partial<FolderSourceConfig>): Promise<FolderSourceConfig>
  deleteSource(workspaceId: string, sourceSlug: string): Promise<void>
  startSourceOAuth(workspaceId: string, sourceSlug: string): Promise<{ success: boolean; error?: string }>
  saveSourceCredentials(workspaceId: string, sourceSlug: string, credential: string): Promise<void>
  getSourcePermissionsConfig(workspaceId: string, sourceSlug: string): Promise<import('@otto/shared/agent').PermissionsConfigFile | null>
  getWorkspacePermissionsConfig(workspaceId: string): Promise<import('@otto/shared/agent').PermissionsConfigFile | null>
  getDefaultPermissionsConfig(): Promise<{ config: import('@otto/shared/agent').PermissionsConfigFile | null; path: string }>
  getMcpTools(workspaceId: string, sourceSlug: string): Promise<McpToolsResult>

  // OAuth (server-owned credentials, client-orchestrated flow)
  performOAuth(args: { sourceSlug: string; sessionId?: string; authRequestId?: string }): Promise<{ success: boolean; error?: string; email?: string }>
  oauthRevoke(sourceSlug: string): Promise<{ success: boolean }>

  // Session content search (full-text search via ripgrep)
  searchSessionContent(workspaceId: string, query: string, searchId?: string): Promise<SessionSearchResult[]>

  // Sources change listener (live updates when sources are added/removed)
  onSourcesChanged(callback: (workspaceId: string, sources: LoadedSource[]) => void): () => void
  onSourceConflict(callback: (workspaceId: string, slug: string) => void): () => void

  // Default permissions change listener (live updates when default.json changes)
  onDefaultPermissionsChanged(callback: () => void): () => void

  // Skills
  getSkills(workspaceId: string): Promise<LoadedSkill[]>
  getSkillFiles?(workspaceId: string, skillSlug: string): Promise<SkillFile[]>
  deleteSkill(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInEditor(workspaceId: string, skillSlug: string): Promise<void>
  openSkillInFinder(workspaceId: string, skillSlug: string): Promise<void>

  // Skills change listener (live updates when skills are added/removed/modified)
  onSkillsChanged(callback: (workspaceId: string, skills: LoadedSkill[]) => void): () => void
  /** A skill's edited folder lost to a newer version elsewhere: the folder was reloaded and the edit kept aside. */
  onSkillConflict(callback: (workspaceId: string, slug: string) => void): () => void

  // Statuses (workspace-scoped)
  listStatuses(workspaceId: string): Promise<import('@otto/shared/statuses').StatusConfig[]>
  reorderStatuses(workspaceId: string, orderedIds: string[]): Promise<void>

  // Labels (workspace-scoped)
  listLabels(workspaceId: string): Promise<import('@otto/shared/labels').LabelConfig[]>
  createLabel(workspaceId: string, input: import('@otto/shared/labels').CreateLabelInput): Promise<import('@otto/shared/labels').LabelConfig>
  deleteLabel(workspaceId: string, labelId: string): Promise<{ stripped: number }>

  // LLM connections change listener
  onLlmConnectionsChanged(callback: () => void): () => void

  // Generic workspace image loading/saving
  readWorkspaceImage(workspaceId: string, relativePath: string): Promise<string>
  writeWorkspaceImage(workspaceId: string, relativePath: string, base64: string, mimeType: string): Promise<void>

  // Tool icon mappings
  getToolIconMappings(): Promise<ToolIconMapping[]>

  // Theme (app-level default)
  getAppTheme(): Promise<import('@config/theme').ThemeOverrides | null>
  loadPresetThemes(): Promise<import('@config/theme').PresetTheme[]>
  loadPresetTheme(themeId: string): Promise<import('@config/theme').PresetTheme | null>
  getColorTheme(): Promise<string>
  setColorTheme(themeId: string): Promise<void>

  // Theme change listeners
  onAppThemeChange(callback: (theme: import('@config/theme').ThemeOverrides | null) => void): () => void

  // Logo URL resolution
  getLogoUrl(serviceUrl: string, provider?: string): Promise<string | null>

  // Notifications
  showNotification(title: string, body: string, workspaceId: string, sessionId: string): Promise<void>
  getNotificationsEnabled(): Promise<boolean>
  setNotificationsEnabled(enabled: boolean): Promise<void>

  // Input settings
  getAutoCapitalisation(): Promise<boolean>
  setAutoCapitalisation(enabled: boolean): Promise<void>
  getSendMessageKey(): Promise<'enter' | 'cmd-enter'>
  setSendMessageKey(key: 'enter' | 'cmd-enter'): Promise<void>
  getSpellCheck(): Promise<boolean>
  setSpellCheck(enabled: boolean): Promise<void>

  // Power settings
  getKeepAwakeWhileRunning(): Promise<boolean>
  setKeepAwakeWhileRunning(enabled: boolean): Promise<void>

  // Tools settings

  // Appearance settings
  getRichToolDescriptions(): Promise<boolean>
  setRichToolDescriptions(enabled: boolean): Promise<void>

  // Prompt caching & context


  // Decision model (Jev / TypeSafe System One) — opt-in decision layer
  getDecisionLayerSettings(): Promise<DecisionLayerSettings>
  setDecisionLayerSettings(patch: DecisionLayerSettingsPatch): Promise<DecisionLayerSettings>
  getDecisionLayerStatus(): Promise<DecisionLayerStatus>
  setDecisionApiKey(provider: DecisionProviderId, apiKey: string): Promise<void>
  deleteDecisionApiKey(provider: DecisionProviderId): Promise<boolean>
  testDecisionConnection(options?: { settings?: DecisionLayerSettingsPatch; apiKey?: string }): Promise<DecisionTestResult>
  /** GET {baseUrl}/health of the configured local decision server (Laya / custom). Never rejects for network errors. */
  probeDecisionServer(options?: { baseUrl?: string }): Promise<DecisionServerProbe>

  refreshBadge(): Promise<void>
  setDockIconWithBadge(dataUrl: string): Promise<void>
  onBadgeDraw(callback: (data: { count: number; iconDataUrl: string }) => void): () => void
  onBadgeDrawWindows(callback: (data: { count: number }) => void): () => void
  getWindowFocusState(): Promise<boolean>
  onWindowFocusChange(callback: (isFocused: boolean) => void): () => void
  onNotificationNavigate(callback: (data: { workspaceId: string; sessionId: string }) => void): () => void

  // Theme preferences sync across windows
  broadcastThemePreferences(preferences: { mode: string; colorTheme: string }): Promise<void>
  onThemePreferencesChange(callback: (preferences: { mode: string; colorTheme: string }) => void): () => void

  // Workspace theme sync across windows

  // Git operations
  getGitBranch(dirPath: string): Promise<string | null>

  // Git Bash (Windows)
  checkGitBash(): Promise<GitBashStatus>
  browseForGitBash(): Promise<string | null>
  setGitBashPath(path: string): Promise<{ success: boolean; error?: string }>

  // Menu actions (from renderer to main)
  menuQuit(): Promise<void>

  // Browser pane management
  browserPane: {
    destroy(id: string): Promise<void>
    list(): Promise<BrowserInstanceInfo[]>
    navigate(id: string, url: string): Promise<{ url: string; title: string }>
    goBack(id: string): Promise<void>
    goForward(id: string): Promise<void>
    reload(id: string): Promise<void>
    stop(id: string): Promise<void>
    focus(id: string): Promise<void>
    emptyStateLaunch(payload: BrowserEmptyStateLaunchPayload): Promise<BrowserEmptyStateLaunchResult>
    onStateChanged(callback: (info: BrowserInstanceInfo) => void): () => void
    onRemoved(callback: (id: string) => void): () => void
    onInteracted(callback: (id: string) => void): () => void
  }

  // LLM Connections (provider configurations)
  listLlmConnections(): Promise<LlmConnection[]>
  listLlmConnectionsWithStatus(): Promise<LlmConnectionWithStatus[]>
  getLlmConnection(slug: string): Promise<LlmConnection | null>
  getLlmConnectionApiKey(slug: string): Promise<string | null>
  saveLlmConnection(connection: LlmConnection): Promise<{ success: boolean; error?: string }>
  deleteLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  testLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
  getDefaultThinkingLevel(): Promise<ThinkingLevel>
  setDefaultThinkingLevel(level: ThinkingLevel): Promise<{ success: boolean; error?: string }>
  setWorkspaceDefaultLlmConnection(workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }>

  // Projects, tasks and timesheets (see docs/projects-tasks.md). The workspace is the window's.
  // Updates may send the `updatedAt` last seen as `expectedUpdatedAt`; a stale one is refused.
  getProjects(filter?: ProjectFilter): Promise<Project[]>
  getProject(id: string): Promise<Project | null>
  createProject(input: { title: string; description?: string; resources?: Resource[] }): Promise<Project>
  updateProject(id: string, patch: ProjectUpdate): Promise<Project>
  setProjectStatus(id: string, status: ProjectStatus): Promise<Project>
  addProjectMember(id: string, actor: string): Promise<Project>
  removeProjectMember(id: string, actor: string): Promise<Project>
  getTasks(filter?: TaskFilter): Promise<Task[]>
  getTask(id: string): Promise<Task | null>
  createTask(input: { projectId: string; title: string; description?: string; dueAt?: number | null; assignees?: string[]; resources?: Resource[] }): Promise<Task>
  updateTask(id: string, patch: TaskUpdate): Promise<Task>
  setTaskStatus(id: string, status: TaskStatus): Promise<Task>
  getTimesheets(taskId: string): Promise<Timesheet[]>
  createTimesheet(input: { taskId: string; time: number; notes?: string }): Promise<Timesheet>
  deleteTimesheet(id: string): Promise<void>

  // Comments on a task or project, and the signed-in user's notifications (docs/activity-notifications.md). An entity
  // is `task:<id>` or `project:<id>`; a mention is the token `user:<id>` in the text. Only a comment's author may edit
  // or delete it; `updateComment` may send the `updatedAt` last seen. Notifications are newest first, each with the
  // entity's title and, for a mention, its comment.
  getComments(entity: string): Promise<Comment[]>
  createComment(entity: string, content: string): Promise<Comment>
  updateComment(id: string, content: string, expectedUpdatedAt?: number): Promise<Comment>
  deleteComment(id: string): Promise<void>
  getNotifications(): Promise<NotificationItem[]>
  setNotificationStatus(ids: string[] | 'all', status: 'read' | 'unread'): Promise<void>
  clearNotifications(ids: string[] | 'all'): Promise<void>
  getUnreadNotificationCount(): Promise<number>
  /** Dictation: one recording (the chunks of a take joined, base64 of an `audio/*` blob up to 10 MiB) to its text, empty when no speech was found. Rejects with `code` `not_configured` (no OpenRouter connection), `too_large`, `invalid`, `timeout`, `unavailable` or `failed`. */
  transcribe(audioBase64: string, type: string): Promise<{ text: string }>
  /** After a write by anyone in the workspace: this domain's data there is stale. Hooks reload on it. */
  onDomainChanged(callback: (change: DomainChange) => void): () => void

  // Automations
  getAutomations(workspaceId: string): Promise<unknown>

  // Automation testing (manual trigger)
  testAutomation(payload: TestAutomationPayload): Promise<TestAutomationResult>

  // Automation state management
  setAutomationEnabled(workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean): Promise<void>
  duplicateAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  deleteAutomation(workspaceId: string, eventName: string, matcherIndex: number): Promise<void>
  getAutomationHistory(workspaceId: string, automationId: string, limit?: number): Promise<Array<{ id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string; skipped?: string; webhook?: { method: string; url: string; statusCode: number; durationMs: number; attempts?: number; error?: string; responseBody?: string } }>>
  getAutomationLastExecuted(workspaceId: string): Promise<Record<string, number>>
  replayAutomation(workspaceId: string, automationId: string, eventName: string): Promise<{ results: Array<{ type: string; url: string; statusCode: number; success: boolean; error?: string; duration: number }> }>

  // Automations change listener
  onAutomationsChanged(callback: (workspaceId: string) => void): () => void

  // Language
  changeLanguage(lang: string): Promise<void>

  // Resources (cross-workspace export/import)
  exportResources(workspaceId: string, options: ExportResourcesOptions): Promise<ExportResult>
  importResources(workspaceId: string, bundle: ResourceBundle, mode: ResourceImportMode): Promise<ResourceImportResult>

  // Messaging gateway — workspaceId is taken from the client handshake (ctx.workspaceId)
  getMessagingConfig(): Promise<{
    enabled: boolean
    platforms: Record<string, { enabled: boolean; accessMode?: MessagingPlatformAccessMode; owners?: MessagingPlatformOwnerInfo[] } | undefined>
    runtime: Record<string, MessagingPlatformRuntimeInfo | undefined>
  } | null>
  updateMessagingConfig(config: Record<string, unknown>): Promise<void>
  testTelegramToken(token: string): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }>
  saveTelegramToken(token: string): Promise<void>
  testLarkCredentials(creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<{ success: boolean; botName?: string; error?: string }>
  saveLarkCredentials(creds: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<void>
  disconnectMessagingPlatform(platform: string): Promise<void>
  forgetMessagingPlatform(platform: string): Promise<void>
  getMessagingBindings(): Promise<Array<{ id: string; workspaceId: string; sessionId: string; platform: string; channelId: string; threadId?: number; channelName?: string; enabled: boolean; createdAt: number; accessMode?: MessagingBindingAccessMode; allowedSenderIds?: string[] }>>
  generateMessagingPairingCode(sessionId: string, platform: string): Promise<{ code: string; expiresAt: number; botUsername?: string }>
  /** Telegram supergroup pairing — returns a code typed in the supergroup to capture its chatId. */
  generateMessagingSupergroupCode(platform: string): Promise<{ code: string; expiresAt: number; botUsername?: string }>
  /** Read the workspace's currently paired Telegram supergroup, if any. */
  getMessagingSupergroup(): Promise<{ chatId: string; title: string; capturedAt: number } | null>
  /** Forget the paired Telegram supergroup (existing topic bindings stay on disk but stop matching). */
  unbindMessagingSupergroup(): Promise<{ success: boolean }>
  unbindMessagingSession(sessionId: string, platform?: string): Promise<void>
  unbindMessagingBinding(bindingId: string): Promise<{ success: boolean }>
  onMessagingBindingChanged(callback: (workspaceId: string) => void): () => void
  onMessagingPlatformStatus(callback: (workspaceId: string, platform: string, status: MessagingPlatformRuntimeInfo) => void): () => void
  // WhatsApp (subprocess-based Baileys adapter)
  startWhatsAppConnect(): Promise<{ success: boolean }>
  submitWhatsAppPhone(phoneNumber: string): Promise<{ success: boolean }>
  onWhatsAppEvent(callback: (payload: { workspaceId: string; event: WhatsAppUiEvent }) => void): () => void
  // Messaging access control (Phase 3)
  getMessagingPlatformOwners(platform: string): Promise<MessagingPlatformOwnerInfo[]>
  setMessagingPlatformOwners(platform: string, owners: MessagingPlatformOwnerInfo[]): Promise<MessagingPlatformOwnerInfo[]>
  getMessagingPlatformAccessMode(platform: string): Promise<MessagingPlatformAccessMode>
  setMessagingPlatformAccessMode(platform: string, mode: MessagingPlatformAccessMode): Promise<{ success: boolean }>
  getMessagingPendingSenders(platform?: string): Promise<MessagingPendingSenderInfo[]>
  dismissMessagingPendingSender(platform: string, userId: string, opts?: { reason?: MessagingPendingRejectReason; bindingId?: string }): Promise<{ success: boolean }>
  allowMessagingPendingSender(
    platform: string,
    userId: string,
    entryKey?: { reason?: MessagingPendingRejectReason; bindingId?: string },
  ): Promise<{ owners: MessagingPlatformOwnerInfo[]; bindingId?: string }>
  setMessagingBindingAccess(bindingId: string, access: { mode: MessagingBindingAccessMode; allowedSenderIds?: string[] }): Promise<{ success: boolean }>
  onMessagingPendingChanged(callback: (workspaceId: string) => void): () => void
}

export interface MessagingPlatformRuntimeInfo {
  platform: string
  configured: boolean
  connected: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
  identity?: string
  lastError?: string
  updatedAt: number
}

/**
 * Workspace-level access policy for a messaging platform.
 * Mirrors the canonical type in `@otto/messaging-gateway`.
 */
export type MessagingPlatformAccessMode = 'open' | 'owner-only'

/** Per-binding access policy. */
export type MessagingBindingAccessMode = 'inherit' | 'allow-list' | 'open'

export interface MessagingPlatformOwnerInfo {
  userId: string
  displayName?: string
  username?: string
  addedAt: number
}

export type MessagingPendingRejectReason = 'not-owner' | 'not-on-binding-allowlist'

export interface MessagingPendingSenderInfo {
  platform: string
  userId: string
  displayName?: string
  username?: string
  lastAttemptAt: number
  attemptCount: number
  reason?: MessagingPendingRejectReason
  bindingId?: string
  sessionId?: string
  channelId?: string
  threadId?: number
}

/** Event payloads broadcast from the WhatsApp subprocess to the UI. */
export type WhatsAppUiEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; jid?: string; name?: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string }

// =============================================================================
// Navigation types (renderer-only)
// =============================================================================

/**
 * Session filter options
 */
export type SessionFilter =
  | { kind: 'allSessions' }
  | { kind: 'flagged' }
  | { kind: 'state'; stateId: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'archived' }

/**
 * Settings subpage options - re-exported from settings-registry (single source of truth)
 */
export type { SettingsSubpage } from './settings-registry'
import type { SettingsSubpage } from './settings-registry'
import type { ChatFilters } from './chat-filters'
export type { ChatFilters }

/**
 * Sessions navigation state
 */
export interface SessionsNavigationState {
  navigator: 'sessions'
  /** The single filter older consumers read (the first of `filters`); a `view` filter has no `filters`. */
  filter: SessionFilter
  /** The Chats index filters, combined (parsed routes always set it; see chat-filters.ts). */
  filters?: ChatFilters
  details: { type: 'session'; sessionId: string } | null
}

/**
 * Source type filter for sources navigation
 */
export interface SourceFilter {
  kind: 'type'
  sourceType: 'api' | 'mcp' | 'local'
}

/**
 * Automation type filter for automations navigation
 */
export interface AutomationFilter {
  kind: 'type'
  automationType: 'scheduled' | 'event' | 'agentic'
}

/**
 * Sources navigation state: the grid in Settings (`?type=`), or one source
 */
export interface SourcesNavigationState {
  navigator: 'sources'
  filter?: SourceFilter
  details: { type: 'source'; sourceSlug: string } | null
}

/**
 * Settings navigation state: always one page (Settings has no index; it opens on General).
 */
export interface SettingsNavigationState {
  navigator: 'settings'
  subpage: SettingsSubpage
}

/**
 * Skills navigation state: the grid in Settings, or one skill
 */
export interface SkillsNavigationState {
  navigator: 'skills'
  search: SkillsSearch
  details: { type: 'skill'; skillSlug: string } | null
}

/**
 * Agents navigation state: the gallery in Settings, or one agent
 */
export interface AgentsNavigationState {
  navigator: 'agents'
  details: { type: 'agent'; agentId: string } | null
}

/**
 * Automations navigation state
 */
export interface AutomationsNavigationState {
  navigator: 'automations'
  filter?: AutomationFilter
  details: { type: 'automation'; automationId: string } | null
}

/**
 * Projects navigation state: the index (`?status=archived`) or a project (`?tab=`)
 */
export interface ProjectsNavigationState {
  navigator: 'projects'
  search: ProjectsSearch
  details: { type: 'project'; projectId: string } | null
}

/**
 * Tasks navigation state: the index with its filters, or a task
 */
export interface TasksNavigationState {
  navigator: 'tasks'
  search: TasksSearch
  details: { type: 'task'; taskId: string } | null
}

/**
 * Library navigation state: the grid (tab, open folder, creator) or an item (a file or a document)
 */
export interface LibraryNavigationState {
  navigator: 'library'
  search: LibrarySearch
  details: { type: 'item'; itemId: string } | null
}

/**
 * Inbox navigation state: your notifications (`?unread=1` keeps the unread ones); no detail of its own
 */
export interface InboxNavigationState {
  navigator: 'inbox'
  search: InboxSearch
}

/**
 * Unified navigation state
 */
export type NavigationState =
  | SessionsNavigationState
  | SourcesNavigationState
  | SettingsNavigationState
  | SkillsNavigationState
  | AgentsNavigationState
  | AutomationsNavigationState
  | ProjectsNavigationState
  | LibraryNavigationState
  | TasksNavigationState
  | InboxNavigationState

export const isSessionsNavigation = (
  state: NavigationState
): state is SessionsNavigationState => state.navigator === 'sessions'

export const isSourcesNavigation = (
  state: NavigationState
): state is SourcesNavigationState => state.navigator === 'sources'

export const isSettingsNavigation = (
  state: NavigationState
): state is SettingsNavigationState => state.navigator === 'settings'

export const isSkillsNavigation = (
  state: NavigationState
): state is SkillsNavigationState => state.navigator === 'skills'

export const isAgentsNavigation = (
  state: NavigationState
): state is AgentsNavigationState => state.navigator === 'agents'

export const isAutomationsNavigation = (
  state: NavigationState
): state is AutomationsNavigationState => state.navigator === 'automations'

export const isProjectsNavigation = (
  state: NavigationState
): state is ProjectsNavigationState => state.navigator === 'projects'

export const isLibraryNavigation = (
  state: NavigationState
): state is LibraryNavigationState => state.navigator === 'library'

export const isTasksNavigation = (
  state: NavigationState
): state is TasksNavigationState => state.navigator === 'tasks'

export const isInboxNavigation = (
  state: NavigationState
): state is InboxNavigationState => state.navigator === 'inbox'

export const DEFAULT_NAVIGATION_STATE: NavigationState = {
  navigator: 'sessions',
  filter: { kind: 'allSessions' },
  details: null,
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
