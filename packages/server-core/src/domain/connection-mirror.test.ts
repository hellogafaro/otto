import { describe, expect, it } from 'bun:test'
import { connectionTypeFor, readConnectionSecret } from './connection-mirror'

const c = (over: Record<string, unknown>) =>
  ({ providerType: 'pi', authType: 'api_key', ...over }) as Parameters<typeof connectionTypeFor>[0]

describe('connectionTypeFor', () => {
  it('maps the subscription sign-ins', () => {
    expect(connectionTypeFor(c({ providerType: 'anthropic', authType: 'oauth' }))).toBe('claude')
    expect(connectionTypeFor(c({ authType: 'oauth', piAuthProvider: 'openai-codex' }))).toBe('chatgpt')
    expect(connectionTypeFor(c({ authType: 'oauth', piAuthProvider: 'github-copilot' }))).toBe('copilot')
  })
  it('maps the API-key providers', () => {
    expect(connectionTypeFor(c({ providerType: 'anthropic' }))).toBe('anthropic')
    expect(connectionTypeFor(c({ piAuthProvider: 'openai' }))).toBe('openai')
    expect(connectionTypeFor(c({ piAuthProvider: 'openrouter' }))).toBe('openrouter')
  })
  it('maps loopback endpoints to ollama and everything else to custom', () => {
    expect(connectionTypeFor(c({ providerType: 'pi_compat', baseUrl: 'http://localhost:11434' }))).toBe('ollama')
    expect(connectionTypeFor(c({ providerType: 'pi_compat', baseUrl: 'https://my.host/v1' }))).toBe('custom')
    expect(connectionTypeFor(c({ piAuthProvider: 'google' }))).toBe('custom')
  })
})

describe('readConnectionSecret', () => {
  const manager = {
    getLlmOAuth: async () => ({ accessToken: 'a', refreshToken: 'r' }),
    getLlmApiKey: async () => 'sk-1',
    getLlmIamCredentials: async () => ({ accessKeyId: 'k', secretAccessKey: 's' }),
    getLlmServiceAccount: async () => null,
  } as never
  it('reads each auth type from the credential manager', async () => {
    expect(await readConnectionSecret({ slug: 's', authType: 'api_key' }, manager)).toBe('sk-1')
    expect(JSON.parse((await readConnectionSecret({ slug: 's', authType: 'oauth' }, manager))!).accessToken).toBe('a')
    expect(JSON.parse((await readConnectionSecret({ slug: 's', authType: 'iam_credentials' }, manager))!).accessKeyId).toBe('k')
    expect(await readConnectionSecret({ slug: 's', authType: 'service_account_file' }, manager)).toBeUndefined()
    expect(await readConnectionSecret({ slug: 's', authType: 'none' }, manager)).toBeUndefined()
  })
})
