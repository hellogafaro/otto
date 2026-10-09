import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { 'common.copy': 'Copy', 'plan.acceptPlan': 'Accept plan', 'plan.accept': 'Accept' } } } })
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'fixture-pdf-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
const { ResponseCard } = await import('../turn-card')
const turnSource = readFileSync(new URL('../turn-card.tsx', import.meta.url), 'utf8')
const displaySource = readFileSync(new URL('../../../../../../apps/electron/src/renderer/components/app-shell/chat-display.tsx', import.meta.url), 'utf8')
const viewerSource = readFileSync(new URL('../session-viewer.tsx', import.meta.url), 'utf8')
const platformSource = readFileSync(new URL('../../../context/platform-context.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../../../../apps/electron/src/renderer/app.tsx', import.meta.url), 'utf8')
const librarySource = readFileSync(new URL('../../../../../../apps/electron/src/renderer/pages/library/file-preview.tsx', import.meta.url), 'utf8')

describe('retired chat branch and reply-source actions', () => {
  it('removes every renderer create-branch callback and response-source contract', () => {
    for (const source of [turnSource, displaySource, viewerSource, platformSource]) {
      expect(/onBranch|BranchDropdown|GitBranch|branchFromMessageId|branchFromSessionId|supportsBranching|onPopOut|onOpenMarkdownPreview|forceCodeView|response\.md|isFullscreen|setIsFullscreen/.test(source)).toBe(false)
      const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      expect((file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics).toHaveLength(0)
    }
    expect(turnSource).not.toContain('DocumentFormattedMarkdownOverlay')
  })

  it('renders ordinary response Markdown and icon Copy, without source, fullscreen, or branch controls', () => {
    const html = renderToStaticMarkup(<ResponseCard text="A **normal reply**." isStreaming={false} />)
    expect(html).toMatch(/<strong\b[^>]*>normal reply<\/strong>/)
    expect(html).toContain('aria-label="Copy"')
    expect(html.match(/<button\b/g)?.length).toBe(1)
    expect(html).not.toMatch(/Markdown<|Branch|Fullscreen|role="dialog"/)
    expect(turnSource).toContain('await navigator.clipboard.writeText(text)')
  })

  it('preserves plan acceptance and inline annotation contracts while retiring plan source/branch controls', () => {
    const html = renderToStaticMarkup(<ResponseCard text="Plan **steps**." isStreaming={false} variant="plan" onAccept={() => {}} onAcceptWithCompact={() => {}} />)
    expect(html).toMatch(/<strong\b[^>]*>steps<\/strong>/)
    expect(html).toContain('Accept plan')
    expect(html).toContain('aria-label="Copy"')
    expect(html.match(/<button\b/g)?.length).toBe(2)
    for (const contract of ['onAddAnnotation', 'onRemoveAnnotation', 'onUpdateAnnotation', 'onSaveAndSendFollowUp', 'AnnotationOverlayLayer', 'openAnnotationRequest']) expect(turnSource).toContain(contract)
  })

  it('keeps compact icon Copy and genuine file viewers without reviving tool-detail entrypoints', () => {
    const html = renderToStaticMarkup(<ResponseCard text="A **compact reply**." isStreaming={false} compactMode />)
    expect(html).toMatch(/<strong\b[^>]*>compact reply<\/strong>/)
    expect(html).toContain('aria-label="Copy"')
    for (const viewer of ['CodePreviewOverlay', 'DocumentFormattedMarkdownOverlay', 'ImagePreviewOverlay']) expect(appSource).toContain(viewer)
    expect(librarySource).toContain('DialogContent')
    expect(librarySource).toContain('FileContent')
    expect(turnSource).not.toMatch(/onOpenDetails|onOpenActivityDetails|TurnCardActionsMenu/)
  })
})
