import { describe, it, expect } from 'bun:test'
import { createAutosave, type AutosaveEvents, type AutosaveState } from '../use-autosave'

const MS = 20
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(save: (value: string) => unknown, initial = 'a') {
  const states: AutosaveState<string>[] = []
  const log = { saved: [] as unknown[], failed: [] as Error[], conflicts: 0 }
  const events: AutosaveEvents = {
    saved: (result) => log.saved.push(result),
    failed: (error) => log.failed.push(error),
    conflict: () => log.conflicts++,
  }
  const autosave = createAutosave(initial, save, (state) => states.push(state), events, MS)
  const last = () => states[states.length - 1]
  return { autosave, log, last }
}

describe('createAutosave', () => {
  it('shows a change at once and saves only the last one after the delay', async () => {
    const sent: string[] = []
    const { autosave, last } = setup((v) => void sent.push(v))
    autosave.change('b')
    autosave.change('c')
    expect(last()).toMatchObject({ value: 'c', pending: true })
    expect(sent).toEqual([])
    await wait(MS * 3)
    expect(sent).toEqual(['c'])
    expect(last()).toMatchObject({ value: 'c', pending: false, error: null })
  })

  it('never runs two saves at once and loops to the latest draft', async () => {
    let active = 0
    let overlap = false
    const sent: string[] = []
    const { autosave, last } = setup(async (v) => {
      active++
      overlap ||= active > 1
      await wait(MS * 2)
      sent.push(v)
      active--
    })
    autosave.change('b')
    await wait(MS * 1.5) // the save of 'b' is running
    autosave.change('c')
    await wait(MS * 1.5)
    autosave.flush() // would start a second save if not serialized
    await wait(MS * 6)
    expect(overlap).toBe(false)
    expect(sent).toEqual(['b', 'c'])
    expect(last().pending).toBe(false)
  })

  it('passes each result to saved', async () => {
    const { autosave, log } = setup(() => ({ updatedAt: 7 }))
    autosave.change('b')
    autosave.flush()
    await wait(MS)
    expect(log.saved).toEqual([{ updatedAt: 7 }])
  })

  it('does not send a value flipped back to what is saved', async () => {
    const sent: string[] = []
    const { autosave } = setup((v) => void sent.push(v))
    autosave.change('b')
    autosave.change('a')
    await wait(MS * 3)
    expect(sent).toEqual([])
  })

  it('adopts an external value when clean, never over a dirty draft', async () => {
    const { autosave, last } = setup(() => {})
    autosave.adopt('x')
    expect(last()).toMatchObject({ value: 'x', pending: false })
    autosave.change('mine')
    autosave.adopt('y')
    expect(last().value).toBe('mine')
    await wait(MS * 3)
    expect(last()).toMatchObject({ value: 'mine', pending: false })
  })

  it('keeps the draft on failure, reports it, and retry sends it again', async () => {
    let fail = true
    const sent: string[] = []
    const { autosave, log, last } = setup((v) => {
      if (fail) throw new Error('offline')
      sent.push(v)
    })
    autosave.change('b')
    await wait(MS * 3)
    expect(last()).toMatchObject({ value: 'b', pending: false })
    expect(last().error?.message).toBe('offline')
    expect(log.failed).toHaveLength(1)
    fail = false
    autosave.retry()
    await wait(MS)
    expect(sent).toEqual(['b'])
    expect(last()).toMatchObject({ value: 'b', pending: false, error: null })
  })

  it('on a conflict drops the draft, back to the last saved value', async () => {
    const { autosave, log, last } = setup(() => {
      throw Object.assign(new Error('changed'), { code: 'conflict' })
    })
    autosave.change('b')
    await wait(MS * 3)
    expect(log.conflicts).toBe(1)
    expect(log.failed).toHaveLength(0)
    expect(last()).toMatchObject({ value: 'a', pending: false, error: null })
  })

  it('flush saves a waiting change at once (blur, unmount)', async () => {
    const sent: string[] = []
    const { autosave } = setup((v) => void sent.push(v))
    autosave.change('b')
    autosave.flush()
    expect(sent).toEqual(['b'])
    await wait(MS * 3)
    expect(sent).toEqual(['b'])
  })
})
