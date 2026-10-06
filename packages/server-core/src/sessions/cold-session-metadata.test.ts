import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createImportedSession, loadSession, type StoredSession } from '@otto/shared/sessions'
import { initWorkspaceLabels } from '@otto/shared/labels/storage'
import { createLabel } from '@otto/shared/labels/crud'
import { initWorkspaceStatuses } from '@otto/shared/statuses/storage'
import type { StoredMessage } from '@otto/core/types'
import { SessionManager, createManagedSession } from './session-manager.ts'

// A chat whose messages are not loaded (every chat after a restart until it is opened) still writes its own fields:
// the write queue writes its row only, never an empty message list over its messages. Runs on the test database of
// the preload (scripts/test-preload.ts), one workspace id per test.

describe('cold-session metadata persistence', () => {
  let tmpRoot: string
  let workspaceId: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-cold-meta-'))
    workspaceId = `ws${Math.random().toString(36).slice(2, 12)}`
    initWorkspaceLabels(workspaceId)
    initWorkspaceStatuses(workspaceId)
    createLabel(workspaceId, { name: 'Urgent' })
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const workspace = () => ({ id: workspaceId, name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }) as never
  const chatId = (name: string) => `${name}-${workspaceId}`

  // A chat present from a previous run, registered with the post-restart `messagesLoaded: false` state.
  function seedColdSession(sessionId: string, opts: { name?: string; sessionStatus?: string; labels?: string[]; messages?: StoredMessage[] } = {}) {
    const stored = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: opts.name ?? 'cold session',
      createdBy: 'user:owner',
      sessionStatus: opts.sessionStatus ?? 'todo',
      labels: opts.labels ?? [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages: opts.messages ?? [],
    } as StoredSession
    createImportedSession(workspace(), stored)
    const managed = createManagedSession(
      { id: sessionId, name: stored.name, createdBy: stored.createdBy, sessionStatus: stored.sessionStatus, labels: stored.labels, createdAt: stored.createdAt },
      workspace(),
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
  }

  const reload = (sessionId: string) => loadSession(workspace(), sessionId)
  const makeUserMessage = (id: string, content: string): StoredMessage => ({ id, type: 'user', content, timestamp: Date.now() }) as StoredMessage

  it('setSessionStatus on a cold session is stored once it resolves', async () => {
    const sessionId = chatId('cold-status')
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    await sm.setSessionStatus(sessionId, 'done')

    expect(reload(sessionId)?.sessionStatus).toBe('done')
  })

  it('setSessionLabels on a cold session is stored once it resolves', async () => {
    const sessionId = chatId('cold-labels')
    seedColdSession(sessionId, { labels: [] })

    await sm.setSessionLabels(sessionId, ['urgent', 'bug'])

    expect(reload(sessionId)?.labels?.sort()).toEqual(['bug', 'urgent'])
  })

  it('renameSession on a cold session persists (with explicit flushSession)', async () => {
    const sessionId = chatId('cold-rename')
    seedColdSession(sessionId, { name: 'old name' })

    await sm.renameSession(sessionId, 'new name')
    await sm.flushSession(sessionId)

    expect(reload(sessionId)?.name).toBe('new name')
  })

  it('a cold-session write keeps the stored messages', async () => {
    const sessionId = chatId('cold-preserve-msgs')
    seedColdSession(sessionId, { messages: [makeUserMessage('m1', 'hello'), makeUserMessage('m2', 'world'), makeUserMessage('m3', 'three')] })
    expect(reload(sessionId)?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])

    await sm.setSessionStatus(sessionId, 'done')

    const after = reload(sessionId)
    expect(after?.sessionStatus).toBe('done')
    expect(after?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('concurrent cold-session status changes end with the last one', async () => {
    const sessionId = chatId('cold-concurrent')
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    await Promise.all([sm.setSessionStatus(sessionId, 'needs-review'), sm.setSessionStatus(sessionId, 'done')])

    expect(reload(sessionId)?.sessionStatus).toBe('done')
  })

  it('flushSession on a cold session returns only after the write lands', async () => {
    const sessionId = chatId('cold-flush-ordering')
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    const managed = (sm as unknown as { sessions: Map<string, { sessionStatus?: string }> }).sessions.get(sessionId)!
    managed.sessionStatus = 'cancelled'
    ;(sm as unknown as { persistSession: (m: unknown) => void }).persistSession(managed)
    await sm.flushSession(sessionId)

    expect(reload(sessionId)?.sessionStatus).toBe('cancelled')
  })
})
