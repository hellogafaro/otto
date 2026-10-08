import { expect, it } from 'bun:test'
import { SessionManager, createManagedSession } from './session-manager'

it('failed owned disposal remains retryable through shutdown without reopening an accepting deleted chat', async () => {
  const manager = new SessionManager()
  let failing = true, calls = 0
  const computer = { dispose: async () => { calls++; if (failing) throw new Error('Controlled Docker cleanup failure') } }
  const host = manager as unknown as { disposeComputer: (computer: unknown) => Promise<void>; computerCleanup: Set<unknown>; sessions: Map<string, ReturnType<typeof createManagedSession>> }
  await expect(host.disposeComputer(computer)).rejects.toThrow('Controlled')
  expect(host.computerCleanup.has(computer)).toBe(true)
  failing = false
  await manager.cleanup()
  expect(calls).toBe(2)
  expect(host.computerCleanup.size).toBe(0)
})

it('deletion closes admission before asynchronous computer teardown can accept another run', async () => {
  const manager = new SessionManager()
  const managed = createManagedSession({ id: 'fixture-chat', createdBy: 'user:aaaaaaaaaaaa' }, { id: 'fixture-workspace', name: 'Fixture', slug: 'fixture', rootPath: '/unused-cleanup-fixture', createdAt: 0 }, { messagesLoaded: true })
  let release!: () => void, ready!: () => void
  const blocked = new Promise<void>((resolve) => { ready = resolve })
  managed.nativeComputer = { dispose: async () => { ready(); await new Promise<void>((resolve) => { release = resolve }); throw new Error('Controlled disposal failure') } } as never
  const host = manager as unknown as { sessions: Map<string, typeof managed>; computerCleanup: Set<unknown> }
  host.sessions.set(managed.id, managed)
  const deleting = manager.deleteSession(managed.id)
  await blocked
  expect(host.sessions.has(managed.id)).toBe(false)
  await expect(manager.sendMessage(managed.id, 'No new run')).rejects.toThrow('not found')
  release()
  await expect(deleting).rejects.toThrow('Controlled disposal failure')
  expect(host.computerCleanup.size).toBe(1)
  const computer = [...host.computerCleanup][0] as { dispose: () => Promise<void> }
  computer.dispose = async () => {}
  await manager.cleanup()
  expect(host.computerCleanup.size).toBe(0)
})
