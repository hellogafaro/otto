import { RPC_CHANNELS, type LlmConnectionSetup, type LlmConnectionUpdate } from '@otto/shared/protocol'
import type { LlmConnection, LlmConnectionWithStatus } from '@otto/shared/config/llm-connections'
import { getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, setSetupDeferred, getWorkspaceByNameOrId } from '@otto/shared/config/storage'
import { getCredentialManager } from '@otto/shared/credentials'
import { INSTALL_SCOPE, getConnection, getConnections, updateConnection, narrowContext, userScope, workspaceScope, type ConnectionContext } from '@otto/shared/connections'
import { updateAgentsUnconnected } from '@otto/shared/agents'
import { getModelRefreshService } from '../../model-fetchers'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { fetchNativeModels, validateNativeConnection, validateStoredNativeConnection, isNativeConnection, NATIVE_PROVIDER_UNSUPPORTED as OPENAI_UNSUPPORTED } from '../../model-fetchers/native-provider'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.llmConnections.LIST,
  RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,
  RPC_CHANNELS.llmConnections.GET,
  RPC_CHANNELS.llmConnections.SAVE,
  RPC_CHANNELS.llmConnections.DELETE,
  RPC_CHANNELS.llmConnections.TEST,
  RPC_CHANNELS.llmConnections.SET_DEFAULT,
  RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT,
  RPC_CHANNELS.llmConnections.REFRESH_MODELS,
  RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
] as const

