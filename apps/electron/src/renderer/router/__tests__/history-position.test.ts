import { describe, expect, it } from 'bun:test'
import { canGoBack, canGoForward, initialHistoryPosition, nextHistoryPosition } from '../history-position'

describe('history position', () => {
  it('starts with neither direction on a fresh entry', () => {
    const p = initialHistoryPosition(0)
    expect(canGoBack(p)).toBe(false)
    expect(canGoForward(p)).toBe(false)
  })

  it('can go back after a push and forward after going back', () => {
    let p = initialHistoryPosition(0)
    p = nextHistoryPosition(p, 'PUSH', 1)
    p = nextHistoryPosition(p, 'PUSH', 2)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, false])
    p = nextHistoryPosition(p, 'BACK', 1)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, true])
    p = nextHistoryPosition(p, 'BACK', 0)
    expect([canGoBack(p), canGoForward(p)]).toEqual([false, true])
    p = nextHistoryPosition(p, 'FORWARD', 1)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, true])
    p = nextHistoryPosition(p, 'FORWARD', 2)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, false])
  })

  it('a push after going back discards the entries ahead', () => {
    let p = initialHistoryPosition(0)
    for (const i of [1, 2, 3]) p = nextHistoryPosition(p, 'PUSH', i)
    p = nextHistoryPosition(p, 'BACK', 2)
    p = nextHistoryPosition(p, 'BACK', 1)
    expect(canGoForward(p)).toBe(true)
    p = nextHistoryPosition(p, 'PUSH', 2)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, false])
  })

  it('a replace keeps the position and what lies ahead', () => {
    let p = initialHistoryPosition(0)
    p = nextHistoryPosition(p, 'PUSH', 1)
    p = nextHistoryPosition(p, 'PUSH', 2)
    p = nextHistoryPosition(p, 'BACK', 1)
    p = nextHistoryPosition(p, 'REPLACE', 1)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, true])
    const first = nextHistoryPosition(initialHistoryPosition(0), 'REPLACE', 0)
    expect([canGoBack(first), canGoForward(first)]).toEqual([false, false])
  })

  it('a go jumps within the known range', () => {
    let p = initialHistoryPosition(0)
    for (const i of [1, 2, 3]) p = nextHistoryPosition(p, 'PUSH', i)
    p = nextHistoryPosition(p, 'GO', 0)
    expect([canGoBack(p), canGoForward(p)]).toEqual([false, true])
  })

  it('after a reload the entries ahead are unknown but Back works', () => {
    const p = initialHistoryPosition(3)
    expect([canGoBack(p), canGoForward(p)]).toEqual([true, false])
  })

  it('treats a missing index as the first entry', () => {
    expect(initialHistoryPosition(undefined)).toEqual({ index: 0, max: 0 })
    expect(nextHistoryPosition({ index: 1, max: 2 }, 'BACK', undefined)).toEqual({ index: 0, max: 2 })
  })
})
