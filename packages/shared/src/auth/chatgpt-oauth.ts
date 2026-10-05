/**
 * ChatGPT sign-in (the Codex client) by device code.
 *
 * Works the same in the desktop app, the browser and over a remote server, with
 * no callback server or localhost redirect: the server asks OpenAI for a code,
 * the person enters it at the verification page on any device, and the server
 * polls until OpenAI hands back an authorization code to exchange.
 *
 *   - requestChatGptDeviceCode() — get the user code and verification URL
 *   - pollChatGptDeviceAuth() — wait for approval, then exchange for tokens
 *   - refreshChatGptTokens() — refresh expired tokens
 *   - exchangeIdTokenForApiKey() — converts idToken to OpenAI API key
 */
import { CHATGPT_OAUTH_CONFIG } from './chatgpt-oauth-config.ts';

// OAuth configuration from shared config
const CLIENT_ID = CHATGPT_OAUTH_CONFIG.CLIENT_ID;
const TOKEN_URL = CHATGPT_OAUTH_CONFIG.TOKEN_URL;
const ISSUER = CHATGPT_OAUTH_CONFIG.ISSUER;
const DEVICE_USERCODE_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URL = `${ISSUER}/codex/device`;
const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;

export interface ChatGptTokens {
  /** JWT id_token containing user identity claims */
  idToken: string;
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for getting new tokens */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms) */
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Device code flow
// ---------------------------------------------------------------------------

export interface ChatGptDeviceCode {
  deviceAuthId: string;
  /** The code the person types at the verification page */
  userCode: string;
  verificationUri: string;
  /** Poll interval in ms */
  intervalMs: number;
  /** Unix ms when the code stops working */
  expiresAt: number;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Ask OpenAI for a device code. */
export async function requestChatGptDeviceCode(signal?: AbortSignal): Promise<ChatGptDeviceCode> {
  const response = await postJson(DEVICE_USERCODE_URL, { client_id: CLIENT_ID }, signal);
  if (!response.ok) {
    throw new Error(`Could not start ChatGPT sign-in (${response.status})`);
  }
  const data = (await response.json()) as {
    device_auth_id: string;
    user_code?: string;
    usercode?: string;
    interval?: string | number;
    expires_at?: string;
  };
  const userCode = data.user_code ?? data.usercode;
  if (!data.device_auth_id || !userCode) throw new Error('Unexpected response starting ChatGPT sign-in');
  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 15 * 60 * 1000;
  return {
    deviceAuthId: data.device_auth_id,
    userCode,
    verificationUri: DEVICE_VERIFICATION_URL,
    intervalMs: Math.max(1, Number(data.interval) || 5) * 1000,
    expiresAt,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    }, { once: true });
  });
}

/**
 * Wait until the code is approved, then exchange it for ChatGPT tokens.
 * Resolves with tokens; rejects when the code expires, is denied or aborted.
 */
export async function pollChatGptDeviceAuth(
  code: ChatGptDeviceCode,
  signal?: AbortSignal,
): Promise<ChatGptTokens> {
  while (Date.now() < code.expiresAt) {
    await sleep(code.intervalMs, signal);
    const response = await postJson(
      DEVICE_TOKEN_URL,
      { device_auth_id: code.deviceAuthId, user_code: code.userCode },
      signal,
    );
    // Not approved yet
    if (response.status === 403 || response.status === 404) continue;
    if (!response.ok) throw new Error(`ChatGPT sign-in failed (${response.status})`);
    const grant = (await response.json()) as { authorization_code: string; code_verifier: string };
    return exchangeAuthorizationCode(grant.authorization_code, grant.code_verifier, signal);
  }
  throw new Error('The ChatGPT sign-in code expired');
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  signal?: AbortSignal,
): Promise<ChatGptTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: DEVICE_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Refresh ChatGPT tokens using a refresh token
 *
 * @param refreshToken - The refresh token from a previous authentication
 * @param onStatus - Optional callback for status messages
 * @returns New ChatGptTokens
 */
export async function refreshChatGptTokens(
  refreshToken: string,
  onStatus?: (message: string) => void
): Promise<ChatGptTokens> {
  onStatus?.('Refreshing tokens...');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error_description || errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(`Token refresh failed: ${response.status} - ${errorMessage}`);
    }

    const data = (await response.json()) as {
      id_token: string;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    onStatus?.('Tokens refreshed successfully!');

    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      // Use new refresh token if provided, otherwise keep the old one
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Token refresh failed: ${String(error)}`);
  }
}

/**
 * Exchange an idToken for an OpenAI API key using the token-exchange grant.
 *
 * This implements RFC 8693 Token Exchange to convert a ChatGPT OAuth idToken
 * into a first-class OpenAI API key that can be used with the standard OpenAI SDK.
 *
 * @param idToken - The JWT id_token from ChatGPT OAuth
 * @returns An OpenAI API key string
 */
export async function exchangeIdTokenForApiKey(idToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: CLIENT_ID,
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token: 'openai-api-key',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      // Handle both string and object error formats
      const errorDesc = errorJson.error_description;
      const errorCode = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      errorMessage = errorDesc || errorCode || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error('Token exchange succeeded but no access_token returned');
  }

  return data.access_token;
}
