/**
 * Shared OAuth configuration for ChatGPT authentication
 *
 * This file is the single source of truth for all ChatGPT/OpenAI OAuth settings.
 * Used for the `chatgptAuthTokens` mode in Codex app-server.
 *
 * Note: These values are based on the OpenAI OAuth flow used by Codex CLI.
 * The client ID is the same one Codex uses for its browser-based OAuth.
 */

export const CHATGPT_OAUTH_CONFIG = {
  /**
   * OAuth Client ID for ChatGPT authentication
   * This is the official Codex CLI public client ID (registered with OpenAI)
   */
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',

  /**
   * Token URL - for exchanging codes and refreshing tokens
   */
  TOKEN_URL: 'https://auth.openai.com/oauth/token',

  /**
   * OAuth scopes requested during authentication
   * These scopes provide access to ChatGPT Plus features via Codex
   */
  SCOPES: 'openid profile email offline_access',

  /**
   * OpenID Connect issuer for token validation
   */
  ISSUER: 'https://auth.openai.com',

  /**
   * Audience for token validation
   */
  AUDIENCE: 'https://api.openai.com/v1',

  /**
   * Enable Codex CLI simplified flow (required for Codex compatibility)
   */
  SIMPLIFIED_FLOW: true,

  /**
   * Include organization info in ID token (required for Codex compatibility)
   */
  ADD_ORGANIZATIONS: true,
} as const;

export type ChatGptOAuthConfig = typeof CHATGPT_OAUTH_CONFIG;
