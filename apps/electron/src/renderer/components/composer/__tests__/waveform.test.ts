import { describe, expect, test } from 'bun:test'
import { barCount, barScale } from '../waveform'

describe('barCount', () => {
  test('fits 4px bars 2px apart inside the 8px padding', () => {
    expect(barCount(16)).toBe(0)
    expect(barCount(22)).toBe(1) // 4px
    expect(barCount(28)).toBe(2) // 4 + 2 + 4
    expect(barCount(316)).toBe(50)
  })
  test('never negative', () => expect(barCount(0)).toBe(0))
})

describe('barScale', () => {
  const silent = new Uint8Array(8)
  const loud = new Uint8Array(8).fill(255)
  test('is a 4px dot (0.2) when silent', () => expect(barScale(silent, 3, 10, 8)).toBe(0.2))
  test('is full height at full level', () => expect(barScale(loud, 3, 10, 8)).toBeCloseTo(1))
  test('is mirrored from the center', () => {
    const levels = Uint8Array.from([255, 200, 150, 100, 50, 25, 10, 0])
    for (let i = 0; i < 5; i++) expect(barScale(levels, i, 10, 8)).toBeCloseTo(barScale(levels, 9 - i, 10, 8))
  })
  test('low bins sit in the middle, high bins at the edges', () => {
    const low = Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0])
    expect(barScale(low, 5, 10, 8)).toBeGreaterThan(barScale(low, 0, 10, 8))
    const high = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255])
    expect(barScale(high, 0, 10, 8)).toBeGreaterThan(barScale(high, 5, 10, 8))
  })
  test('stays in range with no bars', () => expect(barScale(loud, 0, 0, 8)).toBeCloseTo(1))
})
