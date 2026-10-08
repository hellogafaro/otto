import { describe, expect, it } from 'bun:test'
import { isHttpUrl, keySetup, OFFERED_KINDS, uniqueSlug, type KeyFormValues } from '../connection-kinds'

describe('connection kinds', () => {
  it('offers only the native OpenAI API-key connection', () => {
    expect(OFFERED_KINDS).toEqual(['openai'])
  })

  it('picks a slug no visible connection has', () => {
    expect(uniqueSlug('openai', new Set())).toBe('openai')
    expect(uniqueSlug('openai', new Set(['openai']))).toBe('openai-2')
    expect(uniqueSlug('openai', new Set(['openai', 'openai-2']))).toBe('openai-3')
  })

  it('recognizes valid saved endpoint addresses', () => {
    expect(isHttpUrl('https://api.example.com/v1')).toBe(true)
    expect(isHttpUrl('localhost:11434')).toBe(false)
    expect(isHttpUrl('ftp://x.test')).toBe(false)
  })
})

describe('keySetup', () => {
  const values: KeyFormValues = { apiKey: ' fixture-key ', scope: 'user' }

  it('builds native key test and setup payloads with a trimmed credential', () => {
    expect(keySetup('openai', values, { slug: 'openai', title: 'OpenAI' })).toEqual({
      test: { type: 'openai', apiKey: 'fixture-key' },
      setup: { slug: 'openai', type: 'openai', title: 'OpenAI', scope: 'user', credential: 'fixture-key' },
    })
  })

  it('preserves the workspace scope an owner requests', () => {
    const { setup } = keySetup('openai', { ...values, scope: 'workspace' }, { slug: 'openai-2', title: 'OpenAI' })
    expect(setup).toEqual({ slug: 'openai-2', type: 'openai', title: 'OpenAI', scope: 'workspace', credential: 'fixture-key' })
  })
})
