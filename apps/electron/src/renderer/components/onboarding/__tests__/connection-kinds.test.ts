import { describe, expect, it } from 'bun:test'
import { connectionKindName, isHttpUrl, keySetup, OFFERED_KINDS, uniqueSlug, type KeyFormValues } from '../connection-kinds'

describe('connection kinds', () => {
  it('offers only OpenAI and Anthropic API-key families without subscriptions', () => {
    expect(OFFERED_KINDS).toEqual(['openai', 'anthropic'])
    expect(OFFERED_KINDS.map(connectionKindName)).toEqual(['OpenAI', 'Anthropic'])
    expect(connectionKindName('custom')).toBe('OpenAI')
  })

  it('picks a slug no visible connection has', () => {
    expect(uniqueSlug('openai', new Set())).toBe('openai')
    expect(uniqueSlug('openai', new Set(['openai']))).toBe('openai-2')
    expect(uniqueSlug('openai', new Set(['openai', 'openai-2']))).toBe('openai-3')
  })

  it('recognizes valid saved endpoint addresses', () => {
    expect(isHttpUrl('https://api.example.com/v1')).toBe(true)
    expect(isHttpUrl(' http://localhost:11434/v1 ')).toBe(true)
    expect(isHttpUrl('localhost:11434')).toBe(false)
    expect(isHttpUrl('ftp://x.test')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('keySetup', () => {
  const values: KeyFormValues = { apiKey: ' fixture-key ', scope: 'user' }

  it('builds native key test and setup payloads with a trimmed credential', () => {
    expect(keySetup('openai', values, { slug: 'openai', title: 'OpenAI' })).toEqual({
      test: { type: 'openai', apiKey: 'fixture-key', baseUrl: 'https://api.openai.com/v1', customEndpoint: { api: 'openai-responses' } },
      setup: { slug: 'openai', type: 'openai', title: 'OpenAI', scope: 'user', credential: 'fixture-key', baseUrl: 'https://api.openai.com/v1', customEndpoint: { api: 'openai-responses' } },
    })
  })

  it('preserves the workspace scope an owner requests', () => {
    const { setup } = keySetup('openai', { ...values, scope: 'workspace' }, { slug: 'openai-2', title: 'OpenAI' })
    expect(setup).toEqual({ slug: 'openai-2', type: 'openai', title: 'OpenAI', scope: 'workspace', credential: 'fixture-key', baseUrl: 'https://api.openai.com/v1', customEndpoint: { api: 'openai-responses' } })
  })

  it('uses the native Anthropic API-key type without CLI or subscription auth', () => {
    expect(keySetup('anthropic', values, { slug: 'anthropic', title: 'Anthropic' })).toEqual({
      test: { type: 'anthropic', apiKey: 'fixture-key', baseUrl: 'https://api.anthropic.com/v1', customEndpoint: { api: 'anthropic-messages' } },
      setup: { slug: 'anthropic', type: 'anthropic', title: 'Anthropic', scope: 'user', credential: 'fixture-key', baseUrl: 'https://api.anthropic.com/v1', customEndpoint: { api: 'anthropic-messages' } },
    })
  })

  for (const api of ['openai-responses', 'openai-completions'] as const) {
    it(`tests and saves the same custom ${api} URL, model, credential, and scope`, () => {
      expect(keySetup('custom', { ...values, scope: 'workspace', baseUrl: ' https://api.example.com/v1 ', api, model: ' gpt-6-luna ' }, { slug: 'custom-2', title: 'Custom endpoint' })).toEqual({
        test: { type: 'openai', apiKey: 'fixture-key', baseUrl: 'https://api.example.com/v1', customEndpoint: { api }, model: 'gpt-6-luna' },
        setup: { slug: 'custom-2', type: 'openai', title: 'Custom endpoint', scope: 'workspace', credential: 'fixture-key', baseUrl: 'https://api.example.com/v1', customEndpoint: { api }, defaultModel: 'gpt-6-luna' },
      })
    })
  }

  it('defaults a new custom endpoint to Responses and leaves an empty model to discovery', () => {
    expect(keySetup('custom', { ...values, baseUrl: 'https://api.example.com/v1', model: ' ' }, { slug: 'custom', title: 'Custom endpoint' })).toEqual({
      test: { type: 'openai', apiKey: 'fixture-key', baseUrl: 'https://api.example.com/v1', customEndpoint: { api: 'openai-responses' } },
      setup: { slug: 'custom', type: 'openai', title: 'Custom endpoint', scope: 'user', credential: 'fixture-key', baseUrl: 'https://api.example.com/v1', customEndpoint: { api: 'openai-responses' } },
    })
  })

  for (const api of ['openai-responses', 'openai-completions'] as const) {
    it(`preserves explicit native OpenAI endpoint, ${api}, model and fixed scope in test/save`, () => {
      const { test, setup } = keySetup('openai', { ...values, scope: 'workspace', baseUrl: ' https://native.example/v1 ', api, model: ' model-id ' }, { slug: 'openai-2', title: 'OpenAI' })
      expect(test).toEqual({ type: 'openai', apiKey: 'fixture-key', baseUrl: 'https://native.example/v1', customEndpoint: { api }, model: 'model-id' })
      expect(setup).toEqual({ slug: 'openai-2', type: 'openai', title: 'OpenAI', scope: 'workspace', credential: 'fixture-key', baseUrl: 'https://native.example/v1', customEndpoint: { api }, defaultModel: 'model-id' })
    })
  }

  it('keeps the native Anthropic base URL and never forwards an OpenAI protocol', () => {
    const { test, setup } = keySetup('anthropic', { ...values, baseUrl: ' https://anthropic.example ', api: 'openai-completions' }, { slug: 'anthropic', title: 'Anthropic' })
    expect(test).toEqual({ type: 'anthropic', apiKey: 'fixture-key', baseUrl: 'https://anthropic.example', customEndpoint: { api: 'anthropic-messages' } })
    expect(setup.baseUrl).toBe('https://anthropic.example')
    expect(setup.customEndpoint).toEqual({ api: 'anthropic-messages' })
  })
})
