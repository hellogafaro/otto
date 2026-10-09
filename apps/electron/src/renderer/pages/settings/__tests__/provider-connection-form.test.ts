import { describe, expect, it } from 'bun:test'
import type { LlmConnectionWithStatus } from '../../../../shared/types'
import { keySetup } from '../../../components/onboarding/connection-kinds'
import { bindAddScope, connectionChoiceId, connectionSelector, endpointOrigin, endpointSetup, needsStoredKeyConsent, PROVIDER_FAMILIES, providerFamily, providerFormDefaults } from '../provider-connection-form'

const custom: LlmConnectionWithStatus = {
  id: 'fixture-custom-id', updatedAt: 123, slug: 'existing-custom', name: 'Existing', type: 'custom', scope: 'workspace:fixture', authType: 'api_key',
  baseUrl: 'https://endpoint.example/v1', customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture-model',
  createdAt: 1, isAuthenticated: true, isDefault: true,
}

describe('provider connection form', () => {
  it('offers only the OpenAI and Anthropic families in the grouped Add dialog', () => {
    expect(PROVIDER_FAMILIES).toEqual(['openai', 'anthropic'])
  })
  it('restores custom records as the OpenAI family without rewriting identity, scope, endpoint, protocol, or default', () => {
    const snapshot = structuredClone(custom)
    expect(providerFamily(custom)).toBe('openai')
    expect(providerFormDefaults('openai', custom)).toEqual({ apiKey: '', baseUrl: 'https://endpoint.example/v1', api: 'openai-completions', model: 'fixture-model' })
    expect(custom).toEqual(snapshot)
  })

  it('does not offer unsupported records as an executable provider family', () => {
    expect(providerFamily({ type: 'openai-codex' })).toBeNull()
    expect(providerFamily({ type: 'claude-code' })).toBeNull()
    expect(providerFamily({ type: 'anthropic' })).toBe('anthropic')
  })

  it('restores native defaults with an empty key and preserves unknown legacy custom protocols', () => {
    expect(providerFormDefaults('anthropic')).toEqual({ apiKey: '', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages', model: '' })
    expect(providerFormDefaults('openai').api).toBe('openai-responses')
    expect(providerFormDefaults('openai', { ...custom, customEndpoint: { api: 'anthropic-messages' } }).api).toBe('anthropic-messages')
  })

  it('binds each Add to its initiating group even if values claim another scope', () => {
    const values = { apiKey: 'fixture-key', scope: 'user' as const }
    const workspace = bindAddScope(values, 'workspace')
    expect(keySetup('openai', workspace, { slug: 'new', title: 'OpenAI' }).setup.scope).toBe('workspace')
    expect(bindAddScope(workspace, 'user').scope).toBe('user')
    expect(values.scope).toBe('user')
  })

  it('requires stored-key consent for a new origin, including scheme or port changes', () => {
    expect(needsStoredKeyConsent(custom, 'https://endpoint.example/v2', '')).toBe(false)
    expect(needsStoredKeyConsent(custom, 'https://new.example/v1', '')).toBe(true)
    expect(needsStoredKeyConsent(custom, 'http://endpoint.example/v1', '')).toBe(true)
    expect(needsStoredKeyConsent(custom, 'https://endpoint.example:8443/v1', '')).toBe(true)
    expect(needsStoredKeyConsent(custom, 'https://new.example/v1', 'replacement-fixture')).toBe(false)
    expect(needsStoredKeyConsent({ type: 'anthropic' }, 'https://api.anthropic.com/v1', '')).toBe(false)
  })

  it('rejects endpoints with credentials, fragments, or non-HTTP protocols', () => {
    expect(endpointOrigin(' https://Endpoint.Example:443/v1 ')).toBe('https://endpoint.example')
    for (const value of ['https://user:password@example.test/v1', 'https://example.test/#fragment', 'https://example.test/v1?query=1', 'file:///tmp', 'not a URL']) expect(endpointOrigin(value)).toBeNull()
  })
  it('keeps same-slug choices distinct and binds mutations to immutable identity and last-seen version', () => {
    expect(connectionChoiceId(custom)).not.toBe(connectionChoiceId({ ...custom, id: 'other-scope-id', scope: 'user:fixture' }))
    expect(connectionSelector(custom)).toEqual({ slug: custom.slug, connectionId: custom.id, scope: 'workspace', expectedUpdatedAt: 123 })
    expect(() => connectionSelector({ ...custom, id: undefined })).toThrow('saved identity')
  })
  it('will not build stored-key payloads without exact identity and approval of the exact new origin', () => {
    const values = { apiKey: '', api: 'openai-completions', baseUrl: 'https://new.example/v1', approvedCredentialOrigin: '' }
    expect(() => endpointSetup(custom, values)).toThrow('Approve')
    expect(() => endpointSetup({ ...custom, id: undefined }, { ...values, approvedCredentialOrigin: 'https://new.example' })).toThrow('Reload')
    expect(() => endpointSetup(custom, { ...values, approvedCredentialOrigin: 'https://new.example/' })).toThrow('Approve')
    const { test, setup } = endpointSetup({ ...custom, customEndpoint: { api: 'openai-completions', supportsImages: true } }, { ...values, approvedCredentialOrigin: 'https://new.example' })
    expect(test).toMatchObject({ connectionId: custom.id, expectedUpdatedAt: 123, scope: 'workspace', type: 'openai', approvedCredentialOrigin: 'https://new.example', customEndpoint: { supportsImages: true } })
    expect(setup).toMatchObject({ connectionId: custom.id, updateOnly: true, type: 'openai', scope: 'workspace', approvedCredentialOrigin: 'https://new.example' })
    expect('apiKey' in test).toBe(false)
    expect('credential' in setup).toBe(false)
    const cleared = endpointSetup(custom, { ...values, baseUrl: custom.baseUrl!, model: '' })
    expect(cleared.test.model).toBe('')
    expect(cleared.setup.defaultModel).toBeNull()
  })
})
