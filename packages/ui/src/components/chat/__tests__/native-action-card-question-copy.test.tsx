import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NativeActionCardData } from '../native-action-card'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { NativeActionCard } = await import('../native-action-card')

const instruction = 'Answer this question to continue the current run.'
const question: NativeActionCardData = {
  id: 'existing-question-id', kind: 'question', status: 'pending', title: 'Which reviewed option should we use?',
  summary: instruction, details: 'Keep the original question details.',
  choices: [{ label: 'First', description: 'Original first option.' }, { label: 'Second', description: 'Original second option.' }],
  actorName: 'Fictional reviewer', resolvedAt: Date.UTC(2026, 9, 8, 10),
}
function render(data: NativeActionCardData, canResolve = true) {
  return renderToStaticMarkup(<NativeActionCard data={data} canResolve={canResolve} onAnswer={async () => {}} />)
}

describe('status-aware built-in question instructions', () => {
  it.each(['pending', 'resolving'] as const)('retains the live instruction for %s questions', status => {
    expect(render({ ...question, status })).toContain(instruction)
  })

  it.each([
    ['approved', 'Your answer was recorded.', 'Answered'],
    ['expired', 'The run has ended. This question can no longer be answered.', 'Expired'],
    ['denied', 'This question was declined and can no longer be answered.', 'Denied'],
    ['canceled', 'This question was canceled and can no longer be answered.', 'Canceled'],
    ['failed', 'This question failed and can no longer be answered.', 'Failed'],
  ] as const)('uses truthful historical copy for %s questions without changing their data', (status, summary, label) => {
    const data = { ...question, status }
    const before = JSON.stringify(data)
    const html = render(data)
    expect(html).toContain(summary)
    expect(html).toContain(label)
    expect(html).toContain(question.title)
    expect(html).toContain('Fictional reviewer')
    expect(html).toMatch(/datetime="2026-10-08T10:00:00\.000Z"/i)
    expect(html).toContain('Details')
    expect(html).not.toContain(instruction)
    expect(html).not.toContain('Send answer')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('role="radio"')
    expect(html).not.toContain('role="checkbox"')
    expect(JSON.stringify(data)).toBe(before)
  })

  it('does not replace custom question content or nonquestion summaries', () => {
    const custom = 'Keep the **original context** for this question.'
    expect(render({ ...question, status: 'expired', summary: custom })).toMatch(/<strong\b[^>]*>original context<\/strong>/)
    for (const kind of ['approval', 'artifact'] as const) expect(render({ ...question, kind, status: 'approved' })).toContain(instruction)
  })

  it('does not make pending read-only questions actionable or change their instruction', () => {
    const html = render(question, false)
    expect(html).toContain(instruction)
    expect(html).toContain('cannot resolve it')
    expect(html).not.toContain('Send answer')
  })
})
