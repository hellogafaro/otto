import { RPC_CHANNELS } from '@otto/shared/protocol'
import { loadPreferences, savePreferences, validatePreferencesContent, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getWorkspaceByNameOrId, getDefaultThinkingLevel, setDefaultThinkingLevel } from '@otto/shared/config'
import { getSetting, updateSetting, type SettingKey } from '@otto/shared/settings'
import { updateWorkspacePermissions } from '@otto/shared/agent'
import { isValidThinkingLevel, normalizeThinkingLevel, THINKING_LEVEL_IDS } from '@otto/shared/agent/thinking-levels'

const VALID_THINKING_LEVELS_LIST = THINKING_LEVEL_IDS.map(id => `'${id}'`).join(', ')
import { getWorkspaceOrThrow } from '@otto/server-core/handlers'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientOpenFileDialog } from '@otto/server-core/transport'
import { isValidWorkingDirectory } from '../../utils/path-validation'
import { getUserMidStreamPreference, initUserMidStreamPreference, updatePreferences, type UserPreferences } from '@otto/shared/config/preferences'
import { UserPreferencesUpdateSchema } from '@otto/shared/config/validators'
import { domainError } from '@otto/shared/utils'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspace.SETTINGS_GET,
  RPC_CHANNELS.workspace.SETTINGS_UPDATE,
  RPC_CHANNELS.preferences.READ,
  RPC_CHANNELS.preferences.WRITE,
  RPC_CHANNELS.preferences.GET_USER,
  RPC_CHANNELS.preferences.UPDATE_USER,
  RPC_CHANNELS.drafts.GET,
  RPC_CHANNELS.drafts.SET,
  RPC_CHANNELS.drafts.DELETE,
  RPC_CHANNELS.drafts.GET_ALL,
  RPC_CHANNELS.input.GET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.SET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.GET_SPELL_CHECK,
  RPC_CHANNELS.input.SET_SPELL_CHECK,
  RPC_CHANNELS.power.GET_KEEP_AWAKE,
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.notification.GET_ENABLED,
  RPC_CHANNELS.notification.SET_ENABLED,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.GET_SETTING,
  RPC_CHANNELS.settings.UPDATE_SETTING,
  RPC_CHANNELS.dialog.OPEN_FOLDER,
] as const

