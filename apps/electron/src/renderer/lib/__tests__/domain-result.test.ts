import { describe, expect, it } from 'bun:test'
import { toResult } from '../domain-result'

describe('toResult', () => {
  it('wraps a value', async () => {
    expect(await toResult(async () => 7)).toEqual({ ok: true, value: 7 })
  })

  it('keeps the code of a domain error', async () => {
    const conflict = Object.assign(new Error('changed'), { code: 'conflict' })
    expect(await toResult(() => Promise.reject(conflict))).toEqual({ ok: false, code: 'conflict' })
  })

  it('is unknown for any other failure', async () => {
    expect(await toResult(() => Promise.reject(new Error('boom')))).toEqual({ ok: false, code: 'unknown' })
    expect(await toResult(() => Promise.reject('nope'))).toEqual({ ok: false, code: 'unknown' })
    expect(await toResult(() => Promise.reject(Object.assign(new Error('x'), { code: '' })))).toEqual({ ok: false, code: 'unknown' })
  })
})
