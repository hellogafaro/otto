/**
 * Exhaustive channel routing table for hybrid local/remote transport.
 *
 * Every RPC channel must belong to exactly one of two sets:
 * - LOCAL_ONLY: Always runs on the local Electron server, never proxied.
 * - REMOTE_ELIGIBLE: Runs on whichever server owns the workspace.
 *
 * An exhaustiveness test ensures new channels fail CI until classified.
 */

import { RPC_CHANNELS } from './channels'

// ---------------------------------------------------------------------------
// LOCAL_ONLY — fundamentally requires local OS / Electron
// ---------------------------------------------------------------------------

export const LOCAL_ONLY_CHANNELS = new Set<string>([
  // remote — local connectivity management (reaches out to remote server from local app)
  RPC_CHANNELS.remote.TEST_CONNECTION,

  // workspaces — local workspace CRUD (workspace list is local config)
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,

  // window — Electron window management
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.window.CLOSE,
  RPC_CHANNELS.window.CLOSE_REQUESTED,
  RPC_CHANNELS.window.CONFIRM_CLOSE,
  RPC_CHANNELS.window.CANCEL_CLOSE,
  RPC_CHANNELS.window.SET_TRAFFIC_LIGHTS,
  RPC_CHANNELS.window.FOCUS_STATE,
  RPC_CHANNELS.window.GET_FOCUS_STATE,

  // file — native file dialog
  RPC_CHANNELS.file.OPEN_DIALOG,
  // file — draft hydration for user-attached paths. Paths in drafts.json were captured
  // via webUtils.getPathForFile in the renderer, so they point at the user's local machine
  // — even when the workspace itself lives on a remote server. Routing this REMOTE_ELIGIBLE
  // would send the local path to a remote filesystem that can't resolve it.
  RPC_CHANNELS.file.READ_USER_ATTACHMENT,

  // dialog — native folder dialog
  RPC_CHANNELS.dialog.OPEN_FOLDER,

  // auth — local auth state + native dialogs
  RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION,

  // shell — local OS shell (openFile/showInFolder guarded for remote)
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.shell.OPEN_FILE,
  RPC_CHANNELS.shell.SHOW_IN_FOLDER,

  // skills — local filesystem actions (guarded for remote)
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,

  // system — local OS info
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,

  // theme — app/OS-level preferences, not workspace content
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.theme.SYSTEM_CHANGED,
  RPC_CHANNELS.theme.APP_CHANGED,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.PREFERENCES_CHANGED,

  // update — local auto-update
  RPC_CHANNELS.update.CHECK,
  RPC_CHANNELS.update.GET_INFO,
  RPC_CHANNELS.update.INSTALL,
  RPC_CHANNELS.update.DISMISS,
  RPC_CHANNELS.update.GET_DISMISSED,
  RPC_CHANNELS.update.AVAILABLE,
  RPC_CHANNELS.update.DOWNLOAD_PROGRESS,

  // badge — local dock badge
  RPC_CHANNELS.badge.REFRESH,
  RPC_CHANNELS.badge.SET_ICON,
  RPC_CHANNELS.badge.DRAW,
  RPC_CHANNELS.badge.DRAW_WINDOWS,

  // menu — local menu events
  RPC_CHANNELS.menu.NEW_CHAT,
  RPC_CHANNELS.menu.OPEN_SETTINGS,
  RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS,
  RPC_CHANNELS.menu.QUIT,

  // deeplink — local deep link handling
  RPC_CHANNELS.deeplink.NAVIGATE,

  // notification — local OS notifications
  RPC_CHANNELS.notification.SHOW,
  RPC_CHANNELS.notification.NAVIGATE,
  RPC_CHANNELS.notification.GET_ENABLED,
  RPC_CHANNELS.notification.SET_ENABLED,

  // input — local input preferences
  RPC_CHANNELS.input.GET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.SET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.GET_SPELL_CHECK,
  RPC_CHANNELS.input.SET_SPELL_CHECK,

  // power — local power management
  RPC_CHANNELS.power.GET_KEEP_AWAKE,
  RPC_CHANNELS.power.SET_KEEP_AWAKE,

  // appearance — local UI preferences
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,

  // tools — local tool settings

  // browserPane — Electron BrowserView
  RPC_CHANNELS.browserPane.DESTROY,
  RPC_CHANNELS.browserPane.LIST,
  RPC_CHANNELS.browserPane.NAVIGATE,
  RPC_CHANNELS.browserPane.GO_BACK,
  RPC_CHANNELS.browserPane.GO_FORWARD,
  RPC_CHANNELS.browserPane.RELOAD,
  RPC_CHANNELS.browserPane.STOP,
  RPC_CHANNELS.browserPane.FOCUS,
  RPC_CHANNELS.browserPane.SNAPSHOT,
  RPC_CHANNELS.browserPane.CLICK,
  RPC_CHANNELS.browserPane.FILL,
  RPC_CHANNELS.browserPane.SELECT,
  RPC_CHANNELS.browserPane.SCREENSHOT,
  RPC_CHANNELS.browserPane.EVALUATE,
  RPC_CHANNELS.browserPane.SCROLL,
  RPC_CHANNELS.browserPane.LAUNCH,
  RPC_CHANNELS.browserPane.STATE_CHANGED,
  RPC_CHANNELS.browserPane.REMOVED,
  RPC_CHANNELS.browserPane.INTERACTED,

  // gitbash — Windows-specific local
  RPC_CHANNELS.gitbash.CHECK,
  RPC_CHANNELS.gitbash.BROWSE,
  RPC_CHANNELS.gitbash.SET_PATH,

  // debug — local debug logging
  RPC_CHANNELS.debug.LOG,

  // onboarding — local auth setup flow
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.DEFER_SETUP,

  // server config — local embedded server settings
  RPC_CHANNELS.settings.GET_SERVER_CONFIG,
  RPC_CHANNELS.settings.SET_SERVER_CONFIG,
  RPC_CHANNELS.settings.GET_SERVER_STATUS,
])

