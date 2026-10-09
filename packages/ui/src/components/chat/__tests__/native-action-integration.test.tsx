import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { messageToStored, storedToMessage, type Message, type NativeActionData } from '@otto/core'
import { deriveTurnPhase, groupMessagesByTurn, shouldShowThinkingIndicator, type AssistantTurn } from '../turn-utils'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { TurnCard } = await import('../turn-card')

const action: NativeActionData = {
  id: 'tool-call-1', kind: 'approval', status: 'pending', title: 'Update the brief',
  summary: 'Apply the reviewed change.', details: 'Keep the existing document.',
  eligibleActors: ['user:viewer', 'user:other-viewer'], runId: 'run-1', payloadHash: 'hash-1',
}
const message: Message = {
  id: 'row-1', role: 'tool', content: 'RAW_PRIVATE_RESULT', toolResult: 'RAW_PRIVATE_RESULT',
  toolInput: { secret: 'RAW_PRIVATE_INPUT' }, toolIntent: 'RAW_PRIVATE_INTENT',
  toolUseId: action.id, toolName: 'library_update', toolStatus: 'pending', timestamp: 2,
  nativeAction: action, turnId: 'turn-1', author: 'agent:agent-1',
}
function turnFor(nativeAction = action, processing = true) {
  return groupMessagesByTurn([storedToMessage(messageToStored({ ...message, nativeAction }))], { isSessionProcessing: processing })[0] as AssistantTurn
}
function render(nativeAction = action, actor = 'user:viewer', enabled = true) {
  const turn = turnFor(nativeAction, enabled)
  return renderToStaticMarkup(<TurnCard {...turn} sessionId="chat-1" nativeActionActor={actor} nativeActionsEnabled={enabled} onRespondToNativeApproval={async () => {}} />)
}

