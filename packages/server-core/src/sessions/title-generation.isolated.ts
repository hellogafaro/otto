import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import * as config from '@otto/shared/config'
import { SessionManager, createManagedSession, setSessionPlatform } from './session-manager.ts'
import { buildTitlePrompt, buildRegenerateTitlePrompt } from '../../../shared/src/utils/title-generator.ts'

setSessionPlatform({
  appRootPath: '/tmp/title-test', resourcesPath: '/tmp/title-test/resources', isPackaged: false,
  appVersion: 'test', isDebugMode: false,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  imageProcessor: { async getMetadata() { return null }, async process() { throw new Error('Unexpected image processing in title test') } },
})

const spies: Array<{ mockRestore(): void }> = []
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore() })

function setup() {
  const manager = new SessionManager()
  const managed = createManagedSession({ id: 'title-test', llmConnection: 'openai-test', model: 'gpt-5.4', createdBy: 'user:title-owner' }, {
    id: 'ws-test', slug: 'ws-test', name: 'Test', rootPath: '/tmp/title-test', createdAt: 0,
  }, { messagesLoaded: true })
  managed.messages = [{ id: 'user-1', role: 'user', content: 'Fix title regeneration', timestamp: 1 }]
  ;(manager as any).sessions.set(managed.id, managed)
  const complete = spyOn(manager as any, 'nativeCompletion').mockResolvedValue('Native Title Fix')
  spies.push(complete, spyOn(config, 'resolveTitleLanguageName').mockReturnValue('English'))
  const sendEvent = spyOn(manager as any, 'sendEvent').mockImplementation(() => {})
  const persist = spyOn(manager as any, 'persistSession').mockImplementation(() => {})
  const flush = spyOn(manager as any, 'flushSession').mockResolvedValue(undefined)
  spies.push(sendEvent, persist, flush)
  return { manager, managed, complete, sendEvent, persist, flush }
}

describe('native title completion', () => {
  it('preserves the cold session model and language through regenerate-title and clears operation state', async () => {
    const { manager, managed, complete, sendEvent, flush } = setup()
    await expect(manager.refreshTitle(managed.id)).resolves.toEqual({ success: true, title: 'Native Title Fix' })
    expect(complete).toHaveBeenCalledWith(managed, buildRegenerateTitlePrompt(['Fix title regeneration'], '', { language: 'English' }))
    expect(complete.mock.calls[0]![0]).toMatchObject({ model: 'gpt-5.4', llmConnection: 'openai-test' })
    expect(managed.name).toBe('Native Title Fix')
    expect(managed.isAsyncOperationOngoing).toBe(false)
    expect(flush).toHaveBeenCalledWith(managed.id)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'title_generated', sessionId: managed.id, title: 'Native Title Fix' }, 'ws-test')
    expect(sendEvent).toHaveBeenCalledWith({ type: 'title_regenerating', sessionId: managed.id, isRegenerating: false }, 'ws-test')
  })

  it('preserves model and language when initially generating a title without a runtime process', async () => {
    const { manager, managed, complete } = setup()
    await (manager as any).generateTitle(managed, 'Fix title regeneration')
    expect(complete).toHaveBeenCalledWith(managed, buildTitlePrompt('Fix title regeneration', { language: 'English' }))
    expect(managed.model).toBe('gpt-5.4')
    expect(managed.name).toBe('Native Title Fix')
  })

  it('keeps a title renamed during refresh and still cleans operation state', async () => {
    const { manager, managed, complete, persist } = setup()
    managed.name = 'Original'
    complete.mockImplementation(async () => { managed.name = 'Human rename'; return 'Native Title Fix' })
    expect(await manager.refreshTitle(managed.id, { onlyIfName: 'Original' })).toEqual({ success: false, error: 'Renamed meanwhile' })
    expect(managed.name).toBe('Human rename')
    expect(managed.isAsyncOperationOngoing).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it('initial generation never overwrites a human rename while awaiting completion', async () => {
    const { manager, managed, complete, persist } = setup()
    managed.autoTitle = managed.name = 'Original'
    complete.mockImplementation(async () => { managed.name = 'Human rename'; return 'Native Title Fix' })
    await (manager as any).generateTitle(managed, 'Fix title regeneration')
    expect(managed.name).toBe('Human rename')
    expect(persist).not.toHaveBeenCalled()
  })

  it('cleans flags and returns a safe failure when completion rejects', async () => {
    const { manager, managed, complete, persist } = setup()
    complete.mockRejectedValue(new Error('fixture-private-error'))
    const result = await manager.refreshTitle(managed.id)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain('fixture-private-error')
    expect(managed.isAsyncOperationOngoing).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })
})
