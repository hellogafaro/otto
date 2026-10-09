import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import { RichBlockShell } from '../rich-block-shell'
import { TiptapHoverActions } from '../tiptap-hover-actions'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('../tiptap-editor.css')
const editor = read('../tiptap-markdown-editor.tsx')
const officialCss = read('../../../../../../design/ui/src/styles/typeset.css')
const parsed = postcss.parse(css)

describe('Tiptap Typeset presentation', () => {
  it('activates the official preset only on the editor prose DOM, without a reading-width cap', () => {
    expect(editor).toContain("class: 'tiptap-prose typeset typeset-docs outline-none'")
    expect(editor).toContain("<div className={cn('tiptap-editor', className)}>")
    expect(editor).not.toContain('37em')
    expect(css).not.toContain('37em')
    expect(createHash('sha256').update(officialCss).digest('hex'))
      .toBe('f70fb9750ffc48355ffa84c6d338dff866441a84f838901fa5739e148eea1be5')
  })

  it('removes the previous paragraph, heading, list, quote, inline-code and pre typography', () => {
    const legacySelectors = new Set(['p', 'h1', 'h2', 'h3', 'strong', 'em', 's', 'ul', 'ol', 'li', 'li > p', 'blockquote', 'code', 'pre', 'pre code', 'hr', '> :first-child'])
    const remaining: string[] = []
    parsed.walkRules(rule => {
      const prefix = '.tiptap-editor .tiptap-prose '
      if (rule.selector.startsWith(prefix) && legacySelectors.has(rule.selector.slice(prefix.length))) remaining.push(rule.selector)
    })
    expect(remaining).toEqual([])
    expect(officialCss).toContain('overflow-x: auto')
    expect(officialCss).toContain('font-family: var(--typeset-font-mono)')
  })

  it('keeps only table-width and node-view paragraph/flow adapters, not old cell typography', () => {
    const table: Record<string, string> = {}
    parsed.walkRules('.tiptap-editor .tiptap-prose table', rule => {
      rule.walkDecls(decl => { table[decl.prop] = decl.value })
    })
    expect(table).toEqual({ width: '100%' })
    expect(css).toContain('--tiptap-list-indent: 1.5em')
    expect(css).toContain('margin-block-start: var(--typeset-flow)')
    expect(css).toContain('.tiptap-editor .tiptap-prose :is(th, td) > p:first-child')
    expect(css).not.toContain('padding: 0.25rem 0.5rem')
    expect(css).not.toContain('line-height: 1.625')
  })

  it('excludes non-prose interactive controls and rich embeds from Typeset descendant styles', () => {
    const actions = renderToStaticMarkup(React.createElement(TiptapHoverActions, null,
      React.createElement('button', { type: 'button', 'aria-label': 'Copy code' }, 'Copy')))
    expect(actions).toContain('data-not-typeset="true"')
    expect(actions).toContain('contentEditable="false"')
    expect(actions).toContain('font-sans')
    expect(actions).toContain('aria-label="Copy code"')
    const embed = renderToStaticMarkup(React.createElement(RichBlockShell, null,
      React.createElement('iframe', { title: 'Unmodified embed' })))
    expect(embed).toContain('group not-typeset')
    expect(embed).toContain('<iframe title="Unmodified embed"')
    expect(read('../extensions/animated-task-item.ts')).toContain("checkboxWrapper.dataset.notTypeset = ''")
  })

  it('preserves placeholder, selected-node highlights, links and Shiki dual-theme rules', () => {
    expect(css).toContain('content: attr(data-placeholder)')
    expect(css).toContain('.tiptap-editor .tiptap-prose ::selection')
    expect(css).toContain('.tiptap-image-block.ProseMirror-selectednode')
    expect(css).toContain('.tiptap-mathematics-render--editable.is-selected')
    expect(css).toContain('color: var(--shiki-dark) !important')
    expect(css).toContain('color: var(--primary)')
    expect(css).toContain('text-underline-offset: 2px')
    expect(editor).toContain('if (editor.isFocused) return')
    expect(editor).toContain('if (md === reportedRef.current) return')
  })
})
