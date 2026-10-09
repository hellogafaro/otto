import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, existsSync } from 'node:fs'
import { PageFrame } from '../page-frame'
import { PageNavigationButtons } from '../page-navigation'
import { Sidecar } from '../sidecar'

describe('rounded shell panel', () => {
  it('keeps content, composer and details inside one shared panel without floating navigation', () => {
    const html = renderToStaticMarkup(createElement(PageFrame, {
      asideOpen: true,
      aside: createElement(Sidecar, { open: true, onOpenChange: () => {}, title: 'Details' }, 'Details content'),
      composer: createElement('div', { 'data-slot': 'composer' }, 'Draft'),
    }, 'Page content'))
    expect(html).toContain('rounded-xl border border-border bg-background')
    expect(html).toContain('data-panel-id="page-content"')
    expect(html).toContain('data-panel-id="page-details"')
    expect(html).toContain('aria-label="Resize details"')
    expect(html.match(/data-slot="page-composer-fade"/g)).toHaveLength(1)
    expect(html).not.toContain('floating-nav')
    expect(html).not.toMatch(/\bborder-b(?:\s|")/)
    expect(existsSync(new URL('../floating-nav.tsx', import.meta.url))).toBe(false)
  })

  it('keeps existing navigation labels, disabled states and non-submit controls', () => {
    let called = false
    const html = renderToStaticMarkup(createElement(PageNavigationButtons, {
      back: { label: 'Back', onClick: () => { called = true } },
      next: { label: 'Next', onClick: () => { called = true }, disabled: true },
    }))
    expect(html).toContain('data-slot="page-navigation-buttons"')
    expect(html).toContain('aria-label="Back"')
    expect(html).toContain('aria-label="Next"')
    expect(html).toContain('type="button"')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('flex-col')
    expect(called).toBe(false)
  })

  it('uses an in-panel details surface, not an absolute overlaid card', () => {
    const html = renderToStaticMarkup(createElement(Sidecar, { open: true, onOpenChange: () => {}, title: 'Details' }, 'Properties'))
    expect(html).toContain('flex h-full min-h-0 w-full flex-col overflow-hidden')
    expect(html).not.toContain('absolute')
    expect(html).not.toContain('shadow')
    expect(html).not.toContain('border-b')
  })

  it('scopes Home glass to the panel and shares footer/toast spacing without sidebar shadows', () => {
    const css = readFileSync(new URL('../../styles/globals.css', import.meta.url), 'utf8')
    expect(css).toContain('html[data-wallpaper] [data-slot="page-frame"]')
    expect(css).not.toContain('html[data-wallpaper] [data-slot="sidebar-inner"]')
    expect(css).toContain('[data-slot="sidebar"] {\n  box-shadow: none;')
    expect(css).toContain('margin-top: 0;')
    expect(css).toContain('padding: 0.5rem;')
    expect(css).toContain('border-radius: var(--radius-xl);')
    expect(css).toContain('border: 1px solid var(--border);')
    const frame = readFileSync(new URL('../page-frame.tsx', import.meta.url), 'utf8')
    const sonner = readFileSync(new URL('../sonner.tsx', import.meta.url), 'utf8')
    expect(frame).toContain('window.innerHeight - composerSlot.getBoundingClientRect().top')
    expect(frame).toContain("root.style.setProperty('--toast-clearance'")
    expect(sonner).toContain('calc(var(--toast-clearance, 0px) + 3 * var(--shell-inset, 8px))')
  })
})
