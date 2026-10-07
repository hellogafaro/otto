import { describe, expect, it } from 'bun:test'
import { actorColorIndex, collapseGroup, initialsOf, isAgentActor, isPeopleChat, otherMembers, startsAgentRun } from '../actors'

describe('actors', () => {
  it('tells agents from people', () => {
    expect(isAgentActor('agent:default')).toBe(true)
    expect(isAgentActor('user:abcdefghij12')).toBe(false)
  })

  it('gives an actor the same color index every time, inside the range', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const index = actorColorIndex(`user:${i}`, 4)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
      expect(actorColorIndex(`user:${i}`, 4)).toBe(index)
      seen.add(index)
    }
    expect(seen.size).toBe(4)
  })

  it('takes up to two capital initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsOf('  grace   brewster  hopper ')).toBe('GH')
    expect(initialsOf('madonna')).toBe('M')
    expect(initialsOf('émile zola')).toBe('ÉZ')
    expect(initialsOf('   ')).toBe('')
  })

  it('never lists the viewer among a chat\'s members, agents first', () => {
    expect(otherMembers(['user:a', 'user:b'], 'user:a')).toEqual(['user:b'])
    expect(otherMembers(['user:a', 'user:b'], 'user:b')).toEqual(['user:a'])
    expect(otherMembers(['user:a', 'agent:x', 'user:b'], 'user:a')).toEqual(['agent:x', 'user:b'])
    // alone with the agent: just the agent
    expect(otherMembers(['user:a', 'agent:x'], 'user:a')).toEqual(['agent:x'])
    expect(otherMembers(undefined, 'user:a')).toEqual([])
    // a repeat shows once; while the viewer is unknown nobody shows (never themselves, even briefly)
    expect(otherMembers(['user:b', 'user:c', 'user:b'], 'user:a')).toEqual(['user:b', 'user:c'])
    expect(otherMembers(['user:a', 'user:b'], null)).toEqual([])
  })

  it('tells a people chat and when a send runs an agent', () => {
    expect(isPeopleChat({ members: ['user:a', 'user:b'] })).toBe(true)
    expect(isPeopleChat({ agentId: 'x', members: ['user:a', 'agent:x'] })).toBe(false)
    expect(isPeopleChat({ members: ['user:a', 'user:b', 'agent:x'] })).toBe(false)
    // one person with the primary agent: every message
    expect(startsAgentRun({ agentId: 'x', members: ['user:a', 'agent:x'] }, 'hi')).toBe(true)
    // several people, or none of the agents: only a mention
    expect(startsAgentRun({ agentId: 'x', members: ['user:a', 'user:b', 'agent:x'] }, 'hi')).toBe(false)
    expect(startsAgentRun({ agentId: 'x', members: ['user:a', 'user:b', 'agent:x'] }, 'agent:x hi')).toBe(true)
    expect(startsAgentRun({ members: ['user:a', 'user:b'] }, 'hi')).toBe(false)
  })

  it('collapses a group past its maximum into "+N"', () => {
    expect(collapseGroup(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b', 'c'], more: 0 })
    expect(collapseGroup(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 })
    expect(collapseGroup(['a'])).toEqual({ shown: ['a'], more: 0 })
    expect(collapseGroup([])).toEqual({ shown: [], more: 0 })
  })
})
