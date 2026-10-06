/**
 * Connection Setup Logic
 *
 * Pure functions extracted from ipc.ts for testability.
 * No dependency on ipcMain, sessionManager, credential manager, or file I/O.
 */

import type { ModelDefinition } from '@otto/shared/config/models'
import {
  type LlmAuthType,
  type LlmConnection,
  CLAUDE_CODE_CONNECTION_TYPE,
  CUSTOM_CONNECTION_TYPE,
  defaultMidStreamBehavior,
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
} from '@otto/shared/config'

// ============================================================
// Error Parsing
// ============================================================

/**
 * Parse an error message from a connection test into a user-friendly string.
 */
export function parseTestConnectionError(msg: string): string {
  const lower = msg.toLowerCase()

  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.'
  }
  if (lower.includes('no api key found for')) {
    return 'The key does not match the provider. Choose the provider the key is for, or use a custom endpoint.'
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Invalid API key'
  }
  if (lower.includes('404') && lower.includes('model')) {
    return 'Model not found. Check the model name and try again.'
  }
  if (lower.includes('404')) {
    return 'API endpoint not found. Check the URL.'
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again.'
  }
  if (lower.includes('403')) {
    return 'API key does not have permission to access this resource'
  }

  return msg.slice(0, 300)
}

/**
 * Returns true when a URL points to local loopback.
 * Used to permit keyless setup tests for local model runtimes (e.g. Ollama).
 */
export function isLoopbackBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1'
  } catch {
    return false
  }
}

/**
 * Setup tests require API keys for non-local endpoints, but local loopback
 * endpoints may be keyless.
 */
export function setupTestRequiresApiKey(baseUrl?: string): boolean {
  return !isLoopbackBaseUrl(baseUrl)
}

/**
 * Decide how a custom OpenAI/Anthropic-compatible endpoint should be persisted.
 *
 * - Loopback URL with no credential: a keyless local model (Ollama, LM Studio).
 * - Loopback URL *with* a credential: a real local OpenAI-compatible server (vLLM, LiteLLM, etc.); it is keyed
 *   like a remote endpoint, otherwise the agent has no credential at runtime and requests fail with 401 (#636).
 * - Remote URL: always keyed.
 */
export function resolveCustomEndpointSetup(input: {
  baseUrl: string | undefined
  credential: string | undefined
}): Extract<LlmAuthType, 'none' | 'api_key_with_endpoint'> {
  return isLoopbackBaseUrl(input.baseUrl) && !input.credential ? 'none' : 'api_key_with_endpoint'
}

// ============================================================
// Connection Creation
// ============================================================

/**
 * The auth type a new connection of this type is made with: a Claude subscription signs in through the user's own
 * `claude` (no secret), ChatGPT and GitHub Copilot sign in with a device code, a custom endpoint is keyed unless it
 * is a keyless loopback server, Amazon Bedrock follows its auth method, every other provider takes an API key.
 */
export function resolveSetupAuthType(setup: {
  type: string
  baseUrl?: string | null
  credential?: string | null
  bedrockAuthMethod?: 'iam_credentials' | 'environment'
}): LlmAuthType {
  switch (setup.type) {
    case CLAUDE_CODE_CONNECTION_TYPE:
      return 'cli_login'
    case 'openai-codex':
    case 'github-copilot':
      return 'oauth'
    case CUSTOM_CONNECTION_TYPE:
      return resolveCustomEndpointSetup({ baseUrl: setup.baseUrl ?? undefined, credential: setup.credential ?? undefined })
    case 'amazon-bedrock':
      return setup.bedrockAuthMethod ?? 'iam_credentials'
    default:
      return 'api_key'
  }
}

/** A new connection from a setup: its type and name, the models its provider lists (a custom endpoint lists its own). */
export function createConnectionForSetup(setup: {
  slug: string
  type: string
  title: string
  authType: LlmAuthType
}): LlmConnection {
  return {
    slug: setup.slug,
    name: setup.title,
    type: setup.type,
    authType: setup.authType,
    models: getDefaultModelsForConnection(setup.type),
    defaultModel: getDefaultModelForConnection(setup.type),
    modelSelectionMode: setup.type === CUSTOM_CONNECTION_TYPE ? undefined : 'automaticallySyncedFromProvider',
    midStreamBehavior: defaultMidStreamBehavior(),
    createdAt: Date.now(),
  }
}

// ============================================================
// Model Validation
// ============================================================

/**
 * Validate that the default model exists in the provided model list.
 * Handles both string and ModelDefinition model entries.
 *
 * This was extracted from inline logic in the setupLlmConnection IPC handler
 * to fix a bug where Array.includes() compared strings against ModelDefinition
 * objects, always returning false for Pi connections.
 */
export function validateModelList(
  models: Array<ModelDefinition | string>,
  defaultModel: string | undefined,
): { valid: boolean; error?: string; resolvedDefaultModel?: string } {
  if (!models || models.length === 0) {
    return { valid: true }
  }

  const modelIds = models.map(m => typeof m === 'string' ? m : m.id)

  if (defaultModel && !modelIds.includes(defaultModel)) {
    return {
      valid: false,
      error: `Default model "${defaultModel}" is not in the provided model list.`,
    }
  }

  if (!defaultModel) {
    const firstModel = models[0]
    const firstModelId = typeof firstModel === 'string' ? firstModel : firstModel!.id
    return {
      valid: true,
      resolvedDefaultModel: firstModelId,
    }
  }

  return { valid: true }
}
