import { describe, expect, it } from 'bun:test'
import {
  defaultMidStreamBehavior,
  resolveMidStreamBehavior,
} from '../llm-connections.ts'

describe('defaultMidStreamBehavior', () => {
  it("returns 'steer' (Pi's native steer is non-destructive)", () => {
    expect(defaultMidStreamBehavior()).toBe('steer')
  })
})

describe('resolveMidStreamBehavior', () => {
  it('returns the explicit value when set', () => {
    expect(resolveMidStreamBehavior({ midStreamBehavior: 'steer' })).toBe('steer')
    expect(resolveMidStreamBehavior({ midStreamBehavior: 'queue' })).toBe('queue')
  })

  it('falls back to the default when midStreamBehavior is undefined (legacy connection)', () => {
    expect(resolveMidStreamBehavior({})).toBe('steer')
  })

  it('falls back to the default when midStreamBehavior has an unknown value (corrupt config.json)', () => {
    expect(resolveMidStreamBehavior({ midStreamBehavior: 'invalid' as never })).toBe('steer')
    expect(resolveMidStreamBehavior({ midStreamBehavior: '' as never })).toBe('steer')
  })
})
