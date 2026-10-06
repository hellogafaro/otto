import { describe, expect, it } from 'bun:test'
import type { Agent, LlmConnection } from '../../../../shared/types'
import { locationToRouteString, routeStringToLocation } from '../../../router/location'
import { routes } from '../../../../shared/routes'
import { generatedAvatar } from '../../../components/people/agent-avatar'
import { agentSubtitle, allowedCount, modelChoices, providerChoices, providerOf, toDraft, toggleAllowed, toPatch } from '../agent-fields'

const agent: Agent = {
  id: 'a1b2c3d4e5f6',
  title: 'Researcher',
  instructions: 'Cite sources.',
  provider: 'anthropic',
  model: null,
  thinkingLevel: 'medium',
  skills: [],
  sources: ['github'],
  avatar: '',
  createdBy: 'user:u1',
  createdAt: 1,
  updatedAt: 2,
  isDefault: true,
}

const connections = [
  { slug: 'a', name: 'Claude', providerType: 'anthropic', authType: 'api_key', models: [{ id: 'claude-opus-4-6', name: 'Opus 4.6' }, 'claude-haiku'] },
  { slug: 'b', name: 'Codex', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth', models: ['gpt-5'] },
  { slug: 'c', name: 'Claude 2', providerType: 'anthropic', authType: 'oauth', models: ['claude-haiku'] },
] as unknown as LlmConnection[]

describe('agent fields', () => {
  it('patches only what changed, never an empty name', () => {
    expect(toPatch(agent, toDraft(agent))).toBeNull()
    expect(toPatch(agent, { ...toDraft(agent), title: '  ' })).toBeNull()
    expect(toPatch(agent, { ...toDraft(agent), title: ' Writer ', skills: ['x'] })).toEqual({ title: 'Writer', skills: ['x'] })
    expect(toPatch(agent, { ...toDraft(agent), provider: 'openai-codex', model: 'gpt-5' })).toEqual({ provider: 'openai-codex', model: 'gpt-5' })
  })

  it('maps connections to providers and their models', () => {
    expect(providerOf(connections[1])).toBe('openai-codex')
    expect(providerChoices('anthropic', connections).map((c) => c.value)).toEqual(['anthropic', 'openai-codex'])
    expect(providerChoices('google', connections)[0]).toEqual({ value: 'google', label: 'Google AI Studio' })
    expect(modelChoices('anthropic', connections)).toEqual([
      { value: 'claude-opus-4-6', label: 'Opus 4.6' },
      { value: 'claude-haiku', label: 'claude-haiku' },
    ])
  })

  it('toggles a [] = all list', () => {
    const all = ['a', 'b', 'c']
    expect(toggleAllowed([], all, 'b')).toEqual(['a', 'c'])
    expect(toggleAllowed(['a', 'c'], all, 'b')).toEqual([])
    expect(toggleAllowed(['a'], all, 'a')).toEqual(['a'])
    expect(toggleAllowed(['a', 'gone'], all, 'c')).toEqual(['a', 'c'])
    expect(allowedCount([], all)).toBe(3)
    expect(allowedCount(['a', 'gone'], all)).toBe(1)
  })

  it('writes the gallery subtitle', () => {
    const t = ((key: string, options: { count: number }) => `${options.count} ${key.split('.')[1]}`) as never
    expect(agentSubtitle(agent, { skills: ['s1', 's2'], sources: ['github', 'slack'], connections }, t)).toEqual(['Anthropic', '2 skillCount · 1 sourceCount'])
    expect(agentSubtitle({ ...agent, model: 'claude-opus-4-6' }, { skills: [], sources: [], connections }, t)).toEqual(['Opus 4.6', '0 skillCount · 0 sourceCount'])
  })

  it('generates the same avatar for the same id', () => {
    expect(generatedAvatar('a1b2c3d4e5f6')).toEqual(generatedAvatar('a1b2c3d4e5f6'))
  })

  it('round-trips the routes', () => {
    expect(routeStringToLocation(routes.view.agents(), 'acme')).toEqual({ pathname: '/acme/settings/agents', search: {} })
    expect(routeStringToLocation(routes.view.agents('a1b2c3d4e5f6'), 'acme')?.pathname).toBe('/acme/settings/agents/a1b2c3d4e5f6')
    expect(locationToRouteString('/acme/settings/agents/a1b2c3d4e5f6')).toEqual({ routeString: 'agents/agent/a1b2c3d4e5f6', workspaceSlug: 'acme' })
    expect(locationToRouteString('/acme/settings/agents')?.routeString).toBe('agents')
  })
})
