import { describe, expect, it } from 'bun:test'
import { failedList, listFor } from '../workspace-list'

describe('listFor', () => {
  const loaded = { workspaceId: 'ws1', items: [1, 2], loaded: true }

  it('shows the list for the workspace it was loaded for', () => {
    expect(listFor(loaded, 'ws1')).toEqual({ items: [1, 2], loaded: true })
  })

  it('shows nothing, not loaded, for another workspace or none', () => {
    expect(listFor(loaded, 'ws2')).toEqual({ items: [], loaded: false })
    expect(listFor(loaded, null)).toEqual({ items: [], loaded: false })
    expect(listFor({ workspaceId: null, items: [], loaded: false }, null).loaded).toBe(false)
  })
})

describe('failedList', () => {
  const loaded = { workspaceId: 'ws1', items: [1, 2], loaded: true }

  it('settles as loaded and keeps the rows it had for the same workspace', () => {
    expect(failedList({ ...loaded, loaded: false }, 'ws1')).toEqual({ workspaceId: 'ws1', items: [1, 2], loaded: true })
  })

  it('settles empty for a workspace it had no rows for', () => {
    expect(failedList(loaded, 'ws2')).toEqual({ workspaceId: 'ws2', items: [], loaded: true })
    expect(failedList({ workspaceId: null, items: [], loaded: false }, 'ws1').loaded).toBe(true)
  })
})
