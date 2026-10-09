import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityItem, TurnCardProps } from '../turn-card'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { 'common.copy': 'Copy' } } } })

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { TurnCard } = await import('../turn-card')

const ordinary: ActivityItem = { id: 'read-1', type: 'tool', status: 'completed', timestamp: 1, toolName: 'library_read_document', toolUseId: 'read-call', intent: 'Read the existing brief', toolInput: { private: 'RAW_PRIVATE_INPUT' } }
const approval: ActivityItem = { id: 'approval-row', type: 'tool', status: 'running', timestamp: 2, toolName: 'task_create', toolUseId: 'approval-call', nativeAction: { id: 'approval-call', runId: 'run-1', payloadHash: 'fixture-hash', eligibleActors: ['user:viewer'], kind: 'approval', status: 'pending', title: 'Create reviewed task', summary: 'Create the approved task in the existing project.' } }
function render(activities: ActivityItem[], options: Partial<TurnCardProps> = {}) {
  return renderToStaticMarkup(<TurnCard turnId="turn-1" activities={activities} isStreaming={false} isComplete={false} nativeActionActor="user:viewer" nativeActionRunId="run-1" nativeActionsEnabled onRespondToNativeApproval={async () => {}} {...options} />)
}

describe('quiet native activity presentation', () => {
  it('defaults ordinary completed activity closed and exposes the inline approval once', () => {
    const html = render([ordinary, approval])
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Read the existing brief')
    expect(html).toContain('Create reviewed task')
    expect(html.match(/Awaiting approval/g)).toHaveLength(1)
    expect(html).toContain('>Approve<')
    expect(html).not.toMatch(/Thinking|Preparing response|RAW_PRIVATE_INPUT/)
  })

  it('uses informative real tool labels without raw inputs or detail openings', () => {
    const html = render([ordinary], { isComplete: true, defaultExpanded: true })
    expect(html).toContain('Read document')
    expect(html).toContain('Read the existing brief')
    expect(html).not.toContain('RAW_PRIVATE_INPUT')
    expect(html).not.toContain('library_read_document')
    expect(html).toContain('Worked')
  })

  it('keeps resolving and historical terminal cards outside the fold', () => {
    const resolving = render([ordinary, { ...approval, nativeAction: { ...approval.nativeAction!, status: 'resolving' } }])
    expect(resolving.match(/Resolving/g)).toHaveLength(1)
    expect(resolving).not.toContain('Awaiting approval')
    const approved = render([ordinary, { ...approval, nativeAction: { ...approval.nativeAction!, status: 'approved', actorName: 'Fictional reviewer', resolvedAt: 1000 } }], { isComplete: true })
    expect(approved).toContain('Approved')
    expect(approved).toContain('Fictional reviewer')
    expect(approved).toContain('<time')
    expect(approved).not.toContain('Read the existing brief')
  })

  it('shows visible failures even when every ordinary tool failed', () => {
    const html = render([{ ...ordinary, status: 'error', error: 'Fixture read failed' }], { isComplete: true })
    expect(html).toContain('Worked · 1 failed')
    expect(html).toContain('aria-expanded="false"')
  })

  it('uses a supplied current action or one official Working marker without invented elapsed time', () => {
    expect(render([{ ...ordinary, status: 'running' }])).toContain('Read the existing brief')
    const fallback = render([])
    expect(fallback.match(/Working/g)).toHaveLength(1)
    expect(fallback).toContain('role="status"')
    expect(fallback).toContain('data-slot="marker"')
    expect(fallback).toContain('data-slot="spinner"')
    expect(fallback).not.toMatch(/Thinking|Preparing|Worked for/)
  })

  it('retains the visible saved-result card and original Library identity', () => {
    const html = render([{ ...approval, nativeAction: { ...approval.nativeAction!, kind: 'artifact', status: 'approved', artifact: { type: 'library', id: 'original-library-id', title: 'Reviewed brief' } } }], { isComplete: true, onOpenNativeArtifact: () => {} })
    expect(html).toContain('Reviewed brief')
    expect(html).toContain('Created')
    expect(html).not.toContain('aria-expanded="false"')
  })

  it('shows an answer request once without a duplicate parent waiting label', () => {
    const html = render([ordinary, { ...approval, nativeAction: { ...approval.nativeAction!, kind: 'question' } }], { onRespondToNativeQuestion: async () => {} })
    expect(html.match(/Awaiting answer/g)).toHaveLength(1)
    expect(html).toContain('Your answer')
    expect(html).not.toContain('Read the existing brief')
  })

  it('keeps normal reply Markdown and Copy after the completed activity disclosure', () => {
    const html = render([ordinary], { isComplete: true, response: { text: 'A **normal reply**.', isStreaming: false } })
    expect(html).toMatch(/<strong\b[^>]*>normal reply<\/strong>/)
    expect(html).toContain('Copy')
    expect(html).not.toContain('Read the existing brief')
  })

  it('distinguishes approval from a later execution failure without exposing raw diagnostics', () => {
    const html = render([ordinary, { ...approval, status: 'error', error: 'RAW_PRIVATE_EXECUTION_ERROR', content: 'RAW_PRIVATE_TOOL_RESULT', nativeAction: { ...approval.nativeAction!, status: 'approved', actorName: 'Fictional reviewer', resolvedAt: 1000 } }], { isComplete: true })
    expect(html).toContain('Approved')
    expect(html).toContain('Fictional reviewer')
    expect(html).toContain('<time')
    expect(html).toContain('The approved action failed.')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Worked · 1 action')
    expect(html).not.toContain('RAW_PRIVATE')
  })
})
