import { RPC_CHANNELS, type LlmConnectionSetup, type LlmConnectionUpdate } from '@otto/shared/protocol'
import { getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, isCompatProvider, getDefaultModelForConnection, CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE, type LlmConnection, type LlmConnectionWithStatus, toBedrockNativeId, deriveBedrockRegionPrefix } from '@otto/shared/config'
import { getCredentialManager } from '@otto/shared/credentials'
import { CLAUDE_CODE_OWNER_ONLY, INSTALL_SCOPE, getConnection, isClaudeCodeScope, narrowContext, userScope, workspaceScope, type ConnectionContext, type Credential } from '@otto/shared/connections'
import { setSetupDeferred } from '@otto/shared/config/storage'
import {
  resolveSetupTestConnectionHint,
  testBackendConnection,
  validateStoredBackendConnection,
} from '@otto/shared/agent/backend'
import { getModelRefreshService } from '@otto/server-core/model-fetchers'
import { parseTestConnectionError, createConnectionForSetup, resolveSetupAuthType, validateModelList, getClaudeCodeStatus, setupTestRequiresApiKey } from '@otto/server-core/domain'
import { getWorkspaceOrThrow, buildBackendHostRuntimeContext } from '@otto/server-core/handlers'
import { pushTyped, type RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { CLIENT_OPEN_EXTERNAL } from '@otto/server-core/transport'

// Local OAuth state
let copilotOAuthAbort: AbortController | null = null
let chatGptOAuthAbort: AbortController | null = null

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
  RPC_CHANNELS.chatgpt.START_OAUTH,
  RPC_CHANNELS.chatgpt.CANCEL_OAUTH,
  RPC_CHANNELS.claudeCode.GET_STATUS,
  RPC_CHANNELS.copilot.START_OAUTH,
  RPC_CHANNELS.copilot.CANCEL_OAUTH,
  RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
  RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS,
] as const

