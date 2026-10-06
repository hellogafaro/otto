import { describe, expect, it } from 'bun:test'
import { actorColorIndex, initialsOf, isAgentActor } from '../actors'

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
})
