import { describe, expect, it } from 'bun:test'
import {
  isLoopbackBaseUrl,
  setupTestRequiresApiKey,
  resolveCustomEndpointSetup,
  resolveSetupAuthType,
  createConnectionForSetup,
} from './connection-setup-logic'

describe('setup test API key requirements', () => {
  it('detects loopback base URLs', () => {
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('requires API key for non-loopback setup tests', () => {
    expect(setupTestRequiresApiKey('https://api.anthropic.com')).toBe(true)
    expect(setupTestRequiresApiKey('https://example.com/v1')).toBe(true)
  })

  it('allows keyless setup tests for loopback endpoints', () => {
    expect(setupTestRequiresApiKey('http://localhost:11434/v1')).toBe(false)
    expect(setupTestRequiresApiKey('http://127.0.0.1:11434/v1')).toBe(false)
  })
})

describe('resolveCustomEndpointSetup', () => {
  it('treats loopback URL with no credential as keyless local model', () => {
    expect(resolveCustomEndpointSetup({ baseUrl: 'http://localhost:11434/v1', credential: undefined })).toBe('none')
  })

  it('treats loopback URL *with* a credential as a keyed custom endpoint (#636)', () => {
    // Real-world case: vLLM, LiteLLM, or any local OpenAI-compat server with --api-key.
    expect(resolveCustomEndpointSetup({ baseUrl: 'http://127.0.0.1:11111/v1', credential: 'sk-local-test' })).toBe('api_key_with_endpoint')
  })

  it('treats remote endpoints, with or without a credential, as keyed', () => {
    expect(resolveCustomEndpointSetup({ baseUrl: 'https://api.example.com/v1', credential: 'sk-remote' })).toBe('api_key_with_endpoint')
    // Non-loopback URLs are never assumed keyless; setup validation handles the missing key separately.
    expect(resolveCustomEndpointSetup({ baseUrl: 'https://api.example.com/v1', credential: undefined })).toBe('api_key_with_endpoint')
  })

  it('treats undefined baseUrl as a non-loopback (keyed) endpoint', () => {
    expect(resolveCustomEndpointSetup({ baseUrl: undefined, credential: 'sk-anything' })).toBe('api_key_with_endpoint')
  })
})

describe('resolveSetupAuthType', () => {
  it('signs a Claude subscription in through the CLI, ChatGPT and Copilot with a device code, the rest with a key', () => {
    expect(resolveSetupAuthType({ type: 'claude-code' })).toBe('cli_login')
    expect(resolveSetupAuthType({ type: 'openai-codex' })).toBe('oauth')
    expect(resolveSetupAuthType({ type: 'github-copilot' })).toBe('oauth')
    expect(resolveSetupAuthType({ type: 'anthropic' })).toBe('api_key')
    expect(resolveSetupAuthType({ type: 'openrouter' })).toBe('api_key')
  })

  it('follows the base URL and key of a custom endpoint, and the method of Bedrock', () => {
    expect(resolveSetupAuthType({ type: 'custom', baseUrl: 'http://localhost:11434/v1' })).toBe('none')
    expect(resolveSetupAuthType({ type: 'custom', baseUrl: 'https://x.test/v1', credential: 'k' })).toBe('api_key_with_endpoint')
    expect(resolveSetupAuthType({ type: 'amazon-bedrock' })).toBe('iam_credentials')
    expect(resolveSetupAuthType({ type: 'amazon-bedrock', bedrockAuthMethod: 'environment' })).toBe('environment')
  })
})

// New connections must persist a midStreamBehavior default so the per-connection
// submenu in Settings → AI shows a checkmark on the right item out of the box.
describe('createConnectionForSetup', () => {
  const make = (type: string, authType: Parameters<typeof createConnectionForSetup>[0]['authType']) =>
    createConnectionForSetup({ slug: type, type, title: 'T', authType })

  it("a Claude subscription is the claude-code provider, 'steer', with the Claude models and no secret", () => {
    const conn = make('claude-code', 'cli_login')
    expect(conn).toMatchObject({ type: 'claude-code', authType: 'cli_login', name: 'T', midStreamBehavior: 'steer' })
  })

  it('an Anthropic API key and ChatGPT are their Pi providers', () => {
    expect(make('anthropic', 'api_key')).toMatchObject({ type: 'anthropic', authType: 'api_key', midStreamBehavior: 'steer' })
    expect(make('openai-codex', 'oauth')).toMatchObject({ type: 'openai-codex', midStreamBehavior: 'steer' })
  })

  it('a custom endpoint lists no models of its own', () => {
    const conn = make('custom', 'api_key_with_endpoint')
    expect(conn.models).toEqual([])
    expect(conn.defaultModel).toBe('')
    expect(conn.midStreamBehavior).toBe('steer')
  })
})
