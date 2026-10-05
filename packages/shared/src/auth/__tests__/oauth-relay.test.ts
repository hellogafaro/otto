import { afterEach, describe, expect, it } from 'bun:test';

import {
  getOAuthRelayCallbackUrl,
  getOAuthRelayUrl,
  decodeOAuthRelayState,
  encodeOAuthRelayState,
  isOAuthRelayState,
  wrapPreparedOAuthFlowForRelay,
} from '../oauth-relay.ts';
import type { PreparedOAuthFlow } from '../oauth-flow-types.ts';

describe('oauth relay state', () => {
  it('round-trips the relay callback target and inner state', () => {
    const encoded = encodeOAuthRelayState(
      'https://otto.example.com/api/oauth/callback',
      'inner-state-123',
    );

    expect(isOAuthRelayState(encoded)).toBe(true);
    expect(decodeOAuthRelayState(encoded)).toEqual({
      returnTo: 'https://otto.example.com/api/oauth/callback',
      innerState: 'inner-state-123',
    });
  });

  it('rejects malformed relay state', () => {
    expect(() => decodeOAuthRelayState('ca1.not-valid-base64')).toThrow('Invalid OAuth relay state');
  });
});

const RELAY_CALLBACK_URL = 'https://relay.test/auth/callback';

afterEach(() => {
  delete process.env.OTTO_OAUTH_RELAY_URL;
});

describe('getOAuthRelayUrl', () => {
  it('is undefined when OTTO_OAUTH_RELAY_URL is unset or blank', () => {
    delete process.env.OTTO_OAUTH_RELAY_URL;
    expect(getOAuthRelayUrl()).toBeUndefined();
    expect(getOAuthRelayCallbackUrl()).toBeUndefined();
    process.env.OTTO_OAUTH_RELAY_URL = '  ';
    expect(getOAuthRelayCallbackUrl()).toBeUndefined();
  });

  it('derives the callback URL from the configured base', () => {
    process.env.OTTO_OAUTH_RELAY_URL = 'https://relay.test/';
    expect(getOAuthRelayUrl()).toBe('https://relay.test');
    expect(getOAuthRelayCallbackUrl()).toBe(RELAY_CALLBACK_URL);
  });
});

describe('wrapPreparedOAuthFlowForRelay', () => {
  it('keeps the inner flow state but rewrites auth URL state and redirect_uri', () => {
    const prepared: PreparedOAuthFlow = {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client&redirect_uri=https%3A%2F%2Fold.example%2Fcallback&response_type=code&state=inner-state-123',
      state: 'inner-state-123',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'https://old.example/callback',
      provider: 'google',
    };

    const wrapped = wrapPreparedOAuthFlowForRelay(
      prepared,
      'https://otto.example.com/api/oauth/callback',
      RELAY_CALLBACK_URL,
    );

    expect(wrapped.state).toBe('inner-state-123');
    expect(wrapped.redirectUri).toBe(RELAY_CALLBACK_URL);

    const authUrl = new URL(wrapped.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(RELAY_CALLBACK_URL);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(outerState).not.toBe('inner-state-123');
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: 'https://otto.example.com/api/oauth/callback',
      innerState: 'inner-state-123',
    });
  });
});
