import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { 'common.copy': 'Copy', 'common.copied': 'Copied', 'chat.queuedBadge': 'Queued', 'turnCard.responding': 'Responding' } } } })
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { ResponseCard, TurnCard } = await import('../turn-card')
const { UserMessage } = await import('../user-message')

describe('official plain Message composition', () => {
  it.each([false, true])('uses a plain official surface and one accessible icon-only Copy action in compact=%s', compactMode => {
    const html = renderToStaticMarkup(<ResponseCard text="A **normal reply**." isStreaming={false} compactMode={compactMode} />)
    expect(html).toContain('data-slot="bubble"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-slot="bubble-content"')
    expect(html).toContain('data-slot="message-footer"')
    expect(html).toContain('aria-label="Copy"')
    expect(html).toContain('data-slot="tooltip-trigger"')
    expect(html).not.toMatch(/<span>Copy<\/span>|turn-action-btn|overflow-y-auto|max-height|mask-image/)
    expect(html).toMatch(/<strong\b[^>]*>normal reply<\/strong>/)
  })

  it('keeps all long ordinary reply text in the natural message surface', () => {
    const text = Array.from({ length: 55 }, (_, index) => `Paragraph ${index}: ${'Ordinary prose grows naturally. '.repeat(8)}`).join('\n\n')
    const html = renderToStaticMarkup(<ResponseCard text={text} isStreaming={false} />)
    expect(html).toContain('Paragraph 54:')
    expect(html).toContain('data-search-root="response"')
    expect(html).not.toMatch(/overflow-y-auto|max-height|mask-image/)
  })

  it('uses one official Marker/Spinner for actual streaming and no streaming surface on completion', () => {
    const text = 'A real streamed response with enough supplied words to pass the existing content buffer. '.repeat(7)
    const streaming = renderToStaticMarkup(<ResponseCard text={text} isStreaming streamStartTime={Date.now() - 5000} />)
    expect(streaming).toContain('data-slot="marker"')
    expect(streaming).toContain('data-slot="spinner"')
    expect(streaming).toContain('Responding')
    expect(streaming.match(/role="status"/g)).toHaveLength(1)
    const complete = renderToStaticMarkup(<ResponseCard text={text} isStreaming={false} />)
    expect(complete).not.toContain('data-slot="spinner"')
    expect(complete).not.toContain('Responding')
  })

  it('uses the authoritative queued flag rather than a lingering queued skin', () => {
    const queued = renderToStaticMarkup(<UserMessage content="A **person's message**." isQueued />)
    expect(queued).toContain('data-slot="bubble-group"')
    expect(queued).toContain('data-slot="bubble-content"')
    expect(queued).toContain('data-slot="message-footer"')
    expect(queued).toContain('data-slot="marker"')
    expect(queued).toContain('Queued')
    const delivered = renderToStaticMarkup(<UserMessage content="A person's message." isQueued={false} />)
    expect(delivered).not.toContain('Queued')
    expect(delivered).not.toContain('data-slot="spinner"')
  })

  it('keeps errors/disclosure and native history while using the official group and truthful working marker', () => {
    const working = renderToStaticMarkup(<TurnCard turnId="working" activities={[]} isComplete={false} isStreaming={false} />)
    expect(working).toContain('data-slot="message-group"')
    expect(working).toContain('data-slot="marker"')
    expect(working).toContain('data-slot="spinner"')
    const completed = renderToStaticMarkup(<TurnCard turnId="failed" activities={[{ id: 'failed-row', type: 'tool', status: 'error', timestamp: 1, toolName: 'task_create', error: 'Fictional failure.' }]} isComplete isStreaming={false} defaultExpanded />)
    expect(completed).toContain('Worked · 1 failed')
    expect(completed).toContain('Create task')
    expect(completed).not.toContain('data-slot="spinner"')
    expect(completed).not.toMatch(/lucide-arrow-up-right|lucide-more-horizontal/)
  })
})
