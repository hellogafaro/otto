import { describe, expect, it } from 'bun:test'
import { actorColorIndex, collapseGroup, initialsOf, isAgentActor, otherParticipants } from '../actors'

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

  it('never lists the viewer among a chat\'s people', () => {
    expect(otherParticipants(['user:a', 'user:b'], 'user:a')).toEqual(['user:b'])
    expect(otherParticipants(['user:a', 'user:b'], 'user:b')).toEqual(['user:a'])
    // alone: nobody else, so the chat shows just its agent
    expect(otherParticipants(['user:a'], 'user:a')).toEqual([])
    expect(otherParticipants(undefined, 'user:a')).toEqual([])
    // a repeat shows once; while the viewer is unknown nobody shows (never themselves, even briefly)
    expect(otherParticipants(['user:b', 'user:c', 'user:b'], 'user:a')).toEqual(['user:b', 'user:c'])
    expect(otherParticipants(['user:a', 'user:b'], null)).toEqual([])
  })

  it('collapses a group past its maximum into "+N"', () => {
    expect(collapseGroup(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b', 'c'], more: 0 })
    expect(collapseGroup(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 })
    expect(collapseGroup(['a'])).toEqual({ shown: ['a'], more: 0 })
    expect(collapseGroup([])).toEqual({ shown: [], more: 0 })
  })
})
