import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSession, listSessions, loadSession } from '../storage'
import { readSessionHeader, readSessionJsonl, writeSessionJsonl } from '../jsonl'
import type { StoredSession } from '../types'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'created-by-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('session createdBy', () => {
  it('is written into the header when a chat is created and read back by every reader', async () => {
    const chat = await createSession(root, { createdBy: 'user:abcdefghijkl', name: 'Mine' })

    expect(chat.createdBy).toBe('user:abcdefghijkl')
    expect(loadSession(root, chat.id)?.createdBy).toBe('user:abcdefghijkl')
    expect(listSessions(root).find((s) => s.id === chat.id)?.createdBy).toBe('user:abcdefghijkl')
    expect(readSessionHeader(join(root, 'sessions', chat.id, 'session.jsonl'))?.createdBy).toBe('user:abcdefghijkl')
  })

  it('survives a rewrite of the file', async () => {
    const chat = await createSession(root, { createdBy: 'user:abcdefghijkl' })
    const file = join(root, 'sessions', chat.id, 'session.jsonl')

    writeSessionJsonl(file, readSessionJsonl(file) as StoredSession)

    expect(readSessionJsonl(file)?.createdBy).toBe('user:abcdefghijkl')
  })

  it('is absent on a chat made without one (a chat from before chats were private)', async () => {
    const chat = await createSession(root, { name: 'Old' })

    expect(loadSession(root, chat.id)?.createdBy).toBeUndefined()
    expect(listSessions(root).find((s) => s.id === chat.id)?.createdBy).toBeUndefined()
  })
})
