import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { canEditConnection, connectionKindLabel, groupConnections, hostOf, scopeKindOf, scopeLabel, sortConnections } from '../connection-labels'

const t = ((key: string) => key) as unknown as TFunction

describe('connection labels', () => {
  it('reads the scope kind of a connection', () => {
    expect(scopeKindOf('user:abc')).toBe('user')
    expect(scopeKindOf('workspace:abc')).toBe('workspace')
    expect(scopeKindOf('install')).toBe('install')
    expect(scopeKindOf(undefined)).toBe('install')
    expect(scopeLabel('user:abc', t)).toBe('connections.scope.user')
  })

  it('names the kind of each connection', () => {
    expect(connectionKindLabel({ type: 'claude-code' }, t)).toBe('connections.kind.claudeCode')
    expect(connectionKindLabel({ type: 'anthropic' }, t)).toBe('connections.kind.anthropic')
    expect(connectionKindLabel({ type: 'openai-codex' }, t)).toBe('connections.kind.chatgpt')
    expect(connectionKindLabel({ type: 'openrouter' }, t)).toBe('OpenRouter')
    expect(connectionKindLabel({ type: 'zai' }, t)).toBe('zai')
    expect(connectionKindLabel({ type: 'custom', baseUrl: 'http://localhost:11434/v1' }, t)).toBe('OpenAI · localhost:11434')
    expect(connectionKindLabel({ type: 'custom' }, t)).toBe('OpenAI')
    expect(hostOf('not a url')).toBe('not a url')
  })

  it('labels the saved custom API protocol without guessing legacy endpoints', () => {
    expect(connectionKindLabel({ type: 'custom', baseUrl: 'https://api.example.com/v1', customEndpoint: { api: 'openai-responses' } }, t)).toBe('OpenAI · Responses API · api.example.com')
    expect(connectionKindLabel({ type: 'custom', customEndpoint: { api: 'openai-completions' } }, t)).toBe('OpenAI · Chat Completions API')
    expect(connectionKindLabel({ type: 'custom', customEndpoint: { api: 'anthropic-messages' } }, t)).toBe('OpenAI')
  })

  it('lists personal connections first, then the workspace\'s, then the server\'s, each by name', () => {
    const rows = [
      { name: 'Z', scope: 'user:1' },
      { name: 'B', scope: 'install' },
      { name: 'A', scope: 'workspace:w' },
      { name: 'A', scope: 'user:1' },
    ]
    expect(sortConnections(rows).map((r) => `${scopeKindOf(r.scope)}:${r.name}`)).toEqual(['user:A', 'user:Z', 'workspace:A', 'install:B'])
  })

  it('lets anyone change their own and only owners change a shared one', () => {
    expect(canEditConnection({ scope: 'user:1' }, false)).toBe(true)
    expect(canEditConnection({ scope: 'workspace:w' }, false)).toBe(false)
    expect(canEditConnection({ scope: 'install' }, true)).toBe(false)
    expect(canEditConnection({ scope: undefined }, true)).toBe(false)
    expect(canEditConnection({ scope: 'workspace:w' }, true)).toBe(true)
  })

  it('groups actual personal scopes separately from workspace and legacy install scopes without changing records', () => {
    const personal = { name: 'Z', scope: 'user:1', slug: 'same', id: 'personal' }
    const workspace = { name: 'A', scope: 'workspace:w', slug: 'same', id: 'workspace' }
    const legacy = { name: 'B', slug: 'legacy', id: 'legacy' }
    const groups = groupConnections([legacy, personal, workspace])
    expect(groups.user).toEqual([personal])
    expect(groups.shared).toEqual([workspace, legacy])
    expect(groups.user[0]).toBe(personal)
    expect(groups.shared[0]).toBe(workspace)
  })
})
