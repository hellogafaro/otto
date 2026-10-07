import { describe, expect, it } from 'bun:test'
import { getSessionTitle } from '../session'

describe('getSessionTitle', () => {
  it('drops entity tokens from a stored name and from the preview (titles are plain text)', () => {
    expect(getSessionTitle({ name: 'Review task:abcdefghij12 for project:zyxwvutsrq98', preview: undefined })).toBe('Review for')
    expect(getSessionTitle({ name: undefined, preview: 'Check task:abcdefghij12  today' })).toBe('Check today')
  })

  it('keeps a plain name', () => {
    expect(getSessionTitle({ name: 'Plan the launch', preview: undefined })).toBe('Plan the launch')
  })
})
