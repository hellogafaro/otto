import { describe, expect, it } from 'bun:test'
import { listFor } from '../workspace-list'

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
