import { beforeEach, describe, expect, it, mock } from 'bun:test'

const workspaceRootPath = '/tmp/ws-rollback'
const workspace = {
  id: 'ws-1',
  name: 'Workspace',
  rootPath: workspaceRootPath,
}

let idCounter = 0
const storedById = new Map<string, any>()
const deletedIds: string[] = []

// Partial-mock baseline: import real modules via file paths (avoids recursive mock imports)
const actualSharedAgentModule = await import('../../../../../packages/shared/src/agent/index.ts')
const actualSharedAgentBackendModule = await import('../../../../../packages/shared/src/agent/backend/index.ts')
const actualSharedConfigModule = await import('../../../../../packages/shared/src/config/index.ts')
const actualSharedWorkspacesModule = await import('../../../../../packages/shared/src/workspaces/index.ts')
const actualSharedSessionsModule = await import('../../../../../packages/shared/src/sessions/index.ts')
const actualSharedSourcesModule = await import('../../../../../packages/shared/src/sources/index.ts')
const actualSharedAutomationsModule = await import('../../../../../packages/shared/src/automations/index.ts')

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    dock: { setIcon: () => {}, setBadge: () => {} },
    setBadgeCount: () => {},
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  Notification: class {
    static isSupported() { return false }
    on() {}
    show() {}
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
}))

mock.module('@sentry/electron/main', () => ({
  captureException: () => {},
}))

