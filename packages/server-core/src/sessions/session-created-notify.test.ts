import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { SessionManager } from './session-manager.ts'

// Locks the session_created emit primitive used by createSession's default announcement.
// (createSession itself needs full workspace/storage wiring; the emit *decision* it makes is a
// one-line guard delegating to notifySessionCreated, which is what we verify here.)
describe('notifySessionCreated', () => {
  it('emits a session_created session-event scoped to the workspace and the audience of the chat', () => {
    const sm = new SessionManager()
    const calls: Array<{ channel: string; target: unknown; payload: unknown[] }> = []
    sm.setEventSink((channel: string, target: unknown, ...payload: unknown[]) => {
      calls.push({ channel, target, payload })
    })

    sm.notifySessionCreated('ws-1', 'sess-1')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.channel).toBe(RPC_CHANNELS.sessions.EVENT)
    // A chat nobody may see (no such chat, no owners known) reaches no connection.
    expect(calls[0]!.target).toEqual({ to: 'workspace', workspaceId: 'ws-1', userIds: [] })
    expect(calls[0]!.payload[0]).toEqual({ type: 'session_created', sessionId: 'sess-1' })
  })
})
