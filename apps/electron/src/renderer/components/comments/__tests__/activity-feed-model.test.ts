import { describe, expect, it } from 'bun:test'
import type { ActivityEvent, Comment } from '../../../../shared/types'
import { assigneeChange, earlierAnchor, layoutActivity, prependPage } from '../activity-feed-model'

let at = 0
const comment = (id: string): Comment => ({ id, entity: 'task:t', type: 'comment', createdBy: 'user:a', content: id, createdAt: ++at, updatedAt: at })
const event = (id: string, value: ActivityEvent | null = { kind: 'time', time: 60_000 }): Comment =>
  ({ id, entity: 'task:t', type: 'event', createdBy: 'user:a', content: '', ...(value && { event: value }), createdAt: ++at, updatedAt: at })
const shape = (items: Comment[]) => layoutActivity(items).map((block) => block.type === 'comment' ? block.comment.id : block.events.map((item) => item.id))

describe('layoutActivity', () => {
  it('keeps the order and runs consecutive events together, each comment alone', () => {
    const items = [event('created-t', { kind: 'created' }), event('e1'), comment('c1'), comment('c2'), event('e2'), event('e3'), event('e4'), comment('c3'), event('e5')]
    expect(shape(items)).toEqual([['created-t', 'e1'], 'c1', 'c2', ['e2', 'e3', 'e4'], 'c3', ['e5']])
  })

  it('keys a run by its first event, so it keeps its key while it grows', () => {
    expect(layoutActivity([comment('c1'), event('e1')]).map((block) => block.key)).toEqual(['c1', 'e1'])
    expect(layoutActivity([comment('c1'), event('e1'), event('e2')]).map((block) => block.key)).toEqual(['c1', 'e1'])
  })

  it('leaves out an unreadable event without splitting the run', () => {
    expect(shape([event('e1'), event('bad', null), event('e2'), comment('c1')])).toEqual([['e1', 'e2'], 'c1'])
    expect(shape([event('bad', null)])).toEqual([])
    expect(shape([])).toEqual([])
  })
})

describe('paging', () => {
  it('reads the next page before the oldest stored row, never the synthesized created event', () => {
    expect(earlierAnchor([comment('c1'), event('e1')])).toBe('c1')
    expect(earlierAnchor([event('created-t', { kind: 'created' }), event('e1')])).toBe('e1')
    expect(earlierAnchor([event('created-t', { kind: 'created' })])).toBeUndefined()
    expect(earlierAnchor([])).toBeUndefined()
  })

  it('puts the earlier page first and shows a row on both sides of the boundary once', () => {
    const [a, b, c, d] = [event('a'), comment('b'), event('c'), comment('d')]
    expect(prependPage([c, d], [a, b]).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    // A reload moved the boundary: the page ends with a row already shown, which keeps its place.
    expect(prependPage([b, c, d], [a, b]).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(prependPage([c, d], []).map((item) => item.id)).toEqual(['c', 'd'])
  })

  it('a run of events across the boundary becomes one run once the earlier page is in', () => {
    const shown = [event('e2'), comment('c1')]
    expect(shape(prependPage(shown, [comment('c0'), event('e1')]))).toEqual(['c0', ['e1', 'e2'], 'c1'])
  })
})

describe('assigneeChange', () => {
  it('tells who was added and who was removed', () => {
    expect(assigneeChange({ kind: 'assignees', from: ['user:a', 'user:b'], to: ['user:b', 'agent:x'] })).toEqual({ added: ['agent:x'], removed: ['user:a'] })
    expect(assigneeChange({ kind: 'assignees', from: [], to: ['user:a'] })).toEqual({ added: ['user:a'], removed: [] })
  })
})