export function registerLlmConnectionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const whereOf = (ctx: { userId: string | null; workspaceId: string | null }): ConnectionContext => ({ userId: ctx.userId, workspaceId: ctx.workspaceId })

  server.handle(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, async (ctx, setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> => {
    try {
      if (setup.scope === 'workspace' && !ctx.workspaceId) return { success: false, error: 'Workspace is required.' }
      const where = narrowContext(whereOf(ctx), setup.scope)
      const connection = getLlmConnection(setup.slug, where)
      const stored = getConnection(setup.slug, where)
      if (!['openai', 'custom', 'anthropic'].includes(setup.type ?? connection?.type ?? '') || (connection && connection.authType !== 'api_key'))
        return { success: false, error: OPENAI_UNSUPPORTED }
      if (connection && setup.type && setup.type !== connection.type)
        return { success: false, error: 'The existing connection provider cannot be changed.' }
      if (!connection && setup.updateOnly) return { success: false, error: 'Connection not found.' }
      if (!connection && !setup.title?.trim()) return { success: false, error: 'A new connection needs a type and a name.' }
      const scope = connection?.scope ?? (setup.scope === 'install' || !ctx.userId
        ? INSTALL_SCOPE
        : setup.scope === 'workspace' && ctx.workspaceId
          ? workspaceScope(ctx.workspaceId)
          : userScope(ctx.userId))
      const key = setup.credential ?? await getCredentialManager().getLlmApiKey(setup.slug, scope)
      const baseUrl = setup.baseUrl !== undefined ? setup.baseUrl?.trim() || undefined : connection?.baseUrl
      const type = setup.type ?? connection!.type
      const customEndpoint = setup.customEndpoint ?? connection?.customEndpoint
      const catalog = await fetchNativeModels({ provider: type, apiKey: key ?? '', baseUrl, api: customEndpoint?.api })
      const requested = (setup.defaultModel ?? connection?.defaultModel)?.replace(/^pi\//, '')
      if (setup.defaultModel && !catalog.models.some((model) => model.id === requested)) return { success: false, error: 'The requested model is not in this connection catalog.' }
      const defaultModel = requested && catalog.models.some((model) => model.id === requested) ? requested : catalog.models[0]?.id
      const credential = setup.credential !== undefined ? { apiKey: setup.credential } : undefined
      if (getConnection(setup.slug, where)?.id !== stored?.id) return { success: false, error: 'Connection changed during setup. Try again.' }
      const saved = stored
        ? updateConnection(stored.id, { baseUrl: baseUrl ?? null, config: { ...stored.config, customEndpoint }, models: catalog.models, defaultModel }, credential)
        : addLlmConnection({ slug: setup.slug, name: setup.title!.trim(), type, authType: 'api_key', baseUrl, customEndpoint, models: catalog.models, defaultModel, createdAt: Date.now() }, { scope, credential })
      if (!saved) return { success: false, error: 'Failed to save connection.' }
      if (!connection && ctx.userId && ctx.workspaceId)
        updateAgentsUnconnected(ctx.workspaceId, ctx.userId, type, getConnections(whereOf(ctx)).map((row) => row.type))
      setSetupDeferred(false)
      return { success: true }
    } catch {
      return { success: false, error: 'Provider setup failed. Check the API key, endpoint, protocol and account model access.' }
    }
  })

  server.handle(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (_ctx, params: import('@otto/shared/protocol').TestLlmConnectionParams) => {
    if (!['openai', 'custom', 'anthropic'].includes(params.type ?? '')) return { success: false, error: OPENAI_UNSUPPORTED }
    return validateNativeConnection({ provider: params.type!, apiKey: params.apiKey, baseUrl: params.baseUrl, api: params.customEndpoint?.api, model: params.model })
  })

  server.handle(RPC_CHANNELS.llmConnections.LIST, async (ctx) => getLlmConnections(whereOf(ctx)))

  server.handle(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS, async (ctx): Promise<LlmConnectionWithStatus[]> => {
    const where = whereOf(ctx)
    const defaultSlug = getDefaultLlmConnection(where)
    return Promise.all(getLlmConnections(where).map(async (connection) => {
      const hasCredentials = await getCredentialManager().hasLlmCredentials(connection.slug, connection.authType, connection.scope)
      const runtimeSupported = isNativeConnection(connection)
      return { ...connection, isAuthenticated: connection.authType === 'none' || hasCredentials, isDefault: connection.slug === defaultSlug,
        runtimeSupported, ...(!runtimeSupported ? { authError: OPENAI_UNSUPPORTED } : {}) }
    }))
  })

  server.handle(RPC_CHANNELS.llmConnections.GET, async (ctx, slug: string) => getLlmConnection(slug, whereOf(ctx)))

  server.handle(RPC_CHANNELS.llmConnections.SAVE, async (ctx, update: LlmConnectionUpdate): Promise<{ success: boolean; error?: string }> => {
    try {
      const where = whereOf(ctx)
      const connection = getLlmConnection(update.slug, where)
      if (!connection) return { success: false, error: 'Connection not found.' }
      const fields: Partial<LlmConnection> = {}
      for (const key of ['name', 'baseUrl', 'models', 'defaultModel', 'midStreamBehavior', 'customEndpoint'] as const)
        if (update[key] !== undefined) Object.assign(fields, { [key]: update[key] })
      if (!updateLlmConnection(update.slug, fields, { where })) return { success: false, error: 'Failed to update connection.' }
      return { success: true }
    } catch {
      return { success: false, error: 'Failed to save connection.' }
    }
  })

  server.handle(RPC_CHANNELS.llmConnections.DELETE, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const where = whereOf(ctx)
      const connection = getLlmConnection(slug, where)
      if (!connection) return { success: false, error: 'Connection not found.' }
      const success = deleteLlmConnection(slug, where)
      if (success) getModelRefreshService().stopConnection(slug, connection.scope)
      return { success }
    } catch {
      return { success: false, error: 'Failed to delete connection.' }
    }
  })

  server.handle(RPC_CHANNELS.llmConnections.TEST, async (ctx, slug: string) => {
    const connection = getLlmConnection(slug, whereOf(ctx))
    if (!connection) return { success: false, error: 'Connection not found.' }
    return validateStoredNativeConnection(connection)
  })

  server.handle(RPC_CHANNELS.llmConnections.SET_DEFAULT, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    const connection = getLlmConnection(slug, whereOf(ctx))
    if (!connection || !isNativeConnection(connection)) return { success: false, error: OPENAI_UNSUPPORTED }
    const success = setDefaultLlmConnection(slug, whereOf(ctx))
    return { success, error: success ? undefined : 'Connection not found.' }
  })

  server.handle(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, async (_ctx, workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }> => {
    try {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) return { success: false, error: 'Workspace not found.' }
      if (slug) {
        const connection = getLlmConnection(slug, { workspaceId: workspace.id })
        if (!connection) return { success: false, error: 'Connection not found.' }
        if (!isNativeConnection(connection)) return { success: false, error: OPENAI_UNSUPPORTED }
      }
      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@otto/shared/workspaces')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) return { success: false, error: 'Failed to load workspace config.' }
      config.defaults ??= {}
      if (slug) config.defaults.defaultLlmConnection = slug
      else delete config.defaults.defaultLlmConnection
      saveWorkspaceConfig(workspace.rootPath, config)
      return { success: true }
    } catch {
      return { success: false, error: 'Failed to set workspace default connection.' }
    }
  })

  server.handle(RPC_CHANNELS.llmConnections.REFRESH_MODELS, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug, whereOf(ctx))
      if (!connection) return { success: false, error: 'Connection not found.' }
      if (!isNativeConnection(connection)) return { success: false, error: OPENAI_UNSUPPORTED }
      const stored = getConnection(slug, whereOf(ctx))
      const key = await getCredentialManager().getLlmApiKey(slug, connection.scope)
      const catalog = await fetchNativeModels({ provider: connection.type, apiKey: key ?? '', baseUrl: connection.baseUrl, api: connection.customEndpoint?.api })
      const currentConnection = getLlmConnection(slug, whereOf(ctx))
      if (getConnection(slug, whereOf(ctx))?.id !== stored?.id || currentConnection?.baseUrl !== connection.baseUrl)
        return { success: false, error: 'Connection changed during refresh. Try again.' }
      const current = connection.defaultModel?.replace(/^pi\//, '')
      updateLlmConnection(slug, { models: catalog.models, defaultModel: current && catalog.models.some((model) => model.id === current) ? current : catalog.models[0]?.id }, { where: whereOf(ctx) })
      return { success: true }
    } catch {
      return { success: false, error: 'Provider model refresh failed. The existing catalog was not changed.' }
    }
  })
}