describe('canonical native actions in real TurnCard', () => {
  it('keeps the stored projection, exact tool-call identity and safe details on reload', () => {
    const turn = turnFor()
    expect(turn.activities[0]?.nativeAction).toEqual(action)
    expect(turn.activities[0]?.toolUseId).toBe(action.id)
    expect(turn.activities[0]?.toolInput).toBeUndefined()
    expect(turn.activities[0]?.content).toBe(action.summary)
    const html = render()
    expect(html).toContain('Update the brief')
    expect(html).toContain('Awaiting approval')
    expect(html).toContain('Approve')
    expect(html).not.toContain('RAW_PRIVATE')
    expect(JSON.stringify(turn)).not.toContain('RAW_PRIVATE')
    expect(html).not.toContain('Thinking...')
    expect(html).not.toContain('Preparing response...')
  })

  it('allows either eligible human viewer but not an owner fallback, an agent, or a stopped run', () => {
    expect(render(action, 'user:other-viewer')).toContain('Approve')
    for (const actor of ['user:unknown-owner', 'agent:agent-1', '']) {
      const html = render(action, actor)
      expect(html).not.toContain('>Approve<')
      expect(html).toContain('cannot resolve it')
    }
    expect(render(action, 'user:viewer', false)).not.toContain('>Approve<')
  })

  it('renders terminal canonical updates in both viewers without raw activity or action controls', () => {
    for (const status of ['approved', 'denied', 'canceled', 'expired', 'failed'] as const) {
      for (const actor of ['user:viewer', 'user:other-viewer']) {
        const html = render({ ...action, status, actorName: 'Reviewer', actorId: 'user:viewer', resolvedAt: 1000 }, actor)
        expect(html).not.toContain('>Approve<')
        expect(html).not.toContain('RAW_PRIVATE')
        expect(html).toContain('Reviewer')
      }
    }
  })

  it('preserves transcript order while keeping native cards outside the default-closed activity fold', () => {
    const messages: Message[] = [
      { id: 'before', role: 'tool', toolUseId: 'before-tool', toolName: 'Read', toolStatus: 'completed', toolIntent: 'Earlier activity', content: '', timestamp: 1, turnId: 'turn-1' },
      message,
      { id: 'after', role: 'tool', toolUseId: 'after-tool', toolName: 'Read', toolStatus: 'completed', toolIntent: 'Later activity', content: '', timestamp: 3, turnId: 'turn-1' },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: true })[0] as AssistantTurn
    const html = renderToStaticMarkup(<TurnCard {...turn} nativeActionActor="user:viewer" nativeActionsEnabled onRespondToNativeApproval={async () => {}} />)
    expect(turn.activities.map(activity => activity.toolUseId)).toEqual(['before-tool', action.id, 'after-tool'])
    expect(html).not.toContain('Earlier activity')
    expect(html).not.toContain('Later activity')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Update the brief')
    expect(html.match(/Awaiting approval/g)).toHaveLength(1)
    const expanded = renderToStaticMarkup(<TurnCard {...turn} defaultExpanded nativeActionActor="user:viewer" nativeActionsEnabled onRespondToNativeApproval={async () => {}} />)
    expect(expanded).toContain('Earlier activity')
    expect(expanded).toContain('Later activity')
    expect(expanded).toContain('Update the brief')
  })

  it('uses awaiting phases without a work indicator and leaves questions read-only without a trusted answer callback', () => {
    expect(deriveTurnPhase(turnFor())).toBe('approval')
    expect(shouldShowThinkingIndicator('approval', true)).toBe(false)
    const question = { ...action, kind: 'question' as const, choices: [{ label: 'A' }] }
    expect(deriveTurnPhase(turnFor(question))).toBe('answer')
    expect(shouldShowThinkingIndicator('answer', true)).toBe(false)
    const html = render(question)
    expect(html).toContain('Awaiting answer')
    expect(html).not.toContain('Send answer')
    const questionTurn = turnFor(question)
    const actionable = renderToStaticMarkup(<TurnCard {...questionTurn} nativeActionActor="user:viewer" nativeActionsEnabled onRespondToNativeQuestion={async () => {}} />)
    expect(actionable).toContain('Send answer')
    const stale = renderToStaticMarkup(<TurnCard {...questionTurn} nativeActionActor="user:viewer" nativeActionRunId="different-run" nativeActionsEnabled onRespondToNativeQuestion={async () => {}} />)
    expect(stale).not.toContain('Send answer')
  })

  it('keeps matching legacy permission fallback and credential flow behind live capability', () => {
    const source = readFileSync(new URL('../../../../../../apps/electron/src/renderer/components/app-shell/chat-display.tsx', import.meta.url), 'utf8')
    expect(source).toContain('features.durableRequests')
    expect(source).toContain('message.toolUseId === pendingPermission.requestId')
    expect(source).toContain('if (pendingPermission && !hasInlinePermission)')
    expect(source).toContain("return { type: 'credential', data: pendingCredential }")
    expect(source).toContain('await onRespondToPermission(session.id, toolUseId, allowed, false)')
    expect(source).toContain('await window.electronAPI.respondToNativeQuestion(session.id, toolUseId, answer)')
    expect(source).toContain("throw new Error('Could not submit your response.')")
    const app = readFileSync(new URL('../../../../../../apps/electron/src/renderer/app.tsx', import.meta.url), 'utf8')
    expect(app).toContain('queue.filter(request => request.requestId !== requestId)')
    expect(app).toContain('return success')
  })

  it('retains canonical approval while exposing a later safe execution failure', () => {
    const failed = { ...message, nativeAction: { ...action, status: 'approved' as const, actorName: 'Fictional reviewer', resolvedAt: 1000 }, toolStatus: 'error' as const, isError: true, content: 'RAW_PRIVATE_FAILURE', toolResult: 'RAW_PRIVATE_FAILURE' }
    const turn = groupMessagesByTurn([storedToMessage(messageToStored(failed))], { isSessionProcessing: false })[0] as AssistantTurn
    expect(turn.activities[0]?.status).toBe('error')
    expect(turn.activities[0]?.nativeAction?.status).toBe('approved')
    expect(turn.activities[0]?.error).toBeUndefined()
    const html = renderToStaticMarkup(<TurnCard {...turn} nativeActionActor="user:viewer" nativeActionsEnabled onRespondToNativeApproval={async () => {}} />)
    expect(html).toContain('Approved')
    expect(html).toContain('Fictional reviewer')
    expect(html).toContain('The approved action failed.')
    expect(html).not.toContain('RAW_PRIVATE')
  })
})