mock.module('../logger', () => {
  const stubLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

mock.module('@otto/shared/config', () => ({
  ...actualSharedConfigModule,
  getWorkspaceByNameOrId: (id: string) => (id === workspace.id ? workspace : null),
  getWorkspaces: () => [workspace],
  loadConfigDefaults: () => ({
    workspaceDefaults: {
      permissionMode: 'ask',
      thinkingLevel: 'medium',
    },
  }),
  getLlmConnection: () => null,
  getDefaultLlmConnection: () => null,
  getToolIconsDir: () => '/tmp/tool-icons',
  getMiniModel: () => 'claude-haiku-4-5-20251001',
  getDefaultThinkingLevel: () => 'medium',
  ConfigWatcher: class ConfigWatcher {
    constructor(..._args: unknown[]) {}
    start() {}
    stop() {}
  },
  MODEL_REGISTRY: [],
  // Targeted stubs: prevent SyntaxError in tests that import these from the barrel
  DEFAULT_MODEL: 'claude-sonnet-4-20250514',
  DEFAULT_THEME: { mode: 'system' },
  getDefaultModelsForConnection: () => ({ default: 'claude-sonnet-4-20250514', mini: 'claude-haiku-4-5-20251001' }),
  getDefaultModelForConnection: () => 'claude-sonnet-4-20250514',
  setActiveWorkspace: () => {},
  getSummarizationModel: () => 'claude-haiku-4-5-20251001',
  ensureConfigDir: () => {},
  ensureConfigDefaults: () => {},
  addWorkspace: async () => null,
  getAllSessionDrafts: () => [],
  // Handler-required stubs: prevent SyntaxError in handler modules loaded by registration test
  getSessionDraft: () => null,
  setSessionDraft: async () => {},
  deleteSessionDraft: async () => {},
  getLlmConnections: () => [],
  addLlmConnection: async () => null,
  updateLlmConnection: async () => null,
  deleteLlmConnection: async () => {},
  setDefaultLlmConnection: async () => {},
  isCompatProvider: () => false,
}))

mock.module('@otto/shared/workspaces', () => ({
  ...actualSharedWorkspacesModule,
  loadWorkspaceConfig: () => ({
    defaults: {
      permissionMode: 'ask',
      thinkingLevel: 'medium',
      defaultLlmConnection: undefined,
    },
  }),
}))

mock.module('@otto/shared/agent', () => ({
  ...actualSharedAgentModule,
  setPermissionMode: () => {},
  getPermissionModeDiagnostics: () => ({ mode: 'ask', source: 'test' }),
  unregisterSessionScopedToolCallbacks: () => {},
  mergeSessionScopedToolCallbacks: () => {},
  hydratePreviousPermissionMode: () => {},
  initializeModeState: () => {},
  cleanupModeState: () => {},
  getPermissionMode: () => 'ask',
  registerSessionScopedToolCallbacks: () => {},
  cleanupSessionScopedTools: () => {},
  getSessionScopedTools: () => [],
  normalizeCanonicalBrowserToolName: (name: string) => name,
}))

mock.module('@otto/shared/agent/backend', () => ({
  ...actualSharedAgentBackendModule,
  resolveSessionConnection: () => null,
  createBackendFromConnection: () => {
    throw new Error('not used in this test')
  },
  resolveBackendContext: () => ({
    resolvedModel: 'pi/gpt-5',
    connection: { type: 'openai' },
  }),
  createBackendFromResolvedContext: () => {
    throw new Error('not used in this test')
  },
  cleanupSourceRuntimeArtifacts: async () => {},
  fetchBackendModels: async () => ({ models: [] }),
  resolveBackendHostTooling: () => ({
    sourceCredentialManager: null,
    sourceServerBuilder: null,
    sourcePoolFactory: null,
    sourcePoolServerFactory: null,
  }),
  testBackendConnection: async () => ({ success: false, error: 'stub' }),
  validateStoredBackendConnection: async () => ({ success: false, error: 'stub' }),
}))

mock.module('@otto/shared/sources', () => ({
  ...actualSharedSourcesModule,
  loadWorkspaceSources: () => [],
  loadAllSources: () => [],
  getSourcesBySlugs: () => [],
  isSourceUsable: () => true,
  getSourcesNeedingAuth: () => [],
  getSourceCredentialManager: () => ({
    getCredentialStatus: async () => ({ status: 'ready' }),
  }),
  getSourceServerBuilder: () => ({ buildServers: async () => ({ mcpServers: {}, apiServers: {} }) }),
  isApiOAuthProvider: () => false,
  SERVER_BUILD_ERRORS: {},
  TokenRefreshManager: class TokenRefreshManager {
    constructor(_mgr: unknown, _opts: unknown) {}
  },
  createTokenGetter: () => async () => null,
  // Targeted stubs: prevent SyntaxError in tests that import these from the barrel
  loadSource: () => null,
  API_OAUTH_PROVIDERS: [],
}))

mock.module('@otto/shared/automations', () => ({
  ...actualSharedAutomationsModule,
  AutomationSystem: class AutomationSystem {
    constructor(..._args: unknown[]) {}
    setInitialSessionMetadata() {}
    emitLabelConfigChange = async () => {}
  },
}))

mock.module('@otto/shared/sessions', () => ({
  ...actualSharedSessionsModule,
  listSessions: () => [],
  loadSession: (_workspace: unknown, id: string) => storedById.get(id) ?? null,
  createSession: (_workspace: unknown, opts: any) => {
    const id = `child-${++idCounter}`
    const now = Date.now()
    const session = {
      id,
      name: opts?.name ?? null,
      messages: [],
      permissionMode: opts?.permissionMode ?? 'ask',
      workingDirectory: opts?.workingDirectory,
      labels: [],
      isFlagged: false,
      sessionStatus: opts?.sessionStatus,
      createdAt: now,
      lastUsedAt: now,
      workspaceRootPath: workspaceRootPath,
    }
    storedById.set(id, session)
    return session
  },
  deleteSession: (_workspace: unknown, id: string) => {
    deletedIds.push(id)
    storedById.delete(id)
    return true
  },
  getSessionPath: (_root: string, id: string) => `${workspaceRootPath}/sessions/${id}`,
  sessionPersistenceQueue: { enqueue: () => {}, flush: async () => {}, flushAll: async () => {}, cancel: () => {}, forget: () => {}, hasPending: () => false },
  pickSessionFields: (s: any) => {
    // Must match SESSION_PERSISTENT_FIELDS to prevent contamination of persistence tests
    const fields = [
      'id','workspaceRootPath','sdkSessionId',
      'createdAt','lastUsedAt','lastMessageAt',
      'name','isFlagged','sessionStatus','labels',
      'lastReadMessageId','hasUnread',
      'enabledSourceSlugs','permissionMode','previousPermissionMode','workingDirectory',
      'model','llmConnection','connectionLocked','thinkingLevel',
      'sharedUrl','sharedId','pendingPlanExecution',
      'isArchived',
      'branchFromMessageId','branchFromSdkSessionId','branchFromSessionPath',
    ]
    const result: Record<string, unknown> = {}
    for (const f of fields) if (f in s) result[f] = (s as Record<string, unknown>)[f]
    return result
  },
  validateSessionId: () => true,
}))

const { SessionManager } = await import('@otto/server-core/sessions')

describe('session branch rollback on preflight failure', () => {
  beforeEach(() => {
    idCounter = 0
    storedById.clear()
    deletedIds.length = 0

    storedById.set('source-1', {
      id: 'source-1',
      workspaceRootPath,
      llmConnection: undefined,
      model: 'pi/gpt-5',
      sdkSessionId: 'sdk-parent',
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: Date.now() - 10 },
        { id: 'm2', type: 'assistant', content: 'hi', timestamp: Date.now() - 5 },
      ],
      createdAt: Date.now() - 20,
      lastUsedAt: Date.now() - 5,
    })
  })

  it('deletes newly created child session when ensureBranchReady throws', async () => {
    const manager = new SessionManager()

    let destroyCalled = false

    ;(manager as any).ensureMessagesLoaded = async (_managed: any) => {}
    ;(manager as any).getOrCreateAgent = async (managed: any) => {
      managed.agent = {
        supportsBranching: true,
        ensureBranchReady: async () => {
          throw new Error('preflight boom')
        },
        destroy: () => {
          destroyCalled = true
        },
      }
      return managed.agent
    }

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('Could not create branch: preflight boom')

    expect(deletedIds).toEqual(['child-1'])
    expect(storedById.has('child-1')).toBe(false)
    expect((manager as any).sessions.has('child-1')).toBe(false)
    expect(destroyCalled).toBe(true)
  })

  it('fails branch creation when the parent has no Pi session yet', async () => {
    const source = storedById.get('source-1')
    source.sdkSessionId = undefined
    storedById.set('source-1', source)

    const manager = new SessionManager()

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('parent session SDK context is not initialized')

    expect(deletedIds).toEqual([])
    expect(storedById.has('child-1')).toBe(false)
  })

  it('runs backend preflight for pi branches and rolls back on failure', async () => {
    const manager = new SessionManager()
    let getOrCreateAgentCalled = false

    ;(manager as any).ensureMessagesLoaded = async (_managed: any) => {}
    ;(manager as any).getOrCreateAgent = async (managed: any) => {
      getOrCreateAgentCalled = true
      managed.agent = {
        supportsBranching: true,
        ensureBranchReady: async () => {
          throw new Error('pi preflight boom')
        },
        destroy: () => {},
      }
      return managed.agent
    }

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('Could not create branch: pi preflight boom')

    expect(getOrCreateAgentCalled).toBe(true)
    expect(deletedIds).toEqual(['child-1'])
    expect(storedById.has('child-1')).toBe(false)
  })
})
