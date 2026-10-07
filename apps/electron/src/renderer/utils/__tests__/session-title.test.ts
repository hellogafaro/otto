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

  it('titles a DM or a group by the other people, as the viewer sees it, below a stored name', () => {
    const names: Record<string, string> = { 'user:a': 'Ada', 'user:b': 'Grace', 'user:c': 'Linus' }
    const people = (me: string) => ({ me, nameOf: (actor: string) => names[actor] ?? actor })
    const group = { name: undefined, preview: 'hello', members: ['user:a', 'user:b', 'user:c', 'agent:x'] }
    expect(getSessionTitle(group, people('user:a'))).toBe('Grace and Linus')
    expect(getSessionTitle(group, people('user:b'))).toBe('Ada and Linus')
    expect(getSessionTitle({ ...group, name: 'Launch' }, people('user:a'))).toBe('Launch')
    // an agent chat keeps its first message; without the names it falls back the same way
    expect(getSessionTitle({ ...group, agentId: 'x' }, people('user:a'))).toBe('hello')
    expect(getSessionTitle(group)).toBe('hello')
  })
})
