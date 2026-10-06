import { describe, expect, it } from 'bun:test'
import { isHttpUrl, isLoopbackUrl, keySetup, OFFERED_KINDS, parseModelList, typeOfKind, uniqueSlug, type KeyFormValues } from '../connection-kinds'

describe('connection kinds', () => {
  it('offers the five connections in order, and never Copilot as new', () => {
    expect(OFFERED_KINDS).toEqual(['claude-code', 'anthropic', 'openai-codex', 'provider', 'custom'])
  })

  it('names the Pi provider id of each kind', () => {
    expect(typeOfKind('claude-code')).toBe('claude-code')
    expect(typeOfKind('anthropic')).toBe('anthropic')
    expect(typeOfKind('openai-codex')).toBe('openai-codex')
    expect(typeOfKind('provider', 'openrouter')).toBe('openrouter')
    expect(typeOfKind('custom')).toBe('custom')
  })

  it('picks a slug no visible connection has', () => {
    expect(uniqueSlug('anthropic', new Set())).toBe('anthropic')
    expect(uniqueSlug('anthropic', new Set(['anthropic']))).toBe('anthropic-2')
    expect(uniqueSlug('anthropic', new Set(['anthropic', 'anthropic-2']))).toBe('anthropic-3')
  })
})

describe('custom endpoint fields', () => {
  it('parses the typed model list', () => {
    expect(parseModelList('qwen3-coder, llama3.3,\n qwen3-coder , ')).toEqual(['qwen3-coder', 'llama3.3'])
    expect(parseModelList('  ')).toEqual([])
  })

  it('recognizes http urls and this machine', () => {
    expect(isHttpUrl('https://api.example.com/v1')).toBe(true)
    expect(isHttpUrl('localhost:11434')).toBe(false)
    expect(isHttpUrl('ftp://x.test')).toBe(false)
    expect(isLoopbackUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8080')).toBe(true)
    expect(isLoopbackUrl('https://api.example.com')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })

})

describe('keySetup', () => {
  const values: KeyFormValues = { provider: 'openrouter', name: 'Ollama', baseUrl: ' http://localhost:11434/v1 ', api: 'openai-completions', apiKey: '', models: 'llama3.3, qwen3-coder', scope: 'user' }

  it('builds the test and setup of an Anthropic API key', () => {
    expect(keySetup('anthropic', { ...values, apiKey: ' sk-ant-1 ' }, { slug: 'anthropic', title: 'Anthropic API' })).toEqual({
      test: { type: 'anthropic', apiKey: 'sk-ant-1' },
      setup: { slug: 'anthropic', type: 'anthropic', title: 'Anthropic API', scope: 'user', credential: 'sk-ant-1' },
    })
  })

  it("builds a provider's key with the provider the person picked, shared when an owner asks", () => {
    const { test, setup } = keySetup('provider', { ...values, apiKey: 'sk-or-1', scope: 'workspace' }, { slug: 'openrouter', title: 'OpenRouter' })
    expect(test).toEqual({ type: 'openrouter', apiKey: 'sk-or-1' })
    expect(setup).toMatchObject({ type: 'openrouter', scope: 'workspace', credential: 'sk-or-1' })
  })

  it('builds a custom endpoint with no credential for a local server and its first model as the default', () => {
    const { test, setup } = keySetup('custom', values, { slug: 'custom', title: 'Ollama' })
    expect(test).toEqual({ type: 'custom', apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'llama3.3', customEndpoint: { api: 'openai-completions' } })
    expect(setup).toEqual({
      slug: 'custom', type: 'custom', title: 'Ollama', scope: 'user', baseUrl: 'http://localhost:11434/v1',
      customEndpoint: { api: 'openai-completions' }, models: ['llama3.3', 'qwen3-coder'], defaultModel: 'llama3.3',
    })
    expect(keySetup('custom', { ...values, apiKey: ' k ' }, { slug: 'custom', title: 'Ollama' }).setup.credential).toBe('k')
  })
})
