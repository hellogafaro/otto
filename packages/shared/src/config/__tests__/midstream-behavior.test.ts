import { describe, expect, it } from 'bun:test'
import {
  defaultMidStreamBehavior,
  resolveMidStreamBehavior,
} from '../llm-connections.ts'

// ============================================================
// Pure helpers
// ============================================================

describe('defaultMidStreamBehavior', () => {
  it("returns 'queue' for anthropic (Claude's emulated steer is fragile)", () => {
    expect(defaultMidStreamBehavior('anthropic')).toBe('queue')
  })

  it("returns 'steer' for pi (Pi's native steer is non-destructive)", () => {
    expect(defaultMidStreamBehavior('pi')).toBe('steer')
  })

  it("returns 'steer' for pi_compat (same backend as pi)", () => {
    expect(defaultMidStreamBehavior('pi_compat')).toBe('steer')
  })
})

describe('resolveMidStreamBehavior', () => {
  const baseAnthropic = { providerType: 'anthropic' as const }
  const basePi = { providerType: 'pi' as const }

  it('returns the explicit value when set to steer', () => {
    expect(resolveMidStreamBehavior({ ...baseAnthropic, midStreamBehavior: 'steer' })).toBe('steer')
  })

  it('returns the explicit value when set to queue', () => {
    expect(resolveMidStreamBehavior({ ...basePi, midStreamBehavior: 'queue' })).toBe('queue')
  })

  it('falls back to default when midStreamBehavior is undefined (legacy connection)', () => {
    expect(resolveMidStreamBehavior(baseAnthropic)).toBe('queue')
    expect(resolveMidStreamBehavior(basePi)).toBe('steer')
  })

  it('falls back to default when midStreamBehavior has an unknown value (corrupt config.json)', () => {
    const corruptAnthropic = { ...baseAnthropic, midStreamBehavior: 'invalid' as never }
    const corruptPi = { ...basePi, midStreamBehavior: '' as never }
    expect(resolveMidStreamBehavior(corruptAnthropic)).toBe('queue')
    expect(resolveMidStreamBehavior(corruptPi)).toBe('steer')
  })
})