export function registerLlmConnectionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps

  // Whose connections a call sees: the caller's own, then the workspace's, then the install's.
  const whereOf = (ctx: { userId: string | null; workspaceId: string | null }): ConnectionContext => ({ userId: ctx.userId, workspaceId: ctx.workspaceId })
  // The scope of the connection a slug names for this caller (undefined: none yet, so a credential is held until the setup saves it).
  const scopeOf = (ctx: { userId: string | null; workspaceId: string | null }, slug: string) =>
    getConnection(slug, whereOf(ctx))?.scope ?? (ctx.userId ? userScope(ctx.userId) : INSTALL_SCOPE)

  // Fire-and-forget model-list refresh after a credential change (setup, re-auth,
  // validation). Re-auth can switch to an account with different model
  // entitlements, so the cached list from the previous account must be replaced
  // (#820). Never throws into the caller — a failed refresh must not fail the
  // credential flow that triggered it.
  const refreshModelsInBackground = (slug: string, scope: string, context: string) => {
    try {
      getModelRefreshService().refreshNow(slug, scope).catch(err => {
        deps.platform.logger?.warn(`Model refresh after ${context} failed for ${slug}: ${err instanceof Error ? err.message : err}`)
      })
    } catch (err) {
      deps.platform.logger?.warn(`Model refresh service unavailable after ${context} for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Unified handler for LLM connection setup
  server.handle(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, async (ctx, setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> => {
    try {
      const manager = getCredentialManager()
      // A new connection is the caller's own unless the setup says it is the workspace's or the install's
      const newScope = setup.scope === 'install' || !ctx.userId
        ? INSTALL_SCOPE
        : setup.scope === 'workspace' && ctx.workspaceId
          ? workspaceScope(ctx.workspaceId)
          : userScope(ctx.userId)
      const where = narrowContext(whereOf(ctx), setup.scope)

      // Ensure the connection exists (the caller's own first, then the workspace's, then the install's)
      let connection = getLlmConnection(setup.slug, where)
      let isNewConnection = false
      if (!connection) {
        // Reauth guard: if updateOnly is set, the connection must already exist.
        // Clean up any orphaned credentials from a preceding OAuth flow.
        if (setup.updateOnly) {
          await manager.deleteLlmCredentials(setup.slug).catch(() => {})
          deps.platform.logger?.warn(`[SETUP_LLM_CONNECTION] updateOnly rejected for missing slug: ${setup.slug}`)
          return { success: false, error: 'Connection not found. Cannot re-authenticate a non-existent connection.' }
        }
        if (!setup.type || !setup.title?.trim()) {
          return { success: false, error: 'A new connection needs a type and a name.' }
        }
        connection = createConnectionForSetup({
          slug: setup.slug,
          type: setup.type,
          title: setup.title.trim(),
          authType: resolveSetupAuthType({ type: setup.type, baseUrl: setup.baseUrl, credential: setup.credential, bedrockAuthMethod: setup.bedrockAuthMethod }),
        })
        isNewConnection = true
      }

      // A Claude subscription runs the server's own `claude` login: the instance owner's own connection, nobody else's
      if (connection.type === CLAUDE_CODE_CONNECTION_TYPE && !isClaudeCodeScope(isNewConnection ? newScope : connection.scope)) {
        return { success: false, error: CLAUDE_CODE_OWNER_ONLY }
      }

      const updates: Partial<LlmConnection> = {}
      if (setup.baseUrl !== undefined) {
        updates.baseUrl = setup.baseUrl?.trim() || undefined
      }
      if (setup.defaultModel !== undefined) {
        updates.defaultModel = setup.defaultModel ?? undefined
      }
      if (setup.models !== undefined) {
        updates.models = setup.models ?? undefined
      }
      if (connection.type === CUSTOM_CONNECTION_TYPE) {
        if (setup.customEndpoint) updates.customEndpoint = setup.customEndpoint
        if (setup.baseUrl !== undefined || setup.credential !== undefined) {
          updates.authType = resolveSetupAuthType({ type: connection.type, baseUrl: setup.baseUrl ?? connection.baseUrl, credential: setup.credential })
        }
      }

      // A provider connection starts with its provider's models, unless the person picked some
      if (isNewConnection && connection.type !== CUSTOM_CONNECTION_TYPE && !setup.models?.length) {
        updates.models = connection.models
        updates.defaultModel = connection.defaultModel
      }

      // Bedrock auth method override: IAM keys or the environment
      if (setup.bedrockAuthMethod) {
        updates.authType = setup.bedrockAuthMethod
      }

      if (connection.type !== CUSTOM_CONNECTION_TYPE) {
        const isBedrock = connection.type === 'amazon-bedrock'
        // For Bedrock, normalize bare Anthropic IDs to Bedrock-native before adding the pi/ prefix
        // so that resolvePiModel() can find them in the amazon-bedrock registry.
        // Use the configured AWS region to select the correct inference profile prefix (us/eu).
        const regionPrefix = isBedrock ? deriveBedrockRegionPrefix(setup.awsRegion) : undefined
        const toPiModelId = (id: string) => {
          const bare = id.startsWith('pi/') ? id.slice(3) : id
          const normalized = isBedrock ? toBedrockNativeId(bare, regionPrefix) : bare
          return `pi/${normalized}`
        }
        if (updates.models) {
          updates.models = updates.models.map(m => typeof m === 'string' ? toPiModelId(m) : { ...m, id: toPiModelId(m.id) })
        }
        if (updates.defaultModel) {
          updates.defaultModel = toPiModelId(updates.defaultModel)
        }
      }

      const pendingConnection: LlmConnection = {
        ...connection,
        ...updates,
      }

      if (updates.models && updates.models.length > 0) {
        const validation = validateModelList(updates.models, pendingConnection.defaultModel)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
        if (validation.resolvedDefaultModel) {
          pendingConnection.defaultModel = validation.resolvedDefaultModel
          updates.defaultModel = validation.resolvedDefaultModel
        }
      }

      if (isCompatProvider(pendingConnection.type) && !pendingConnection.defaultModel) {
        return { success: false, error: 'Default model is required for a custom endpoint.' }
      }

      // The credential to store with the connection (the token a completed sign-in already holds changes nothing).
      // One secret per connection: IAM keys, a new API key or OAuth access token replace what is there.
      let credential: Credential | undefined
      if (setup.iamCredentials) {
        credential = { ...setup.iamCredentials, region: setup.awsRegion }
      } else if (setup.credential && pendingConnection.authType !== 'cli_login') {
        if (pendingConnection.authType !== 'oauth') {
          credential = { apiKey: setup.credential }
        } else if ((await manager.getLlmOAuth(setup.slug, connection.scope ?? newScope))?.accessToken !== setup.credential) {
          credential = { accessToken: setup.credential }
        }
      }

      // The row and its secret are written in one transaction
      const scope = newScope
      if (isNewConnection) {
        const added = addLlmConnection(pendingConnection, { scope, credential })
        if (!added) {
          deps.platform.logger?.error(`Failed to persist LLM connection: ${setup.slug}`)
          return { success: false, error: 'Failed to save connection. Check server logs for details.' }
        }
        deps.platform.logger?.info(`Created LLM connection: ${setup.slug}`)
      } else if (Object.keys(updates).length > 0 || credential) {
        const updated = updateLlmConnection(setup.slug, updates, { where, credential })
        if (!updated) {
          deps.platform.logger?.error(`Failed to update LLM connection: ${setup.slug}`)
          return { success: false, error: 'Failed to update connection. Check server logs for details.' }
        }
        deps.platform.logger?.info(`Updated LLM connection settings: ${setup.slug}`)
      }

      // Fetch available models before returning to the UI.
      // Always refresh for auto-synced connections (e.g. Copilot, Bedrock) — the static
      // catalog from setup is just a seed that needs replacing with live API data
      // filtered by the user's policy. For user-defined connections, only refresh
      // when no models were populated during setup.
      // Awaited so the model selector shows real available models immediately.
      const pendingModels = Array.isArray(pendingConnection.models) ? pendingConnection.models : []
      const isAutoSynced = !isCompatProvider(pendingConnection.type)
      if (!pendingModels.length || isAutoSynced) {
        try {
          await getModelRefreshService().refreshNow(setup.slug, connection.scope ?? scope)
        } catch (err) {
          deps.platform.logger?.warn(`Model refresh after setup failed for ${setup.slug}: ${err instanceof Error ? err.message : err}`)
        }
      }

      // Clear "Setup later" flag now that user has configured a provider
      setSetupDeferred(false)

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger?.error('Failed to setup LLM connection:', message)
      return { success: false, error: message }
    }
  })

  // Unified connection test — uses the agent factory to spawn a real agent subprocess
  // and validate credentials via runMiniCompletion(). Same code path as actual chat.
  server.handle(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (ctx, params: import('@otto/shared/protocol').TestLlmConnectionParams): Promise<import('@otto/shared/protocol').TestLlmConnectionResult> => {
    const { type, apiKey, baseUrl, model, customEndpoint } = params
    // A local server may be keyless
    const allowEmptyApiKey = !setupTestRequiresApiKey(baseUrl)
    const trimmedKey = apiKey.trim()

    const hint = resolveSetupTestConnectionHint({ baseUrl, type, customEndpoint })
    deps.platform.logger?.info(`[testLlmConnectionSetup] Testing: type=${hint.type || '-'}${baseUrl ? ` baseUrl=${baseUrl}` : ''}`)

    const startedAt = Date.now()
    try {
      const testModel = model || getDefaultModelForConnection(hint.type)
      deps.platform.logger?.info(`[testLlmConnectionSetup] Resolved model: ${testModel}`)
      const result = await testBackendConnection({
        apiKey: trimmedKey,
        allowEmptyApiKey,
        model: testModel,
        baseUrl,
        timeoutMs: 45000,
        hostRuntime: buildBackendHostRuntimeContext(deps.platform),
        connection: hint,
      })
      const elapsed = Date.now() - startedAt

      if (!result.success) {
        deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, success=false`)
        deps.platform.logger?.info(`[testLlmConnectionSetup] Raw error: ${(result.error || '').slice(0, 1000)}`)
        return { success: false, error: parseTestConnectionError(result.error || 'Unknown error') }
      }
      deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, success=true`)
      return { success: true }
    } catch (error) {
      const elapsed = Date.now() - startedAt
      const msg = error instanceof Error ? error.message : String(error)
      deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, threw: ${msg.slice(0, 1000)}`)
      return { success: false, error: parseTestConnectionError(msg) }
    }
  })

  // ============================================================
  // Pi Provider Discovery (main process only — Pi SDK can't run in renderer)
  // ============================================================

  server.handle(RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS, async () => {
    const { getPiApiKeyProviders } = await import('@otto/shared/config')
    return getPiApiKeyProviders()
  })

  // ============================================================
  // LLM Connections (provider configurations)
  // ============================================================

  // List all LLM connections (includes built-in and custom)
  server.handle(RPC_CHANNELS.llmConnections.LIST, async (ctx): Promise<LlmConnection[]> => {
    return getLlmConnections(whereOf(ctx))
  })

  // List all LLM connections with authentication status
  server.handle(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS, async (ctx): Promise<LlmConnectionWithStatus[]> => {
    const where = whereOf(ctx)
    const connections = getLlmConnections(where)
    const credentialManager = getCredentialManager()
    const defaultSlug = getDefaultLlmConnection(where)

    return Promise.all(connections.map(async (conn): Promise<LlmConnectionWithStatus> => {
      // Check if credentials exist for this connection
      const hasCredentials = await credentialManager.hasLlmCredentials(conn.slug, conn.authType, conn.scope)
      return {
        ...conn,
        isAuthenticated: conn.authType === 'none' || hasCredentials,
        isDefault: conn.slug === defaultSlug,
      }
    }))
  })

  // Get a specific LLM connection by slug
  server.handle(RPC_CHANNELS.llmConnections.GET, async (ctx, slug: string): Promise<LlmConnection | null> => {
    return getLlmConnection(slug, whereOf(ctx))
  })

  // Save a change to a connection's own fields (name, models, default model, mid-stream behavior, base URL).
  // Its slug, scope and Pi provider never change; a new connection is made by the setup.
  server.handle(RPC_CHANNELS.llmConnections.SAVE, async (ctx, update: LlmConnectionUpdate): Promise<{ success: boolean; error?: string }> => {
    try {
      const where = whereOf(ctx)
      if (!getLlmConnection(update.slug, where)) {
        return { success: false, error: 'Connection not found' }
      }
      // Whatever else rides along (a whole connection from the vision toggle) is ignored
      const { slug, type: _type, authType: _authType, scope: _scope, createdAt: _createdAt, ...fields } = update as LlmConnection
      if (!updateLlmConnection(slug, fields, { where })) {
        return { success: false, error: 'Failed to update connection' }
      }
      deps.platform.logger?.info(`LLM connection saved: ${slug}`)
      // Push runtime updates (e.g. supportsImages toggle) to live sessions on
      // this connection. Detached so SAVE doesn't block on the per-session
      // 15s `update_runtime_config` timeout when subprocesses are slow or
      // wedged. SessionManager serializes the refresh with the next send via
      // its per-session mutex, and the lazy `getOrCreateAgent` refresh remains
      // the correctness backstop if the detached push fails.
      sessionManager.refreshConnectionRuntime(slug).catch(error => {
        deps.platform.logger?.warn(
          `Detached runtime push failed for ${slug}: ${error instanceof Error ? error.message : error}`,
        )
      })
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to save LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Delete an LLM connection (at least one connection must remain)
  server.handle(RPC_CHANNELS.llmConnections.DELETE, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const where = whereOf(ctx)
      const connection = getLlmConnection(slug, where)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }
      // The connection and its secret go together
      const success = deleteLlmConnection(slug, where)
      if (success) {
        // Stop any periodic model refresh timer for this connection
        getModelRefreshService().stopConnection(slug, connection.scope)
        deps.platform.logger?.info(`LLM connection deleted: ${slug}`)
      }
      return { success }
    } catch (error) {
      deps.platform.logger?.error('Failed to delete LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Test an LLM connection: a models-list request for API providers, a token check for OAuth, `claude --version` for Claude Code
  server.handle(RPC_CHANNELS.llmConnections.TEST, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // A Claude subscription runs the server's own `claude`: it is the owner's, and it must be there
      const stored = getLlmConnection(slug, whereOf(ctx))
      if (stored?.type === CLAUDE_CODE_CONNECTION_TYPE) {
        if (!isClaudeCodeScope(stored.scope)) return { success: false, error: CLAUDE_CODE_OWNER_ONLY }
        return (await getClaudeCodeStatus()).found
          ? { success: true }
          : { success: false, error: 'Claude Code was not found on this server. Install it and sign in.' }
      }
      const result = await validateStoredBackendConnection({ slug, where: whereOf(ctx) })
      if (!result.success) {
        deps.platform.logger?.info(`[LLM_CONNECTION_TEST] Raw error for ${slug}: ${(result.error || '').slice(0, 1000)}`)
        return { success: false, error: parseTestConnectionError(result.error || 'Unknown error') }
      }

      deps.platform.logger?.info(`LLM connection validated: ${slug}`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      deps.platform.logger?.info(`[LLM_CONNECTION_TEST] Error for ${slug}: ${msg.slice(0, 500)}`)
      return { success: false, error: parseTestConnectionError(msg) }
    }
  })

  // Set global default LLM connection
  server.handle(RPC_CHANNELS.llmConnections.SET_DEFAULT, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = setDefaultLlmConnection(slug, whereOf(ctx))
      if (success) {
        deps.platform.logger?.info(`Global default LLM connection set to: ${slug}`)
      }
      return { success, error: success ? undefined : 'Connection not found' }
    } catch (error) {
      deps.platform.logger?.error('Failed to set default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Set workspace default LLM connection
  server.handle(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, async (_ctx, workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }> => {
    try {
      const workspace = getWorkspaceOrThrow(workspaceId)

      // Validate connection exists if setting (not clearing)
      if (slug) {
        const connection = getLlmConnection(slug, { workspaceId: workspace.id })
        if (!connection) {
          return { success: false, error: 'Connection not found' }
        }
      }

      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@otto/shared/workspaces')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) {
        return { success: false, error: 'Failed to load workspace config' }
      }

      // Update workspace defaults
      config.defaults = config.defaults || {}
      if (slug) {
        config.defaults.defaultLlmConnection = slug
      } else {
        delete config.defaults.defaultLlmConnection
      }

      saveWorkspaceConfig(workspace.rootPath, config)
      deps.platform.logger?.info(`Workspace ${workspaceId} default LLM connection set to: ${slug}`)
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to set workspace default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Refresh available models for a connection (dynamic model discovery)
  server.handle(RPC_CHANNELS.llmConnections.REFRESH_MODELS, async (ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getConnection(slug, whereOf(ctx))
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      await getModelRefreshService().refreshNow(slug, connection.scope)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger?.error(`Failed to refresh models for ${slug}: ${msg}`)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // ChatGPT sign-in (for Codex chatgptAuthTokens mode)
  // Device code, run entirely here: the client shows the code and the person
  // approves it on any device, so it works in the browser and over remote too.
  // ============================================================

  // chatgpt:startOAuth — get a device code, push it to the client, wait for
  // approval, store the credentials
  server.handle(RPC_CHANNELS.chatgpt.START_OAUTH, async (ctx, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { requestChatGptDeviceCode, pollChatGptDeviceAuth } = await import('@otto/shared/auth')
      const credentialManager = getCredentialManager()

      // Cancel any previous in-flight flow
      chatGptOAuthAbort?.abort()
      const abort = new AbortController()
      chatGptOAuthAbort = abort

      const code = await requestChatGptDeviceCode(abort.signal)
      deps.platform.logger?.info(`[ChatGPT OAuth] Device code issued for ${connectionSlug}`)
      pushTyped(server, RPC_CHANNELS.chatgpt.DEVICE_CODE, { to: 'client', clientId: ctx.clientId }, {
        userCode: code.userCode,
        verificationUri: code.verificationUri,
      })
      // Open the verification page on the client's machine (the UI also offers a button)
      server.invokeClient(ctx.clientId, CLIENT_OPEN_EXTERNAL, code.verificationUri).catch(err => {
        deps.platform.logger?.warn(`Failed to open browser for ChatGPT sign-in: ${err}`)
      })

      const tokens = await pollChatGptDeviceAuth(code, abort.signal)
      if (chatGptOAuthAbort === abort) chatGptOAuthAbort = null

      // The connection's secret (held in memory until the setup creates the connection, when it is new)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      }, scopeOf(ctx, connectionSlug))

      deps.platform.logger?.info(`[ChatGPT OAuth] Signed in for ${connectionSlug}`)
      refreshModelsInBackground(connectionSlug, scopeOf(ctx, connectionSlug), 'ChatGPT auth')
      return { success: true }
    } catch (error) {
      chatGptOAuthAbort = null
      deps.platform.logger?.error('[ChatGPT OAuth] Sign-in failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'ChatGPT sign-in failed',
      }
    }
  })

  // Cancel an ongoing ChatGPT sign-in
  server.handle(RPC_CHANNELS.chatgpt.CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    if (chatGptOAuthAbort) {
      chatGptOAuthAbort.abort()
      chatGptOAuthAbort = null
      deps.platform.logger?.info('[ChatGPT OAuth] Sign-in cancelled')
    }
    return { success: true }
  })

  // Is the user's own `claude` runnable on the machine the server is on? (`claude --version`, no credentials)
  // The instance owner's alone (authorize.ts); a run spawns `claude`, so a call within 2 s of the last gets its answer
  let claudeCodeStatus: { at: number; status: ReturnType<typeof getClaudeCodeStatus> } | undefined
  server.handle(RPC_CHANNELS.claudeCode.GET_STATUS, async () => {
    if (!claudeCodeStatus || Date.now() - claudeCodeStatus.at >= 2000) claudeCodeStatus = { at: Date.now(), status: getClaudeCodeStatus() }
    return claudeCodeStatus.status
  })

  // ============================================================
  // GitHub Copilot OAuth
  // ============================================================

  // Start GitHub Copilot OAuth flow (device flow via Pi SDK)
  server.handle(RPC_CHANNELS.copilot.START_OAUTH, async (ctx, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { loginGitHubCopilot } = await import('@otto/shared/auth')
      const credentialManager = getCredentialManager()

      // Cancel any previous in-flight flow
      copilotOAuthAbort?.abort()
      copilotOAuthAbort = new AbortController()

      deps.platform.logger?.info(`Starting GitHub Copilot OAuth device flow for connection: ${connectionSlug}`)

      // App-owned login flow (pi-ai 0.81.x no longer exports one) — handles the
      // device code flow AND the critical Copilot token exchange that determines
      // the correct API endpoint for the user's subscription tier via proxy-ep.
      const credentials = await loginGitHubCopilot({
        onDeviceCode: ({ userCode, verificationUri }) => {
          deps.platform.logger?.info(`[GitHub OAuth] Device code: ${userCode}`)
          pushTyped(server, RPC_CHANNELS.copilot.DEVICE_CODE, { to: 'client', clientId: ctx.clientId }, {
            userCode,
            verificationUri,
          })
          // Open GitHub device code page on the client's machine
          server.invokeClient(ctx.clientId, CLIENT_OPEN_EXTERNAL, verificationUri).catch(err => {
            deps.platform.logger?.warn(`Failed to open browser for GitHub OAuth: ${err}`)
          })
        },
        onProgress: (message) => {
          deps.platform.logger?.info(`[GitHub OAuth] ${message}`)
        },
        signal: copilotOAuthAbort.signal,
      })

      copilotOAuthAbort = null

      // Store the full OAuth credential:
      // - accessToken = Copilot API token (contains proxy-ep for correct endpoint)
      // - refreshToken = GitHub access token (used to refresh the Copilot token)
      // - expiresAt = Copilot token expiry (short-lived, ~1 hour)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      }, scopeOf(ctx, connectionSlug))

      deps.platform.logger?.info('GitHub Copilot OAuth completed successfully')
      refreshModelsInBackground(connectionSlug, scopeOf(ctx, connectionSlug), 'Copilot auth')
      return { success: true }
    } catch (error) {
      copilotOAuthAbort = null
      deps.platform.logger?.error('GitHub Copilot OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing GitHub OAuth flow
  server.handle(RPC_CHANNELS.copilot.CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    if (copilotOAuthAbort) {
      copilotOAuthAbort.abort()
      copilotOAuthAbort = null
      deps.platform.logger?.info('GitHub Copilot OAuth cancelled')
    }
    return { success: true }
  })
}
