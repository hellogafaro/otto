import { describe, expect, test } from 'bun:test'
import { ComputerRuns, DesktopLease, getComputerRuns, hasActiveRuns } from '../lifecycle'

describe('ComputerRuns: 4 turns at once, the rest wait in order', () => {
  test('the fifth waits, is told once, and gets the first freed slot', async () => {
    const runs = new ComputerRuns(4)
    const held = await Promise.all([1, 2, 3, 4].map(() => runs.acquire()))
    expect(runs.activeCount).toBe(4)
    const waits: number[] = []
    let fifth: (() => void) | null = null
    const pending = runs.acquire({ onWait: (ahead) => waits.push(ahead) }).then((release) => (fifth = release))
    const sixth = runs.acquire({ onWait: (ahead) => waits.push(ahead) })
    await Bun.sleep(10)
    expect(waits).toEqual([1, 2])
    expect(fifth).toBeNull()
    held[0]!()
    held[0]!() // releasing twice frees one slot only
    await pending
    expect(fifth).not.toBeNull()
    expect(runs.activeCount).toBe(4)
    held[1]!()
    const release6 = await sixth
    for (const release of [...held.slice(2), fifth!, release6]) release()
    expect(runs.activeCount).toBe(0)
    expect(runs.waitingCount).toBe(0)
  })

  test('an abort while waiting leaves the queue', async () => {
    const runs = new ComputerRuns(1)
    const release = await runs.acquire()
    const ac = new AbortController()
    const waiting = runs.acquire({ signal: ac.signal })
    ac.abort()
    await expect(waiting).rejects.toThrow('aborted')
    expect(runs.waitingCount).toBe(0)
    release()
    expect(runs.activeCount).toBe(0)
  })

  test('per computer; an idle stop sees active and waiting turns', async () => {
    expect(hasActiveRuns('lifecycle01')).toBe(false)
    const release = await getComputerRuns('lifecycle01').acquire()
    expect(getComputerRuns('lifecycle01')).toBe(getComputerRuns('lifecycle01'))
    expect(hasActiveRuns('lifecycle01')).toBe(true)
    release()
    expect(hasActiveRuns('lifecycle01')).toBe(false)
  })
})

describe('DesktopLease: one chat holds the screen, 2 minutes idle; a person watching wins', () => {
  test('take, hold, lapse, watched', () => {
    let t = 0
    const lease = new DesktopLease(() => t)
    expect(lease.take('a')).toEqual({ held: true, holder: 'a' })
    t += 60_000
    expect(lease.take('b')).toEqual({ held: false, holder: 'a' })
    expect(lease.take('a').held).toBe(true) // using it renews the lease
    t += 119_000
    expect(lease.take('b').held).toBe(false)
    t += 2_000
    expect(lease.take('b')).toEqual({ held: true, holder: 'b' })
    expect(lease.current).toBe('b')
    lease.release('b')
    expect(lease.current).toBeNull()
    expect(lease.take('c', true)).toEqual({ held: false, holder: null })
    expect(lease.current).toBeNull()
  })
})
