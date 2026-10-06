import { describe, expect, it } from 'bun:test'
import { debounce, DEBOUNCE_MS } from '../debounce.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('debounce', () => {
  it('runs once, after the delay, never at once', async () => {
    const calls: string[] = []
    const fn = debounce((value: string) => calls.push(value), 40)
    fn('a')
    expect(calls).toEqual([])
    await sleep(15)
    expect(calls).toEqual([])
    await sleep(60)
    expect(calls).toEqual(['a'])
  })

  it('the last call wins and every call restarts the wait', async () => {
    const calls: Array<[string, number]> = []
    const fn = debounce((a: string, b: number) => calls.push([a, b]), 50)
    fn('a', 1)
    await sleep(30)
    fn('b', 2)
    await sleep(30)
    fn('c', 3)
    await sleep(30)
    expect(calls).toEqual([]) // 30ms after the last call: still waiting
    await sleep(60)
    expect(calls).toEqual([['c', 3]])
  })

  it('cancel drops the waiting call', async () => {
    let count = 0
    const fn = debounce(() => count++, 20)
    fn()
    fn.cancel()
    await sleep(50)
    expect(count).toBe(0)
    fn() // still usable afterwards
    await sleep(50)
    expect(count).toBe(1)
  })

  it('flush runs the waiting call now, once, with the last arguments', async () => {
    const calls: string[] = []
    const fn = debounce((value: string) => calls.push(value), 30)
    fn('a')
    fn('b')
    fn.flush()
    expect(calls).toEqual(['b'])
    await sleep(60)
    expect(calls).toEqual(['b'])
  })

  it('flush with nothing waiting does nothing', async () => {
    let count = 0
    const fn = debounce(() => count++, 20)
    fn.flush()
    expect(count).toBe(0)
    fn()
    await sleep(50)
    fn.flush()
    expect(count).toBe(1)
  })

  it('search waits 800 ms', () => {
    expect(DEBOUNCE_MS).toBe(800)
  })
})
