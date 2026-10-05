// Slack reads its client id at module load, so configure it before anything
// imports the Slack module. `.isolated.ts`: the root test script runs this file
// in its own process, because a shared module cache from another test file
// would already hold an unconfigured Slack module.
process.env.SLACK_OAUTH_CLIENT_ID = 'slack-test-client';
process.env.SLACK_OAUTH_CLIENT_SECRET = 'slack-test-secret';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isOAuthRelayState, decodeOAuthRelayState } from '../../auth/oauth-relay.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

const { SourceCredentialManager } = await import('../credential-manager.ts');
const { getSlackLegacyRelayCallbackUrl, slackLegacyRelayPortForReturnTo, slackLegacyRelayRedirectUri } = await import('../../auth/slack-oauth.ts');

const RELAY_URL = 'https://relay.test';
const OAUTH_RELAY_CALLBACK_URL = `${RELAY_URL}/auth/callback`;
const SLACK_LEGACY_RELAY_CALLBACK_URL = `${RELAY_URL}/auth/slack/callback`;

beforeEach(() => {
  process.env.OTTO_OAUTH_RELAY_URL = RELAY_URL;
});

afterEach(() => {
  delete process.env.OTTO_OAUTH_RELAY_URL;
});

function createSlackSource(): LoadedSource {
  return {
    config: {
      id: 'slack-id',
      slug: 'slack',
      name: 'Slack',
      type: 'api',
      provider: 'slack',
      enabled: true,
      api: {
        baseUrl: 'https://slack.com/api/',
        authType: 'oauth',
      },
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/slack',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

// Regression for otto#1068: since the generic OAuth relay was
// introduced, desktop Slack flows sent redirect_uri=<relay>/auth/callback,
// which the Slack app does not have registered, so Slack rejected the request
// before consent.
describe('slackLegacyRelayPortForReturnTo', () => {
  it('accepts the desktop callback server target', () => {
    expect(slackLegacyRelayPortForReturnTo('http://localhost:6477/callback')).toBe(6477);
    expect(slackLegacyRelayPortForReturnTo('http://127.0.0.1:8914/callback')).toBe(8914);
  });

  it('rejects targets the legacy relay cannot serve', () => {
    expect(slackLegacyRelayPortForReturnTo('https://otto.example.com/api/oauth/callback')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo('http://localhost:6477/oauth/callback')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo('http://localhost/callback')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo('http://localhost:80/callback')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo('https://localhost:6477/callback')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo('not a url')).toBeUndefined();
    expect(slackLegacyRelayPortForReturnTo(undefined)).toBeUndefined();
  });

  it('builds the registered relay redirect for a port', () => {
    expect(getSlackLegacyRelayCallbackUrl()).toBe(SLACK_LEGACY_RELAY_CALLBACK_URL);
    expect(slackLegacyRelayRedirectUri(6477)).toBe(`${SLACK_LEGACY_RELAY_CALLBACK_URL}?port=6477`);
  });

  it('falls back to the local callback when no relay is set', () => {
    delete process.env.OTTO_OAUTH_RELAY_URL;
    expect(getSlackLegacyRelayCallbackUrl()).toBeUndefined();
    expect(slackLegacyRelayRedirectUri(6477)).toBe('http://localhost:6477/callback');
  });
});

describe('SourceCredentialManager.prepareOAuth for Slack', () => {
  const credManager = new SourceCredentialManager();

  it('desktop flows use the registered Slack relay and no relay envelope', async () => {
    const result = await credManager.prepareOAuth(createSlackSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(result.provider).toBe('slack');
    expect(result.redirectUri).toBe(`${SLACK_LEGACY_RELAY_CALLBACK_URL}?port=6477`);

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${SLACK_LEGACY_RELAY_CALLBACK_URL}?port=6477`);
    expect(authUrl.searchParams.get('client_id')).toBe('slack-test-client');
    // The worker forwards Slack's state untouched, so it must be the inner state itself.
    expect(authUrl.searchParams.get('state')).toBe(result.state);
    expect(isOAuthRelayState(result.state)).toBe(false);
  });

  it('desktop flows started with a callback port behave the same way', async () => {
    const result = await credManager.prepareOAuth(createSlackSource(), { callbackPort: 6480 });
    expect(result.redirectUri).toBe(`${SLACK_LEGACY_RELAY_CALLBACK_URL}?port=6480`);
  });

  it('WebUI flows keep the generic relay envelope', async () => {
    const returnTo = 'https://otto.example.com/api/oauth/callback';
    const result = await credManager.prepareOAuth(createSlackSource(), { callbackUrl: returnTo });

    expect(result.redirectUri).toBe(OAUTH_RELAY_CALLBACK_URL);
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(OAUTH_RELAY_CALLBACK_URL);
    const outerState = authUrl.searchParams.get('state')!;
    expect(isOAuthRelayState(outerState)).toBe(true);
    expect(decodeOAuthRelayState(outerState)).toEqual({ returnTo, innerState: result.state });
  });

  it('without a relay, flows use the callback directly as the Slack redirect', async () => {
    delete process.env.OTTO_OAUTH_RELAY_URL;
    const result = await credManager.prepareOAuth(createSlackSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(result.redirectUri).toBe('http://localhost:6477/callback');
    expect(isOAuthRelayState(result.state)).toBe(false);
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:6477/callback');
    expect(authUrl.searchParams.get('state')).toBe(result.state);
  });
});
