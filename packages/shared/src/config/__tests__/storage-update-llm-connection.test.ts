import { afterEach, describe, expect, it } from 'bun:test'
import { getConnections, deleteConnection } from '../../connections/index.ts'
import {
  addLlmConnection,
  deleteLlmConnection,
  getDefaultLlmConnection,
  getLlmConnection,
  getLlmConnections,
  setDefaultLlmConnection,
  updateLlmConnection,
  type LlmConnection,
} from '../storage.ts'

// The wrappers over the connections domain, on the throwaway database of the test preload.

afterEach(() => {
  for (const connection of getConnections()) deleteConnection(connection.id)
})

function makeConnection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    slug: 'custom-compat',
    name: 'My Custom Endpoint',
    type: 'custom',
    authType: 'api_key_with_endpoint',
    createdAt: Date.now(),
    baseUrl: 'http://localhost:8085',
    ...overrides,
  }
}

describe('add, get, delete', () => {
  it('round-trips every field of a connection through the domain', () => {
    const connection = makeConnection({
      models: ['m1', { id: 'm2', name: 'Two' } as never],
      defaultModel: 'm1',
      modelSelectionMode: 'userDefined3Tier',
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      midStreamBehavior: 'queue',
      createdAt: 1000,
    })
    expect(addLlmConnection(connection)).toBe(true)
    expect(getLlmConnection('custom-compat')).toEqual({ ...connection, scope: 'install' })
    expect(getLlmConnections().map((c) => c.slug)).toEqual(['custom-compat'])
    // the row names its Pi provider
    expect(getConnections()[0]).toMatchObject({ type: 'custom', authType: 'api_key_with_endpoint' })
  })

  it('stores the Pi provider id as the type: a Claude subscription is claude-code with no secret', () => {
    addLlmConnection(makeConnection({ slug: 'codex', type: 'openai-codex', authType: 'oauth', baseUrl: undefined }))
    addLlmConnection(makeConnection({ slug: 'claude', type: 'claude-code', authType: 'cli_login', baseUrl: undefined }))
    expect(getConnections().map((c) => [c.slug, c.type, c.authType])).toEqual([['codex', 'openai-codex', 'oauth'], ['claude', 'claude-code', 'cli_login']])
    expect(getLlmConnection('claude')).toMatchObject({ type: 'claude-code', authType: 'cli_login' })
  })

  it('refuses a second connection with the same slug, and reads a missing one as null', () => {
    expect(addLlmConnection(makeConnection())).toBe(true)
    expect(addLlmConnection(makeConnection({ name: 'Other' }))).toBe(false)
    expect(getLlmConnection('custom-compat')?.name).toBe('My Custom Endpoint')
    expect(getLlmConnection('nope')).toBeNull()
  })

  it('deletes the connection and moves the default on', () => {
    addLlmConnection(makeConnection({ slug: 'a' }))
    addLlmConnection(makeConnection({ slug: 'b' }))
    expect(getDefaultLlmConnection()).toBe('a')
    expect(setDefaultLlmConnection('b')).toBe(true)
    expect(setDefaultLlmConnection('nope')).toBe(false)
    expect(deleteLlmConnection('b')).toBe(true)
    expect(deleteLlmConnection('b')).toBe(false)
    expect(getDefaultLlmConnection()).toBe('a')
    deleteLlmConnection('a')
    expect(getDefaultLlmConnection()).toBeNull()
  })

})

describe('updateLlmConnection – customEndpoint', () => {
  it('preserves customEndpoint when provided in updates', () => {
    addLlmConnection(makeConnection())
    expect(updateLlmConnection('custom-compat', { customEndpoint: { api: 'anthropic-messages' } })).toBe(true)
    expect(getLlmConnection('custom-compat')?.customEndpoint).toEqual({ api: 'anthropic-messages' })
  })

  it('preserves existing customEndpoint when updates do not include it', () => {
    const customEndpoint = { api: 'openai-completions' as const }
    addLlmConnection(makeConnection({ customEndpoint }))
    expect(updateLlmConnection('custom-compat', { name: 'Renamed Endpoint' })).toBe(true)
    expect(getLlmConnection('custom-compat')).toMatchObject({ customEndpoint, name: 'Renamed Endpoint' })
  })

  it('overwrites customEndpoint protocol when updated', () => {
    addLlmConnection(makeConnection({ customEndpoint: { api: 'openai-completions' } }))
    expect(updateLlmConnection('custom-compat', { customEndpoint: { api: 'anthropic-messages' } })).toBe(true)
    expect(getLlmConnection('custom-compat')?.customEndpoint).toEqual({ api: 'anthropic-messages' })
  })

  it('does not update a connection that does not exist', () => {
    expect(updateLlmConnection('nope', { name: 'x' })).toBe(false)
  })
})

describe('updateLlmConnection persists midStreamBehavior', () => {
  const pi = (midStreamBehavior?: 'steer' | 'queue') => makeConnection({ slug: 'pi-test', type: 'anthropic', authType: 'api_key', midStreamBehavior })

  it("flips midStreamBehavior from 'steer' to 'queue' and back", () => {
    addLlmConnection(pi('steer'))
    expect(updateLlmConnection('pi-test', { midStreamBehavior: 'queue' })).toBe(true)
    expect(getLlmConnection('pi-test')?.midStreamBehavior).toBe('queue')
    expect(updateLlmConnection('pi-test', { midStreamBehavior: 'steer' })).toBe(true)
    expect(getLlmConnection('pi-test')?.midStreamBehavior).toBe('steer')
  })

  it('preserves existing midStreamBehavior when other fields are updated', () => {
    addLlmConnection(pi('queue'))
    expect(updateLlmConnection('pi-test', { name: 'Renamed' })).toBe(true)
    expect(getLlmConnection('pi-test')).toMatchObject({ name: 'Renamed', midStreamBehavior: 'queue' })
  })

  it('seeds midStreamBehavior from undefined when the patch sets it explicitly', () => {
    addLlmConnection(pi(undefined))
    expect(updateLlmConnection('pi-test', { midStreamBehavior: 'queue' })).toBe(true)
    expect(getLlmConnection('pi-test')?.midStreamBehavior).toBe('queue')
  })
})