export function registerSettingsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // ============================================================
  // Settings - Default Thinking Level (App-Level)
  // ============================================================

  server.handle(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL, async () => {
    return getDefaultThinkingLevel()
  })

  server.handle(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL, async (_ctx, level: string) => {
    if (!isValidThinkingLevel(level)) {
      throw new Error(`Invalid thinking level: ${level}. Valid values: ${VALID_THINKING_LEVELS_LIST}`)
    }
    const success = setDefaultThinkingLevel(level)
    if (!success) {
      throw new Error('Failed to persist default thinking level')
    }
    return { success: true }
  })

  // Any setting of an entity ('install', 'workspace:<id>', 'user:<id>'); who may is decided in authorize.ts
  server.handle(RPC_CHANNELS.settings.GET_SETTING, async (_ctx, entity: string, key: string) => {
    return getSetting(entity, key as SettingKey)
  })

  server.handle(RPC_CHANNELS.settings.UPDATE_SETTING, async (_ctx, entity: string, key: string, value: unknown) => {
    // A workspace's permission rules are checked and make the running agents read them (updateWorkspacePermissions)
    if (key === 'permissions' && entity.startsWith('workspace:')) return updateWorkspacePermissions(entity.slice('workspace:'.length), value)
    return updateSetting(entity, key as SettingKey, value)
  })

  // ============================================================
  // Settings - Model (Session-Specific)
  // ============================================================

  // Get session-specific model
  server.handle(RPC_CHANNELS.sessions.GET_MODEL, async (_ctx, sessionId: string, _workspaceId: string): Promise<string | null> => {
    const session = await deps.sessionManager.getSession(sessionId)
    return session?.model ?? null
  })

  // Set session-specific model (and optionally connection)
  server.handle(RPC_CHANNELS.sessions.SET_MODEL, async (_ctx, sessionId: string, workspaceId: string, model: string | null, connection?: string) => {
    await deps.sessionManager.updateSessionModel(sessionId, workspaceId, model, connection)
    deps.platform.logger.info(`Session ${sessionId} model updated to: ${model}${connection ? ` (connection: ${connection})` : ''}`)
  })

  // Open native folder dialog for selecting working directory (routed to client)
  server.handle(RPC_CHANNELS.dialog.OPEN_FOLDER, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ============================================================
  // Workspace Settings (per-workspace configuration)
  // ============================================================

  // Get workspace settings (model, permission mode, working directory, credential strategy)
  server.handle(RPC_CHANNELS.workspace.SETTINGS_GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger.error(`Workspace not found: ${workspaceId}`)
      return null
    }

    // Load workspace config
    const { loadWorkspaceConfig } = await import('@otto/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)

    return {
      name: config?.name,
      model: config?.defaults?.model,
      permissionMode: config?.defaults?.permissionMode,
      cyclablePermissionModes: config?.defaults?.cyclablePermissionModes,
      thinkingLevel: normalizeThinkingLevel(config?.defaults?.thinkingLevel),
      workingDirectory: config?.defaults?.workingDirectory,
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
      defaultLlmConnection: config?.defaults?.defaultLlmConnection,
      defaultLlmConnectionId: config?.defaults?.defaultLlmConnectionId,
      enabledSourceSlugs: config?.defaults?.enabledSourceSlugs ?? [],
    }
  })

  // Update a workspace setting
  server.handle(RPC_CHANNELS.workspace.SETTINGS_UPDATE, async (_ctx, workspaceId: string, key: string, value: unknown) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    const normalizedValue = key === 'workingDirectory' && typeof value === 'string'
      ? value.trim()
      : value

    // Validate key is a known workspace setting
    const validKeys = ['name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled', 'defaultLlmConnection']
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid workspace setting key: ${key}. Valid keys: ${validKeys.join(', ')}`)
    }

    // Validate defaultLlmConnection exists before saving
    if (key === 'defaultLlmConnection' && normalizedValue !== undefined && normalizedValue !== null) {
      const { getLlmConnection } = await import('@otto/shared/config/storage')
      if (!getLlmConnection(normalizedValue as string)) {
        throw new Error(`LLM connection "${normalizedValue}" not found`)
      }
    }

    if (key === 'workingDirectory' && normalizedValue !== undefined && normalizedValue !== null) {
      const validation = isValidWorkingDirectory(String(normalizedValue))
      if (!validation.valid) {
        throw new Error(validation.reason!)
      }
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@otto/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Handle 'name' specially - it's a top-level config property, not in defaults
    if (key === 'name') {
      config.name = String(normalizedValue).trim()
    } else if (key === 'localMcpEnabled') {
      // Store in localMcpServers.enabled (top-level, not in defaults)
      config.localMcpServers = config.localMcpServers || { enabled: true }
      config.localMcpServers.enabled = Boolean(normalizedValue)
    } else {
      // Update the setting in defaults
      config.defaults = config.defaults || {}
      ;(config.defaults as Record<string, unknown>)[key] = normalizedValue
    }

    // Save the config
    saveWorkspaceConfig(workspace.rootPath, config)
    if (key === 'name') {
      const { refreshWorkspaceMirror } = await import('@otto/shared/config/storage')
      refreshWorkspaceMirror()
    }
    deps.platform.logger.info(`Workspace setting updated: ${key} = ${JSON.stringify(normalizedValue)}`)
  })

  // ============================================================
  // User Preferences
  // ============================================================

  // The caller's preferences as JSON text: their name and email, and their own settings
  server.handle(RPC_CHANNELS.preferences.READ, async (ctx) => {
    return { content: JSON.stringify(loadPreferences(ctx.userId), null, 2) }
  })
  server.handle(RPC_CHANNELS.preferences.GET_USER, (ctx) => {
    if (!ctx.userId) throw domainError('unauthorized', 'Sign in to read your preferences.')
    const preference = initUserMidStreamPreference(ctx.userId)
    return { ...loadPreferences(ctx.userId), midStreamBehavior: preference.behavior, midStreamBehaviorNeedsReview: preference.needsReview }
  })
  server.handle(RPC_CHANNELS.preferences.UPDATE_USER, (ctx, updates: Partial<UserPreferences>) => {
    if (!ctx.userId) throw domainError('unauthorized', 'Sign in to update your preferences.')
    const validation = UserPreferencesUpdateSchema.safeParse(updates)
    if (!validation.success) throw domainError('invalid', 'The preference update is invalid.')
    initUserMidStreamPreference(ctx.userId)
    const updated = updatePreferences(validation.data, ctx.userId)
    const preference = getUserMidStreamPreference(ctx.userId)
    return { ...updated, midStreamBehavior: preference.behavior, midStreamBehaviorNeedsReview: preference.needsReview }
  })

  // Make the JSON text the caller's preferences (validates the content before saving)
  server.handle(RPC_CHANNELS.preferences.WRITE, async (ctx, content: string) => {
    try {
      const validation = validatePreferencesContent(content)
      if (!validation.success) return validation
      savePreferences(JSON.parse(content), ctx.userId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============================================================
  // Session Drafts (persisted input text)
  // ============================================================

  // Get draft for a session (text + attachment refs)
  server.handle(RPC_CHANNELS.drafts.GET, async (_ctx, sessionId: string) => {
    return getSessionDraft(sessionId)
  })

  // Set draft for a session (empty drafts are cleared)
  server.handle(RPC_CHANNELS.drafts.SET, async (_ctx, sessionId: string, draft: import('@otto/shared/config').SessionDraft) => {
    setSessionDraft(sessionId, draft)
  })

  // Delete draft for a session
  server.handle(RPC_CHANNELS.drafts.DELETE, async (_ctx, sessionId: string) => {
    deleteSessionDraft(sessionId)
  })

  // Get all drafts (for loading on app start): only those of the chats the caller may see
  server.handle(RPC_CHANNELS.drafts.GET_ALL, async (ctx) => {
    return Object.fromEntries(
      Object.entries(getAllSessionDrafts()).filter(([sessionId]) => deps.sessionManager.canSeeSession(sessionId, ctx.userId)),
    )
  })

  // ============================================================
  // Input Settings
  // ============================================================

  // Get auto-capitalisation setting
  server.handle(RPC_CHANNELS.input.GET_AUTO_CAPITALISATION, async (ctx) => {
    const { getAutoCapitalisation } = await import('@otto/shared/config/storage')
    return getAutoCapitalisation(ctx.userId)
  })

  // Set auto-capitalisation setting
  server.handle(RPC_CHANNELS.input.SET_AUTO_CAPITALISATION, async (ctx, enabled: boolean) => {
    const { setAutoCapitalisation } = await import('@otto/shared/config/storage')
    setAutoCapitalisation(enabled, ctx.userId)
  })

  // Get send message key setting
  server.handle(RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY, async (ctx) => {
    const { getSendMessageKey } = await import('@otto/shared/config/storage')
    return getSendMessageKey(ctx.userId)
  })

  // Set send message key setting
  server.handle(RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY, async (ctx, key: 'enter' | 'cmd-enter') => {
    const { setSendMessageKey } = await import('@otto/shared/config/storage')
    setSendMessageKey(key, ctx.userId)
  })

  // Get spell check setting
  server.handle(RPC_CHANNELS.input.GET_SPELL_CHECK, async (ctx) => {
    const { getSpellCheck } = await import('@otto/shared/config/storage')
    return getSpellCheck(ctx.userId)
  })

  // Set spell check setting
  server.handle(RPC_CHANNELS.input.SET_SPELL_CHECK, async (ctx, enabled: boolean) => {
    const { setSpellCheck } = await import('@otto/shared/config/storage')
    setSpellCheck(enabled, ctx.userId)
  })

  // ============================================================
  // Power Settings
  // ============================================================

  // Get keep awake while running setting
  server.handle(RPC_CHANNELS.power.GET_KEEP_AWAKE, async () => {
    const { getKeepAwakeWhileRunning } = await import('@otto/shared/config/storage')
    return getKeepAwakeWhileRunning()
  })

  // ============================================================
  // Appearance Settings
  // ============================================================

  // Get rich tool descriptions setting
  server.handle(RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS, async (ctx) => {
    const { getRichToolDescriptions } = await import('@otto/shared/config/storage')
    return getRichToolDescriptions(ctx.userId)
  })

  // Set rich tool descriptions setting
  server.handle(RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS, async (ctx, enabled: boolean) => {
    const { setRichToolDescriptions } = await import('@otto/shared/config/storage')
    setRichToolDescriptions(enabled, ctx.userId)
  })

  // Whether the desktop shows OS notifications for this person (the window shows them, see notification:show)
  server.handle(RPC_CHANNELS.notification.GET_ENABLED, async (ctx) => {
    const { getNotificationsEnabled } = await import('@otto/shared/config/storage')
    return getNotificationsEnabled(ctx.userId)
  })

  server.handle(RPC_CHANNELS.notification.SET_ENABLED, async (ctx, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@otto/shared/config/storage')
    setNotificationsEnabled(enabled, ctx.userId)
  })
}
