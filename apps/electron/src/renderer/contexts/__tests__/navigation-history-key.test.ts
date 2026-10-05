import { describe, expect, it } from 'bun:test'
import { buildSemanticHistoryKey, canRunInitialRestore } from '../navigation-history'

describe('buildSemanticHistoryKey', () => {
  it('changes with the route and with the workspace', () => {
    const base = { workspaceSlug: 'ws', route: 'allSessions/session/s1' }
    expect(buildSemanticHistoryKey(base)).not.toBe(buildSemanticHistoryKey({ ...base, route: 'sources/source/github' }))
    expect(buildSemanticHistoryKey(base)).not.toBe(buildSemanticHistoryKey({ ...base, workspaceSlug: 'other' }))
  })

  it('stays stable for identical semantic inputs', () => {
    const input = { workspaceSlug: 'ws', route: 'allSessions/session/s1' }

    expect(buildSemanticHistoryKey(input)).toBe(buildSemanticHistoryKey(input))
  })
})

describe('canRunInitialRestore', () => {
  it('returns false until session metadata is ready', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: false,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(false)
  })

  it('returns true only when all restore conditions are satisfied', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(true)

    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: true,
    })).toBe(false)
  })
})
