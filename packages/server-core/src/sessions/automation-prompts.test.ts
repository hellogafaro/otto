import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { createRoutine, getRoutine } from '@otto/shared/automations/routines'
import { SessionManager } from './session-manager.ts'

// Prompt actions of one automation event: a matcher's semanticCondition is judged once (its prompt
// actions all run or are all skipped), and prompts without a condition never wait for another check. Each
// outcome is a finished run of its routine (`routines_history`).
describe('automation prompt batches', () => {
  let tmpRoot: string
  let workspaceId: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-automation-prompts-'))
    saveConfig({ workspaces: [] })
    workspaceId = addWorkspace({ name: 'Prompts', rootPath: tmpRoot }).id
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  /** An event routine of the workspace: the id the matcher of its prompts carries. */
  const routine = (title: string) =>
    createRoutine({ workspaceId, title, config: { type: 'event', event: 'LabelAdd', actions: [{ type: 'prompt', prompt: 'x' }] }, createdBy: 'user:aaaaaaaaaaaa' }).id

  const pending = (matcherId: string, prompt: string, conditioned = false) => ({
    sessionId: undefined,
    matcherId,
    automationName: matcherId,
    prompt,
    ...(conditioned ? { semanticCondition: { question: 'Is the user reporting a bug?' }, event: 'LabelAdd', eventPayload: {} } : {}),
  })

  const history = async (routineId: string) => {
    // History writes are fire-and-forget; give them a moment to land.
    await new Promise(resolve => setTimeout(resolve, 20))
    return getRoutine(workspaceId, routineId)!.runs
  }

  it('judges a matcher once, so its prompt actions are all skipped together', async () => {
    let checks = 0
    ;(sm as any).shouldRunPromptAutomation = async () => { checks++; return { run: false, reason: 'condition not met' } }
    const started: string[] = []
    ;(sm as any).executePromptAutomation = async (opts: { prompt: string }) => { started.push(opts.prompt); return { sessionId: 's' } }

    const m1 = routine('m1')
    await (sm as any).runReadyPrompts(workspaceId, tmpRoot, [pending(m1, 'first', true), pending(m1, 'second', true)])

    expect(checks).toBe(1)
    expect(started).toEqual([])
    expect((await history(m1)).map(run => [run.status, run.error])).toEqual([
      ['skipped', 'condition not met'],
      ['skipped', 'condition not met'],
    ])
  })

  it('starts a prompt without a condition while another matcher is still being judged', async () => {
    let release!: () => void
    const judged = new Promise<void>(resolve => { release = resolve })
    ;(sm as any).shouldRunPromptAutomation = async (p: { semanticCondition?: unknown }) => {
      if (p.semanticCondition) await judged
      return { run: true }
    }
    const started: string[] = []
    ;(sm as any).executePromptAutomation = async (opts: { prompt: string }) => { started.push(opts.prompt); return { sessionId: `s-${opts.prompt}` } }

    const [slow, fast] = [routine('slow'), routine('fast')]
    const done = (sm as any).runReadyPrompts(workspaceId, tmpRoot, [pending(slow, 'conditioned', true), pending(fast, 'plain')])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(started).toEqual(['plain'])
    release()
    await done
    expect(started).toEqual(['plain', 'conditioned'])
    expect([...(await history(slow)), ...(await history(fast))].map(run => run.chatId).sort()).toEqual(['s-conditioned', 's-plain'])
  })
})
