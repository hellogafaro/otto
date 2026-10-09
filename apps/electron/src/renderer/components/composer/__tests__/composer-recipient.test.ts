import { describe, expect, it } from 'bun:test'
import type { Agent } from '../../../../shared/types'
import { chatAgentIds, composerAgent } from '../composer-state'

const agent = (id: string, isDefault = false): Agent => ({
  id, isDefault, title: `Agent ${id}`, avatar: '', provider: 'openai', model: null,
  instructions: '', thinkingLevel: 'medium', skills: [], sources: [],
  createdBy: 'user:owner', createdAt: 1, updatedAt: 1,
})

describe('composer recipient identity', () => {
  const agents = [agent('stronger'), agent('default', true), agent('other')]

  it('uses the protected workspace default identity, not the first or stronger model', () => {
    expect(composerAgent(agents)?.id).toBe('default')
    expect(composerAgent([...agents].reverse())?.id).toBe('default')
  })

  it('resolves an explicit selection without substituting a deleted or foreign identity', () => {
    expect(composerAgent(agents, 'other')?.id).toBe('other')
    expect(composerAgent(agents, 'deleted')).toBeUndefined()
    expect(composerAgent([], 'other')).toBeUndefined()
    expect(composerAgent([agent('stronger')])).toBeUndefined()
  })

  it('keeps a single chat agent implicit and deduplicates primary/member identities', () => {
    expect(chatAgentIds({ agentId: 'other', members: ['user:owner', 'agent:other'] })).toEqual(['other'])
    expect(chatAgentIds({ agentId: 'other' })).toEqual(['other'])
    expect(chatAgentIds({ members: ['user:owner', 'agent:other', 'agent:default'] })).toEqual(['other', 'default'])
  })

  it('never gives a human-only chat the workspace default agent', () => {
    expect(chatAgentIds({ members: ['user:owner', 'user:person'] })).toEqual([])
    expect(chatAgentIds(null)).toEqual([])
  })
})
