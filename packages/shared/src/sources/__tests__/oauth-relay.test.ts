import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { decodeOAuthRelayState, isOAuthRelayState } from '../../auth/oauth-relay.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

const OAUTH_RELAY_CALLBACK_URL = 'https://relay.test/auth/callback';

describe('SourceCredentialManager.prepareOAuth relay wrapping', () => {
  const credManager = new SourceCredentialManager();

  afterEach(() => {
    delete process.env.OTTO_OAUTH_RELAY_URL;
  });

  beforeEach(() => {
    process.env.OTTO_OAUTH_RELAY_URL = 'https://relay.test';
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
        }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  it('uses the stable relay redirect URI for WebUI Google flows', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'https://otto.example.com/api/oauth/callback',
    });

    expect(result.redirectUri).toBe(OAUTH_RELAY_CALLBACK_URL);
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(OAUTH_RELAY_CALLBACK_URL);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: 'https://otto.example.com/api/oauth/callback',
      innerState: result.state,
    });
  });

  it('uses the relay for desktop Google flows (callbackUrl)', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(result.redirectUri).toBe(OAUTH_RELAY_CALLBACK_URL);
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(OAUTH_RELAY_CALLBACK_URL);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: 'http://localhost:6477/callback',
      innerState: result.state,
    });
  });

  it('passes the stable relay redirect URI into MCP prepare-time metadata flow', async () => {
    const result = await credManager.prepareOAuth(createMcpSource(), {
      callbackUrl: 'https://otto.example.com/api/oauth/callback',
    });

    expect(result.redirectUri).toBe(OAUTH_RELAY_CALLBACK_URL);

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://example.com/oauth/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(OAUTH_RELAY_CALLBACK_URL);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: 'https://otto.example.com/api/oauth/callback',
      innerState: result.state,
    });
  });

  it('uses the callback directly, with no relay envelope, when no relay is set', async () => {
    delete process.env.OTTO_OAUTH_RELAY_URL;
    const callbackUrl = 'http://localhost:6477/callback';
    const result = await credManager.prepareOAuth(createApiSource(), { callbackUrl });

    expect(result.redirectUri).toBe(callbackUrl);
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(callbackUrl);
    expect(authUrl.searchParams.get('state')).toBe(result.state);
    expect(isOAuthRelayState(result.state)).toBe(false);
  });
});
