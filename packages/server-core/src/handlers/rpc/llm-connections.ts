import { RPC_CHANNELS, type LlmConnectionSelector, type LlmConnectionSetup, type LlmConnectionUpdate, type TestLlmConnectionParams } from '@otto/shared/protocol'
import type { LlmConnectionWithStatus } from '@otto/shared/config/llm-connections'
import { getVisibleLlmConnections, addLlmConnection, deleteLlmConnection, setDefaultLlmConnection, setSetupDeferred, getWorkspaceByNameOrId, toLlmConnection } from '@otto/shared/config/storage'
import { getCredentialManager } from '@otto/shared/credentials'
import { INSTALL_SCOPE, getConnection, getConnectionById, getConnections, getDefaultConnection, updateConnection, narrowContext, userScope, workspaceScope, type Connection, type ConnectionContext } from '@otto/shared/connections'
import { getMemberRole } from '@otto/shared/workspaces'
import { updateAgentsUnconnected } from '@otto/shared/agents'
import { getModelRefreshService } from '../../model-fetchers'
import { nativeProviderBaseUrl } from '../../sessions/mastra-chat'
import type { RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { fetchNativeModels, validateNativeConnection, isNativeConnection, retainModelImageOverrides, NATIVE_PROVIDER_UNSUPPORTED as OPENAI_UNSUPPORTED } from '../../model-fetchers/native-provider'

type Identity = Partial<LlmConnectionSelector>
type Selector = string | LlmConnectionSelector
const selectorOf = (value: Selector): Identity => typeof value === 'string' ? { slug: value } : value
const failed = (error: string) => ({ success: false, error })

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

export function registerLlmConnectionsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const whereOf = (ctx: RequestContext): ConnectionContext => ({ userId: ctx.userId, workspaceId: ctx.workspaceId && ctx.userId && getMemberRole(ctx.workspaceId, ctx.userId) ? ctx.workspaceId : null })
  const resolve = (ctx: RequestContext, identity: Identity, mutate = false): Connection | undefined => {
    const where = whereOf(ctx)
    if (identity.scope && !['user', 'workspace', 'install'].includes(identity.scope)) return undefined
    if (identity.scope === 'user' && !where.userId || identity.scope === 'workspace' && !where.workspaceId) return undefined
    const narrowed = narrowContext(where, identity.scope)
    const row = identity.connectionId ? getConnectionById(identity.connectionId, narrowed) : identity.slug ? getConnection(identity.slug, narrowed) : undefined
    if (!row || identity.slug && row.slug !== identity.slug || identity.expectedUpdatedAt !== undefined && row.updatedAt !== identity.expectedUpdatedAt) return undefined
    if (mutate && (row.scope === INSTALL_SCOPE || row.scope.startsWith('workspace:') && (!ctx.userId || getMemberRole(row.scope.slice('workspace:'.length), ctx.userId) !== 'owner'))) return undefined
    return row
  }
  const assertCurrent = (ctx: RequestContext, row: Connection, mutate = false) => {
    if (!resolve(ctx, { connectionId: row.id, slug: row.slug, expectedUpdatedAt: row.updatedAt }, mutate)) throw new Error('Connection changed. Try again.')
  }
  const assertConsent = (row: Connection, provider: string, baseUrl: string | undefined, api: string | undefined, approvedCredentialOrigin?: string) => {
    const origin = nativeProviderBaseUrl({ provider, baseUrl, api }).origin
    const previous = nativeProviderBaseUrl({ provider: row.type, baseUrl: row.baseUrl ?? undefined, api: row.config.customEndpoint?.api }).origin
    if (origin !== previous && approvedCredentialOrigin !== origin) throw new Error('Approve sending the stored key to the new endpoint origin.')
  }
  const keyFor = async (ctx: RequestContext, input: Identity & { approvedCredentialOrigin?: string }, row: Connection | undefined, key: string | undefined, endpoint: { provider: string; baseUrl?: string; api?: string }, mutate: boolean): Promise<string> => {
    const candidate = nativeProviderBaseUrl(endpoint)
    if (key?.trim()) return key.trim()
    if (!row || input.connectionId !== row.id) throw new Error('An API key or an exact saved connection is required.')
    const configured = nativeProviderBaseUrl({ provider: row.type, baseUrl: row.baseUrl ?? undefined, api: row.config.customEndpoint?.api })
    if (configured.href.replace(/\/$/, '') !== candidate.href.replace(/\/$/, '') ||
      (row.config.customEndpoint?.api ?? (row.type === 'anthropic' ? 'anthropic-messages' : 'openai-responses')) !== (endpoint.api ?? (endpoint.provider === 'anthropic' ? 'anthropic-messages' : 'openai-responses'))) assertCurrent(ctx, row, true)
    assertConsent(row, endpoint.provider, endpoint.baseUrl, endpoint.api, input.approvedCredentialOrigin)
    const stored = await getCredentialManager().getLlmApiKey(row.slug, row.scope)
    assertCurrent(ctx, row, mutate)
    if (!stored?.trim()) throw new Error('An API key is required.')
    return stored
  }

  server.handle(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, async (ctx, setup: LlmConnectionSetup) => {
    try {
      const stored = resolve(ctx, setup, true)
      if (setup.scope && !['user', 'workspace', 'install'].includes(setup.scope)) return failed('Invalid connection scope.')
      if ((setup.connectionId || setup.updateOnly) && !stored) return failed('Connection not found or changed.')
      const existing = resolve(ctx, setup)
      if (existing && !stored) return failed('This connection is read-only.')
      const type = stored?.type ?? setup.type
      if (!type || !['openai', 'anthropic', 'custom'].includes(type) || stored && stored.authType !== 'api_key' || !stored && type === 'custom') return failed(OPENAI_UNSUPPORTED)
      if (stored && setup.type && setup.type !== stored.type && !(stored.type === 'custom' && setup.type === 'openai')) return failed('The existing connection provider cannot be changed.')
      const where = whereOf(ctx)
      if (!stored && (!ctx.userId || setup.scope === 'install' || setup.scope === 'workspace' && (!where.workspaceId || getMemberRole(where.workspaceId, ctx.userId) !== 'owner'))) return failed('This connection scope is read-only.')
      if (!stored && !setup.title?.trim()) return failed('A new connection needs a type and a name.')
      const scope = stored?.scope ?? (setup.scope === 'workspace' ? workspaceScope(where.workspaceId!) : userScope(ctx.userId!))
      const baseUrl = setup.baseUrl !== undefined ? setup.baseUrl?.trim() || undefined : stored?.baseUrl ?? undefined
      const customEndpoint = setup.customEndpoint !== undefined ? { ...stored?.config.customEndpoint, ...setup.customEndpoint } : stored?.config.customEndpoint
      const endpoint = { provider: type, baseUrl, api: customEndpoint?.api }
      const key = await keyFor(ctx, setup, stored, setup.credential, endpoint, true)
      if (stored) assertCurrent(ctx, stored, true)
      const catalog = await fetchNativeModels({ ...endpoint, apiKey: key })
      const requested = (setup.defaultModel !== undefined ? setup.defaultModel : stored?.defaultModel)?.replace(/^pi\//, '')
      if (setup.defaultModel && !catalog.models.some((model) => model.id === requested)) return failed('The requested model is not in this connection catalog.')
      const defaultModel = requested && catalog.models.some((model) => model.id === requested) ? requested : catalog.models[0]?.id
      if (stored) {
        assertCurrent(ctx, stored, true)
        updateConnection(stored.id, { baseUrl: baseUrl ?? null, config: { ...stored.config, customEndpoint }, models: retainModelImageOverrides(catalog.models, stored.models), defaultModel }, setup.credential?.trim() ? { apiKey: key } : undefined, stored.updatedAt)
      } else {
        if (resolve(ctx, setup) || !ctx.userId || scope !== (setup.scope === 'workspace' && ctx.workspaceId ? workspaceScope(ctx.workspaceId) : userScope(ctx.userId)) || setup.scope === 'workspace' && (!ctx.workspaceId || getMemberRole(ctx.workspaceId, ctx.userId) !== 'owner')) return failed('Connection changed during setup. Try again.')
        if (!addLlmConnection({ slug: setup.slug, name: setup.title!.trim(), type, authType: 'api_key', baseUrl, customEndpoint, models: catalog.models, defaultModel, createdAt: Date.now() }, { scope, credential: { apiKey: key } })) return failed('Failed to save connection.')
      }
      if (!stored && ctx.userId && ctx.workspaceId) updateAgentsUnconnected(ctx.workspaceId, ctx.userId, type, getConnections(whereOf(ctx)).map((row) => row.type))
      setSetupDeferred(false)
      return { success: true }
    } catch { return failed('Provider setup failed. Check the API key, endpoint, protocol, credential-origin approval and current connection version.') }
  })

  server.handle(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (ctx, params: TestLlmConnectionParams) => {
    try {
      const stored = resolve(ctx, params)
      if (params.connectionId && !stored) return failed('Connection not found or changed.')
      const type = stored?.type ?? params.type
      if (!type || !['openai', 'anthropic', 'custom'].includes(type) || type === 'custom' && !stored || stored && (params.type && params.type !== stored.type && !(stored.type === 'custom' && params.type === 'openai') || stored.authType !== 'api_key')) return failed(OPENAI_UNSUPPORTED)
      const baseUrl = params.baseUrl !== undefined ? params.baseUrl?.trim() || undefined : stored?.baseUrl ?? undefined
      const endpoint = { provider: type, baseUrl, api: params.customEndpoint?.api ?? stored?.config.customEndpoint?.api }
      const apiKey = await keyFor(ctx, params, stored, params.apiKey, endpoint, false)
      if (stored) assertCurrent(ctx, stored)
      const unchangedEndpoint = stored && nativeProviderBaseUrl(endpoint).href.replace(/\/$/, '') === nativeProviderBaseUrl({ provider: stored.type, baseUrl: stored.baseUrl ?? undefined, api: stored.config.customEndpoint?.api }).href.replace(/\/$/, '')
        && (endpoint.api ?? (type === 'anthropic' ? 'anthropic-messages' : 'openai-responses')) === (stored.config.customEndpoint?.api ?? (stored.type === 'anthropic' ? 'anthropic-messages' : 'openai-responses'))
      const result = await validateNativeConnection({ ...endpoint, apiKey, model: params.model !== undefined ? params.model?.trim() || undefined : unchangedEndpoint ? stored?.defaultModel ?? undefined : undefined })
      if (stored) assertCurrent(ctx, stored)
      return result
    } catch { return failed('Provider validation failed. Check the key, endpoint, protocol, credential-origin approval and current connection version.') }
  })

  server.handle(RPC_CHANNELS.llmConnections.LIST, async (ctx) => getVisibleLlmConnections(whereOf(ctx)))
  server.handle(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS, async (ctx): Promise<LlmConnectionWithStatus[]> => {
    const defaultId = getDefaultConnection(whereOf(ctx))?.id
    const results = await Promise.all(getVisibleLlmConnections(whereOf(ctx)).map(async (connection) => {
      const hasCredentials = await getCredentialManager().hasLlmCredentials(connection.slug, connection.authType, connection.scope)
      if (!resolve(ctx, { connectionId: connection.id, slug: connection.slug, expectedUpdatedAt: connection.updatedAt })) return null
      const runtimeSupported = isNativeConnection(connection)
      return { ...connection, isAuthenticated: connection.authType === 'none' || hasCredentials, isDefault: connection.id === defaultId, runtimeSupported, ...(!runtimeSupported ? { authError: OPENAI_UNSUPPORTED } : {}) }
    }))
    return results.filter((row): row is NonNullable<typeof row> => row !== null)
  })
  server.handle(RPC_CHANNELS.llmConnections.GET, async (ctx, selector: Selector) => {
    const row = resolve(ctx, selectorOf(selector))
    return row ? toLlmConnection(row) : null
  })
  server.handle(RPC_CHANNELS.llmConnections.SAVE, async (ctx, update: LlmConnectionUpdate) => {
    try {
      const row = resolve(ctx, update, true)
      if (!row) return failed('Connection not found, read-only or changed.')
      const baseUrl = update.baseUrl !== undefined ? update.baseUrl?.trim() || undefined : row.baseUrl ?? undefined
      const customEndpoint = update.customEndpoint !== undefined ? { ...row.config.customEndpoint, ...update.customEndpoint } : row.config.customEndpoint
      if (update.baseUrl !== undefined || update.customEndpoint !== undefined) {
        nativeProviderBaseUrl({ provider: row.type, baseUrl, api: customEndpoint?.api })
        if (row.hasSecret) {
          if (update.connectionId !== row.id) return failed('An exact saved connection is required to edit its endpoint.')
          assertConsent(row, row.type, baseUrl, customEndpoint?.api, update.approvedCredentialOrigin)
        }
      }
      updateConnection(row.id, {
        title: update.name,
        baseUrl: update.baseUrl !== undefined ? baseUrl ?? null : undefined,
        models: update.models,
        defaultModel: update.defaultModel,
        config: { ...row.config, customEndpoint, midStreamBehavior: update.midStreamBehavior ?? row.config.midStreamBehavior },
      }, undefined, row.updatedAt)
      return { success: true }
    } catch { return failed('Failed to save connection. Check endpoint approval and the current connection version.') }
  })
  server.handle(RPC_CHANNELS.llmConnections.DELETE, async (ctx, selector: Selector) => {
    try {
      const row = resolve(ctx, selectorOf(selector), true)
      if (!row) return failed('Connection not found, read-only or changed.')
      const success = deleteLlmConnection(row.slug, whereOf(ctx), row.id, row.updatedAt)
      if (success) getModelRefreshService().stopConnection(row.slug, row.scope)
      return { success }
    } catch { return failed('Failed to delete connection.') }
  })
  server.handle(RPC_CHANNELS.llmConnections.TEST, async (ctx, selector: Selector) => {
    try {
      const row = resolve(ctx, selectorOf(selector))
      if (!row) return failed('Connection not found or changed.')
      const connection = toLlmConnection(row)
      if (!isNativeConnection(connection)) return failed(OPENAI_UNSUPPORTED)
      const endpoint = { provider: row.type, baseUrl: row.baseUrl ?? undefined, api: row.config.customEndpoint?.api }
      const apiKey = await keyFor(ctx, { connectionId: row.id }, row, undefined, endpoint, false)
      const result = await validateNativeConnection({ ...endpoint, apiKey, model: row.defaultModel ?? undefined })
      assertCurrent(ctx, row)
      return result
    } catch { return failed('Provider validation failed. Check the current connection and permissions.') }
  })
  server.handle(RPC_CHANNELS.llmConnections.SET_DEFAULT, async (ctx, selector: Selector) => {
    const identity = selectorOf(selector)
    const row = resolve(ctx, identity)
    if (!row || !isNativeConnection(toLlmConnection(row))) return failed(OPENAI_UNSUPPORTED)
    return { success: setDefaultLlmConnection(row.slug, whereOf(ctx), identity.connectionId ? row.id : undefined) }
  })
  server.handle(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, async (ctx, workspaceId: string, selector: Selector | null) => {
    try {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace || !ctx.userId || getMemberRole(workspace.id, ctx.userId) !== 'owner') return failed('Workspace owner access is required.')
      const identity = selector === null ? undefined : selectorOf(selector)
      if (identity?.scope === 'user') return failed('A workspace default cannot use a private connection.')
      const connection = identity ? (identity.connectionId ? getConnectionById(identity.connectionId, { workspaceId: workspace.id }) : getConnection(identity.slug!, { workspaceId: workspace.id })) : undefined
      if (identity && (!connection || connection.scope.startsWith('user:') || identity.slug && connection.slug !== identity.slug || identity.expectedUpdatedAt !== undefined && connection.updatedAt !== identity.expectedUpdatedAt)) return failed('Connection not found or changed.')
      if (identity?.scope && connection?.scope !== (identity.scope === 'install' ? INSTALL_SCOPE : workspaceScope(workspace.id))) return failed('Connection scope does not match.')
      if (connection && !isNativeConnection(toLlmConnection(connection))) return failed(OPENAI_UNSUPPORTED)
      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@otto/shared/workspaces')
      if (!ctx.userId || getMemberRole(workspace.id, ctx.userId) !== 'owner') return failed('Workspace owner access is required.')
      if (connection && getConnectionById(connection.id, { workspaceId: workspace.id })?.updatedAt !== connection.updatedAt) return failed('Connection changed. Try again.')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) return failed('Failed to load workspace config.')
      config.defaults ??= {}
      if (connection) { config.defaults.defaultLlmConnection = connection.slug; config.defaults.defaultLlmConnectionId = identity?.connectionId ? connection.id : undefined }
      else { delete config.defaults.defaultLlmConnection; delete config.defaults.defaultLlmConnectionId }
      saveWorkspaceConfig(workspace.rootPath, config)
      return { success: true }
    } catch { return failed('Failed to set workspace default connection.') }
  })
  server.handle(RPC_CHANNELS.llmConnections.REFRESH_MODELS, async (ctx, selector: Selector) => {
    try {
      const row = resolve(ctx, selectorOf(selector), true)
      if (!row) return failed('Connection not found, read-only or changed.')
      if (!isNativeConnection(toLlmConnection(row))) return failed(OPENAI_UNSUPPORTED)
      const endpoint = { provider: row.type, baseUrl: row.baseUrl ?? undefined, api: row.config.customEndpoint?.api }
      const apiKey = await keyFor(ctx, { connectionId: row.id }, row, undefined, endpoint, true)
      const catalog = await fetchNativeModels({ ...endpoint, apiKey })
      assertCurrent(ctx, row, true)
      const current = row.defaultModel?.replace(/^pi\//, '')
      updateConnection(row.id, { models: retainModelImageOverrides(catalog.models, row.models), defaultModel: current && catalog.models.some((model) => model.id === current) ? current : catalog.models[0]?.id }, undefined, row.updatedAt)
      return { success: true }
    } catch { return failed('Provider model refresh failed. The existing catalog was not changed.') }
  })
}
