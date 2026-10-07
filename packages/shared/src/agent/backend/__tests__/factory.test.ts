/**
 * Tests for the agent factory: every chat runs on Pi.
 */
import { beforeAll, describe, it, expect } from 'bun:test';
import {
  createBackend,
  createBackendFromResolvedContext,
  fetchBackendModels,
  resolveModel,
  resolveSetupTestConnectionHint,
  testBackendConnection,
  validateStoredBackendConnection,
} from '../factory.ts';
import type { BackendConfig } from '../types.ts';
import { ensureConfigDir, type Workspace, type LlmConnection } from '../../../config/storage.ts';
import type { SessionConfig as Session } from '../../../sessions/storage.ts';
import { PiAgent } from '../../pi-agent.ts';
import { isValidProviderAuthCombination } from '../../../config/llm-connections.ts';
import { CLAUDE_CODE_OWNER_ONLY } from '../../../connections/index.ts';

beforeAll(() => ensureConfigDir());

// Test helpers
function createTestWorkspace(): Workspace {
  return {
    id: 'test-workspace',
    name: 'Test Workspace',
    slug: 'workspace',
    rootPath: '/test/workspace',
    createdAt: Date.now(),
  };
}

function createTestSession(): Session {
  return {
    id: 'test-session',
    name: 'Test Session',
    workspaceRootPath: '/test/workspace',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  };
}

function createTestConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    workspace: createTestWorkspace(),
    session: createTestSession(),
    isHeadless: true, // Prevent config watchers from starting
    ...overrides,
  };
}

const hostRuntime = { appRootPath: process.cwd(), isPackaged: false };

describe('createBackend', () => {
  it('always makes a PiAgent', () => {
    const agent = createBackend(createTestConfig());
    expect(agent).toBeInstanceOf(PiAgent);
    agent.destroy();
  });

  it("a Claude subscription connection runs on Pi with the claude-code provider and no credential", () => {
    const connection: LlmConnection = {
      slug: 'claude-max', name: 'Claude', type: 'claude-code', authType: 'cli_login',
      models: ['pi/claude-opus-5-5'], defaultModel: 'pi/claude-opus-5-5', createdAt: 0,
    };
    const agent = createBackendFromResolvedContext({
      context: { connection, authType: 'cli_login', resolvedModel: 'pi/claude-opus-5-5' },
      coreConfig: createTestConfig(),
      hostRuntime,
    });
    expect(agent).toBeInstanceOf(PiAgent);
    expect((agent as any).config.authType).toBe('cli_login');
    expect((agent as any).config.runtime.piAuthProvider).toBe('claude-code');
    expect(agent.getModel()).toBe('pi/claude-opus-5-5');
    // not the instance owner's own connection: the chat is told so and never runs
    expect((agent as any).config.missingConnection).toBe(CLAUDE_CODE_OWNER_ONLY);
    agent.destroy();
  });

  it('setModel updates getModel', () => {
    const agent = createBackend(createTestConfig({ model: 'pi/claude-opus-4-7' }));
    expect(agent.getModel()).toBe('pi/claude-opus-4-7');
    agent.setModel('pi/claude-sonnet-4-6');
    expect(agent.getModel()).toBe('pi/claude-sonnet-4-6');
    agent.destroy();
  });
});

describe('isValidProviderAuthCombination', () => {
  it('a Pi provider takes keys, OAuth, IAM, the environment, none and a CLI sign-in', () => {
    for (const authType of ['api_key', 'oauth', 'iam_credentials', 'environment', 'none', 'cli_login'] as const) {
      expect(isValidProviderAuthCombination('openrouter', authType)).toBe(true);
    }
  });

  it('a custom endpoint takes a key with its endpoint, or none (local models)', () => {
    expect(isValidProviderAuthCombination('custom', 'api_key_with_endpoint')).toBe(true);
    expect(isValidProviderAuthCombination('custom', 'none')).toBe(true);
    expect(isValidProviderAuthCombination('custom', 'cli_login')).toBe(false);
  });
});

describe('factory APIs', () => {
  it('resolveSetupTestConnectionHint maps baseUrl/type/customEndpoint', () => {
    expect(resolveSetupTestConnectionHint({
      type: 'openai-codex',
    })).toEqual({ type: 'openai-codex' });

    expect(resolveSetupTestConnectionHint({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      customEndpoint: { api: 'openai-completions' },
    })).toEqual({ type: 'custom', customEndpoint: { api: 'openai-completions' } });

    expect(resolveSetupTestConnectionHint({
      baseUrl: 'https://my-anthropic-proxy.internal/v1',
      customEndpoint: { api: 'anthropic-messages' },
    })).toEqual({ type: 'custom', customEndpoint: { api: 'anthropic-messages' } });
  });

  it('fetchBackendModels lists Pi models', async () => {
    const connection: LlmConnection = {
      slug: 'pi-test',
      name: 'Pi Test',
      type: 'openrouter',
      authType: 'none',
      createdAt: Date.now(),
    };

    const result = await fetchBackendModels({ connection, credentials: {} });
    expect(result.models.length).toBeGreaterThan(0);
  });

  it('validateStoredBackendConnection returns not found for unknown slug', async () => {
    const result = await validateStoredBackendConnection({ slug: '__missing-connection__' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection not found');
  });

  it('testBackendConnection keeps required model argument and validates key presence', async () => {
    const result = await testBackendConnection({
      apiKey: '   ',
      model: 'pi/claude-sonnet-4-6',
      hostRuntime,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('API key is required');
  });
});

describe('resolveModel', () => {
  it('falls back to the connection default when a normalized stale model is not in the connection list', () => {
    const connection = {
      type: 'anthropic',
      defaultModel: 'pi/claude-opus-4-7',
      models: ['pi/claude-opus-4-7', 'pi/claude-sonnet-4-6'],
    } as unknown as LlmConnection;

    expect(resolveModel('pi/claude-opus-4-6', connection)).toBe('pi/claude-opus-4-7');
  });

  it("a chat of the removed Claude backend (a bare Claude id) gets the connection's model", () => {
    const connection = { type: 'anthropic', defaultModel: 'pi/claude-opus-5-5', models: ['pi/claude-opus-5-5'] } as unknown as LlmConnection;
    expect(resolveModel('claude-opus-5-5', connection)).toBe('pi/claude-opus-5-5');
  });
});
