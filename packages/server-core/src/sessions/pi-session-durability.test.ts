import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createImportedSession, getSessionPath, loadSession, type StoredSession } from '@otto/shared/sessions'
import { initFileStorage } from '@otto/shared/library'
import { initWorkspaceLabels } from '@otto/shared/labels/storage'
import { initWorkspaceStatuses } from '@otto/shared/statuses/storage'
import { startS3Double, type S3Double } from '../../../shared/src/library/__tests__/s3-double.ts'
import { SessionManager, createManagedSession } from './session-manager.ts'

type ManagedSession = ReturnType<typeof createManagedSession>

// Pi's session file follows the chat to object storage after a settled turn and comes back before the agent is made
// (shared sessions/pi-session-sync.ts). The upload never blocks or fails a turn; deleting the chat deletes the object.

describe('Pi session durability in the session manager', () => {
  let tmpRoot: string
  let workspaceId: string
  let sm: SessionManager
  let double: S3Double

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-pi-durable-'))
    workspaceId = `ws${Math.random().toString(36).slice(2, 12)}`
    initWorkspaceLabels(workspaceId)
    initWorkspaceStatuses(workspaceId)
    sm = new SessionManager()
    double = startS3Double()
    initFileStorage({ OTTO_STORAGE: 's3', OTTO_S3_ENDPOINT: double.url, OTTO_S3_BUCKET: double.bucket, OTTO_S3_REGION: 'r', OTTO_S3_ACCESS_KEY_ID: double.accessKeyId, OTTO_S3_SECRET_ACCESS_KEY: 'secret' })
  })

  afterEach(() => {
    initFileStorage({})
    double.stop()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const workspace = () => ({ id: workspaceId, name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }) as never
  const objectKey = (id: string) => `workspaces/${workspaceId}/chats/${id}/session.jsonl`

  function seed(id: string): ManagedSession {
    createImportedSession(workspace(), { id, workspaceRootPath: tmpRoot, name: id, createdBy: 'user:owner', sessionStatus: 'todo', labels: [], createdAt: Date.now(), lastUsedAt: Date.now(), messages: [] } as unknown as StoredSession)
    const managed = createManagedSession({ id, name: id, createdBy: 'user:owner', createdAt: Date.now() }, workspace())
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function writePiFile(id: string, content: string) {
    const dir = join(getSessionPath(tmpRoot, id), '.pi-sessions')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'x.jsonl'), content)
  }

  const call = <T>(name: string, ...args: unknown[]) => (sm as unknown as Record<string, (...a: unknown[]) => T>)[name]!.call(sm, ...args)

  it('uploads after the turn, records the hash on the chat and skips unchanged bytes', async () => {
    const managed = seed('chat-a')
    writePiFile('chat-a', '{"type":"session","cwd":"/x"}\n')
    call('syncPiSession', managed)
    await managed.piSessionSync
    expect(double.objects.has(objectKey('chat-a'))).toBe(true)
    expect(managed.piSession?.hash).toHaveLength(64)

    await sm.flushSession('chat-a')
    expect(loadSession(workspace(), 'chat-a')?.piSession).toEqual(managed.piSession)

    const puts = double.requests.filter((r) => r.startsWith('PUT ')).length
    call('syncPiSession', managed)
    await managed.piSessionSync
    expect(double.requests.filter((r) => r.startsWith('PUT ')).length).toBe(puts)
  })

  it('a failing upload does not throw and the next turn retries', async () => {
    const managed = seed('chat-b')
    writePiFile('chat-b', '{"type":"session","cwd":"/x"}\n')
    double.fail = (method) => method === 'PUT'
    call('syncPiSession', managed)
    await managed.piSessionSync
    expect(managed.piSession).toBeUndefined()
    expect(double.objects.size).toBe(0)

    double.fail = undefined
    call('syncPiSession', managed)
    await managed.piSessionSync
    expect(double.objects.has(objectKey('chat-b'))).toBe(true)
  })

  it('restores the file on a disk that lost it, before the agent is made', async () => {
    const managed = seed('chat-c')
    writePiFile('chat-c', '{"type":"session","cwd":"/x"}\n{"type":"message"}\n')
    call('syncPiSession', managed)
    await managed.piSessionSync

    const dir = join(getSessionPath(tmpRoot, 'chat-c'), '.pi-sessions')
    rmSync(dir, { recursive: true })
    await call<Promise<void>>('restorePiSessionFiles', managed, getSessionPath(tmpRoot, 'chat-c'))
    const [name] = readdirSync(dir)
    expect(readFileSync(join(dir, name!), 'utf8')).toContain('{"type":"message"}')
  })

  it('deleting the chat deletes its object', async () => {
    const managed = seed('chat-d')
    writePiFile('chat-d', '{"type":"session","cwd":"/x"}\n')
    call('syncPiSession', managed)
    await managed.piSessionSync
    expect(double.objects.has(objectKey('chat-d'))).toBe(true)

    await sm.deleteSession('chat-d')
    await Bun.sleep(50)
    expect(double.objects.has(objectKey('chat-d'))).toBe(false)
  })
})