// ---------------------------------------------------------------------------
// REMOTE_ELIGIBLE — runs on whichever server owns the workspace
// ---------------------------------------------------------------------------

export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>([
  // server — server-level operations (no workspace context needed)
  RPC_CHANNELS.server.GET_WORKSPACES,
  RPC_CHANNELS.server.CREATE_WORKSPACE,
  RPC_CHANNELS.server.GET_STATUS,
  RPC_CHANNELS.server.GET_HEALTH,
  RPC_CHANNELS.server.GET_ACTIVE_SESSIONS,
  RPC_CHANNELS.server.SHUTTING_DOWN,
  RPC_CHANNELS.server.STATUS_CHANGED,
  RPC_CHANNELS.server.HOME_DIR,

  // sessions — core session runtime
  RPC_CHANNELS.sessions.GET,
  RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY,
  RPC_CHANNELS.sessions.MARK_ALL_READ,
  RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED,
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.EVENT,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.sessions.GET_FILES,
  RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES,
  RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.UNWATCH_FILES,
  RPC_CHANNELS.sessions.FILES_CHANGED,
  RPC_CHANNELS.sessions.SEARCH_CONTENT,
  RPC_CHANNELS.sessions.EXPORT,
  RPC_CHANNELS.sessions.IMPORT,
  RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER,
  RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER,
  // Sharing runs on the workspace server: it reads OTTO_VIEWER_URL.
  RPC_CHANNELS.sessions.GET_SHARE_CAPABILITIES,

  // transfer — chunked large-payload import (sessions, resources)
  RPC_CHANNELS.transfer.START,
  RPC_CHANNELS.transfer.CHUNK,
  RPC_CHANNELS.transfer.COMMIT,
  RPC_CHANNELS.transfer.ABORT,

  // file — workspace files (not openDialog which is native)
  RPC_CHANNELS.file.READ,
  RPC_CHANNELS.file.READ_DATA_URL,
  RPC_CHANNELS.file.READ_PREVIEW_DATA_URL,
  RPC_CHANNELS.file.READ_BINARY,
  RPC_CHANNELS.file.READ_ATTACHMENT,
  RPC_CHANNELS.file.STORE_ATTACHMENT,
  RPC_CHANNELS.file.GENERATE_THUMBNAIL,

  // library — items and bytes live in the workspace's server
  RPC_CHANNELS.library.CREATE,
  RPC_CHANNELS.library.CREATE_FOLDER,
  RPC_CHANNELS.library.LIST,
  RPC_CHANNELS.library.GET,
  RPC_CHANNELS.library.READ,
  RPC_CHANNELS.library.UPDATE,
  RPC_CHANNELS.library.DELETE,

  // agents — rows of the workspace's server
  RPC_CHANNELS.agents.LIST,
  RPC_CHANNELS.agents.GET,
  RPC_CHANNELS.agents.CREATE,
  RPC_CHANNELS.agents.UPDATE,
  RPC_CHANNELS.agents.DELETE,

  // fs — workspace filesystem
  RPC_CHANNELS.fs.SEARCH,
  RPC_CHANNELS.fs.LIST_DIRECTORY,

  // credentials — remote server's credential state
  RPC_CHANNELS.credentials.HEALTH_CHECK,

  // llmConnections — LLM config lives on server running workspace
  RPC_CHANNELS.llmConnections.LIST,
  RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,
  RPC_CHANNELS.llmConnections.GET,
  RPC_CHANNELS.llmConnections.SAVE,
  RPC_CHANNELS.llmConnections.DELETE,
  RPC_CHANNELS.llmConnections.TEST,
  RPC_CHANNELS.llmConnections.SET_DEFAULT,
  RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT,
  RPC_CHANNELS.llmConnections.REFRESH_MODELS,
  RPC_CHANNELS.llmConnections.CHANGED,

  // chatgpt — OAuth via capability passthrough
  RPC_CHANNELS.chatgpt.START_OAUTH,
  RPC_CHANNELS.chatgpt.CANCEL_OAUTH,
  RPC_CHANNELS.chatgpt.DEVICE_CODE,

  // claudeCode — the `claude` CLI of the machine the workspace's server runs on
  RPC_CHANNELS.claudeCode.GET_STATUS,

  // copilot — OAuth via capability passthrough
  RPC_CHANNELS.copilot.START_OAUTH,
  RPC_CHANNELS.copilot.CANCEL_OAUTH,
  RPC_CHANNELS.copilot.DEVICE_CODE,

  // settings — workspace-level settings
  RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
  RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.GET_SETTING,
  RPC_CHANNELS.settings.UPDATE_SETTING,

  // decisions — the decision layer's settings and keys live on the server whose sessions ask the
  // model (it can reuse that server's LLM connections); the Laya probe tests what that server reaches
  RPC_CHANNELS.decisions.GET_SETTINGS,
  RPC_CHANNELS.decisions.SET_SETTINGS,
  RPC_CHANNELS.decisions.GET_STATUS,
  RPC_CHANNELS.decisions.SET_API_KEY,
  RPC_CHANNELS.decisions.DELETE_API_KEY,
  RPC_CHANNELS.decisions.TEST,
  RPC_CHANNELS.decisions.PROBE_SERVER,

  // pi — provider config on workspace server
  RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS,

  // preferences — workspace-level preferences
  RPC_CHANNELS.preferences.READ,
  RPC_CHANNELS.preferences.WRITE,

  // drafts — workspace content
  RPC_CHANNELS.drafts.GET,
  RPC_CHANNELS.drafts.SET,
  RPC_CHANNELS.drafts.DELETE,
  RPC_CHANNELS.drafts.GET_ALL,

  // sources — source config per-workspace
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.CHANGED,
  RPC_CHANNELS.sources.CONFLICT,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,

  // oauth — OAuth state management
  RPC_CHANNELS.oauth.START,
  RPC_CHANNELS.oauth.COMPLETE,
  RPC_CHANNELS.oauth.CANCEL,
  RPC_CHANNELS.oauth.REVOKE,

  // workspace — workspace config + images (sharp on headless)
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.workspace.SETTINGS_GET,
  RPC_CHANNELS.workspace.SETTINGS_UPDATE,

  // permissions — workspace permissions
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.permissions.DEFAULTS_CHANGED,

  // skills — skill content per-workspace (not openEditor/openFinder which are local OS)
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.CHANGED,
  RPC_CHANNELS.skills.CONFLICT,

  // statuses — workspace metadata
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.CREATE,
  RPC_CHANNELS.statuses.UPDATE,
  RPC_CHANNELS.statuses.DELETE,
  RPC_CHANNELS.statuses.REORDER,
  RPC_CHANNELS.statuses.SET_DEFAULT,

  // labels — workspace metadata
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.MOVE,
  RPC_CHANNELS.labels.REORDER,
  RPC_CHANNELS.labels.DELETE,

  // toolIcons — workspace config
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,

  // logo — workspace config
  RPC_CHANNELS.logo.GET_URL,

  // routines — rows of the workspace's server
  RPC_CHANNELS.routines.LIST,
  RPC_CHANNELS.routines.GET,
  RPC_CHANNELS.routines.CREATE,
  RPC_CHANNELS.routines.UPDATE,
  RPC_CHANNELS.routines.DELETE,
  RPC_CHANNELS.routines.PAUSE,
  RPC_CHANNELS.routines.RESUME,
  RPC_CHANNELS.routines.RUN,

  // workspace members and invitations — live in the workspace's server
  RPC_CHANNELS.workspaces.GET_MEMBERS,
  RPC_CHANNELS.workspaces.GET_INVITATIONS,
  RPC_CHANNELS.workspaces.INVITE,
  RPC_CHANNELS.workspaces.REVOKE_INVITATION,
  RPC_CHANNELS.workspaces.REMOVE_MEMBER,
  RPC_CHANNELS.workspaces.UPDATE_MEMBER_ROLE,
  RPC_CHANNELS.workspaces.LEAVE,

  // projects, tasks and timesheets — live in the workspace's server
  RPC_CHANNELS.projects.LIST,
  RPC_CHANNELS.projects.GET,
  RPC_CHANNELS.projects.CREATE,
  RPC_CHANNELS.projects.UPDATE,
  RPC_CHANNELS.projects.SET_STATUS,
  RPC_CHANNELS.projects.ADD_MEMBER,
  RPC_CHANNELS.projects.REMOVE_MEMBER,
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.UPDATE,
  RPC_CHANNELS.tasks.SET_STATUS,
  RPC_CHANNELS.timesheets.LIST,
  RPC_CHANNELS.timesheets.CREATE,
  RPC_CHANNELS.timesheets.DELETE,

  // search, comments, notifications and the change push — live in the workspace's server
  RPC_CHANNELS.comments.GET,
  RPC_CHANNELS.comments.CREATE,
  RPC_CHANNELS.comments.UPDATE,
  RPC_CHANNELS.comments.DELETE,
  RPC_CHANNELS.search.RUN,
  RPC_CHANNELS.notifications.GET,
  RPC_CHANNELS.notifications.SET_STATUS,
  RPC_CHANNELS.notifications.CLEAR,
  RPC_CHANNELS.notifications.GET_UNREAD_COUNT,
  RPC_CHANNELS.domain.CHANGED,

  // git — workspace filesystem
  RPC_CHANNELS.git.GET_BRANCH,

  // messaging — gateway channels run on workspace server
  RPC_CHANNELS.messaging.WA_REGISTER,
  RPC_CHANNELS.messaging.WA_INCOMING,
  RPC_CHANNELS.messaging.WA_BUTTON_PRESS,
  RPC_CHANNELS.messaging.WA_STATUS,
  RPC_CHANNELS.messaging.WA_QR,
  RPC_CHANNELS.messaging.WA_SEND,
  RPC_CHANNELS.messaging.WA_SEND_BUTTONS,
  RPC_CHANNELS.messaging.WA_SEND_TYPING,
  RPC_CHANNELS.messaging.WA_SEND_FILE,
  RPC_CHANNELS.messaging.WA_CONNECT,
  RPC_CHANNELS.messaging.WA_DISCONNECT,
  RPC_CHANNELS.messaging.BINDING_CHANGED,
  RPC_CHANNELS.messaging.PLATFORM_STATUS,
  RPC_CHANNELS.messaging.PENDING_CHANGED,
  RPC_CHANNELS.messaging.GET_CONFIG,
  RPC_CHANNELS.messaging.UPDATE_CONFIG,
  RPC_CHANNELS.messaging.TEST_TELEGRAM,
  RPC_CHANNELS.messaging.SAVE_TELEGRAM,
  RPC_CHANNELS.messaging.TEST_LARK,
  RPC_CHANNELS.messaging.SAVE_LARK,
  RPC_CHANNELS.messaging.DISCONNECT,
  RPC_CHANNELS.messaging.FORGET,
  RPC_CHANNELS.messaging.GET_BINDINGS,
  RPC_CHANNELS.messaging.GENERATE_CODE,
  RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE,
  RPC_CHANNELS.messaging.GET_SUPERGROUP,
  RPC_CHANNELS.messaging.UNBIND_SUPERGROUP,
  RPC_CHANNELS.messaging.UNBIND,
  RPC_CHANNELS.messaging.UNBIND_BINDING,
  RPC_CHANNELS.messaging.WA_START_CONNECT,
  RPC_CHANNELS.messaging.WA_SUBMIT_PHONE,
  RPC_CHANNELS.messaging.WA_UI_EVENT,
  // messaging access control — UI ↔ Server, per-platform owners + per-binding allow-list
  RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
  RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
  RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
  RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
])

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function isLocalOnly(channel: string): boolean {
  return LOCAL_ONLY_CHANNELS.has(channel)
}

export function isRemoteEligible(channel: string): boolean {
  return REMOTE_ELIGIBLE_CHANNELS.has(channel)
}
