import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NativeActionCardData } from '../native-action-card'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { NativeActionCard } = await import('../native-action-card')

const instruction = 'Review this exact action. Only a current human with authority over its target can approve it.'
const approval: NativeActionCardData = {
  id: 'existing-approval-id', kind: 'approval', status: 'pending', title: 'Allow the selected agent to run create_document?',
  summary: instruction, actorName: 'Fictional reviewer', resolvedAt: Date.UTC(2026, 9, 9, 10, 3),
}
function render(data: NativeActionCardData, canResolve = true) {
  return renderToStaticMarkup(<NativeActionCard data={data} canResolve={canResolve} onApprove={async () => {}} onDeny={async () => {}} />)
}

describe('status-aware built-in approval instructions', () => {
  it('keeps the instruction and existing actions for an eligible pending request', () => {
    const html = render(approval)
    expect(html).toContain(instruction)
    expect(html).toMatch(/<button\b[^>]*>Approve<\/button>/)
    expect(html).toMatch(/<button\b[^>]*>Deny<\/button>/)
  })

  it.each([
    ['resolving', 'Your decision is being recorded.'],
    ['approved', 'This action was approved. Approval alone does not confirm that it completed.'],
    ['denied', 'This action was denied and can no longer be approved.'],
    ['canceled', 'This request was canceled and can no longer be approved.'],
    ['expired', 'The run has ended. This request can no longer be approved.'],
    ['failed', 'This request ended without a confirmed result and can no longer be approved. Check its target before requesting another action.'],
  ] as const)('uses truthful nonactionable copy for %s without mutating the canonical data', (status, summary) => {
    const data = { ...approval, status }
    const before = JSON.stringify(data)
    const html = render(data)
    expect(html).toContain(summary)
    expect(html).not.toContain(instruction)
    expect(html).not.toMatch(/<button\b[^>]*>Approve<\/button>/)
    expect(html).not.toMatch(/<button\b[^>]*>Deny<\/button>/)
    if (status !== 'resolving') {
      expect(html).toContain('Fictional reviewer')
      expect(html).toMatch(/datetime="2026-10-09T10:03:00\.000Z"/i)
    }
    expect(JSON.stringify(data)).toBe(before)
  })

  it('preserves custom descriptive summaries and other card kinds', () => {
    const custom = 'Create the reviewed document in the existing folder.'
    expect(render({ ...approval, status: 'failed', summary: custom })).toContain(custom)
    for (const kind of ['question', 'artifact'] as const) expect(render({ ...approval, kind, status: 'failed' })).toContain(instruction)
  })

  it('keeps a pending read-only request nonactionable', () => {
    const html = render(approval, false)
    expect(html).toContain(instruction)
    expect(html).toContain('cannot resolve it')
    expect(html).not.toMatch(/<button\b[^>]*>Approve<\/button>/)
  })
})
