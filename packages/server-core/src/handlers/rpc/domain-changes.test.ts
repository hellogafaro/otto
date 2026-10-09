import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS as C } from '@otto/shared/protocol'
import type { HandlerFn, RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { WRITE_CHANNELS } from './domain-changes'
import { registerCoreRpcHandlers } from './index'
import { HANDLED_CHANNELS as MEMBER_CHANNELS } from './workspaces-members'

// A write that shows in the UI must push `domain:changed`. This enumerates every channel the core registers
// for the domains library, projects, tasks, timesheets, comments, notifications, labels, statuses, skills and workspace members: each is
// a write (in WRITE_CHANNELS) or a read (listed here), so a new handler fails until it is classified.

const READ_CHANNELS = new Set<string>([
  C.library.LIST,
  C.library.GET,
  C.library.READ,
  C.projects.LIST,
  C.projects.GET,
  C.tasks.LIST,
  C.tasks.GET,
  C.timesheets.LIST,
  C.comments.GET,
  C.notifications.GET,
  C.notifications.GET_UNREAD_COUNT,
  C.workspaces.GET_MEMBERS,
  C.workspaces.GET_INVITATIONS,
  C.labels.LIST,
  C.statuses.LIST,
  C.agents.LIST,
  C.agents.GET,
  C.agents.SCREEN_URL,
  C.routines.LIST,
  C.routines.GET,
])

const registered = new Set<string>()
const server = {
  handle: (channel: string, _handler: HandlerFn) => void registered.add(channel),
  push() {},
  async invokeClient() {},
} as RpcServer
const deps = {
  sessionManager: {},
  platform: { logger: console, imageProcessor: {} },
  oauthFlowStore: {},
} as unknown as HandlerDeps
registerCoreRpcHandlers(server, deps)

const inScope = (channel: string) =>
  (/^(library|projects|tasks|timesheets|comments|notifications|labels|statuses|agents|routines):/.test(channel)) ||
  (MEMBER_CHANNELS as readonly string[]).includes(channel)

describe('every write of the shared data pushes domain:changed', () => {
  const scoped = [...registered].filter(inScope)

  it('finds the handlers of these domains', () => {
    expect(scoped.length).toBeGreaterThan(30)
  })

  it('classifies every handler as a write or a read, never both', () => {
    for (const channel of scoped) {
      expect([channel, channel in WRITE_CHANNELS || READ_CHANNELS.has(channel)]).toEqual([channel, true])
      expect([channel, channel in WRITE_CHANNELS && READ_CHANNELS.has(channel)]).toEqual([channel, false])
    }
  })

  it('lists only channels that are registered', () => {
    for (const channel of [...Object.keys(WRITE_CHANNELS), ...READ_CHANNELS]) expect([channel, registered.has(channel)]).toEqual([channel, true])
  })

  it('lets what notifies people also stale the inbox, and a status change nothing more than the tasks and their activity', () => {
    for (const channel of [C.tasks.CREATE, C.tasks.UPDATE, C.comments.CREATE, C.comments.DELETE]) {
      expect(WRITE_CHANNELS[channel]).toContain('notifications')
    }
    expect(WRITE_CHANNELS[C.tasks.SET_STATUS]).toEqual(['tasks', 'comments'])
    for (const channel of [C.tasks.UPDATE, C.timesheets.CREATE]) expect(WRITE_CHANNELS[channel]).toContain('comments')
    expect(WRITE_CHANNELS[C.comments.UPDATE]).toEqual(['comments'])
  })
})
