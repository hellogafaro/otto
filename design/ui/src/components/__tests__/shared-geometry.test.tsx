import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { Composer, ComposerInput } from '../composer'
import { ComposerFooter } from '../composer-footer'
import { PageCard } from '../page'
import { ListCard, ListGroup } from '../list-group'
import { GalleryItem, GalleryItemSkeleton } from '../gallery'
import { AlertDialogHeader, AlertDialogFooter } from '../alert-dialog'

describe('shared surface and optical rails', () => {
  it('clears scrolling content at the measured whole-dock boundary', () => {
    const css = readFileSync(new URL('../../styles/globals.css', import.meta.url), 'utf8')
    const frame = readFileSync(new URL('../page-frame.tsx', import.meta.url), 'utf8')
    expect(frame).toContain('"--composer-slot-height": `${composerHeight}px`')
    expect(css.match(/transparent calc\(100% - var\(--composer-slot-height, 0px\)\)/g)).toHaveLength(2)
    expect(frame).toContain('pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))]')
  })

  it('keeps the footer rail at 28px controls plus 4px top padding without an entity slot', () => {
    const html = renderToStaticMarkup(createElement(ComposerFooter, {
      picker: createElement('button', null, 'Recipient'),
      participants: createElement('button', null, 'People'),
    }))
    expect(html).toContain('min-h-8')
    expect(html).toContain('px-4 pt-1 pb-0')
    expect(html).not.toContain('composer-footer-context')
    expect(html).toContain('flex shrink-0 items-center')
  })

  it('uses one max-width/text-inset/outset contract for columns, surfaces, composer and transcript', () => {
    const css = readFileSync(new URL('../../styles/globals.css', import.meta.url), 'utf8')
    expect(css).toContain('--page-content-max: 48rem')
    expect(css).toContain('--page-text-inset: 1.5rem')
    expect(css).toContain('--page-surface-outset: 1rem')
    expect(css).toContain('padding-inline: calc(var(--page-text-inset) - var(--page-surface-outset))')
    expect(css).toContain('[data-slot="chat-transcript"]')
    expect(css).toContain('max-width: calc(var(--page-content-max) - 2 * (var(--page-text-inset) - var(--page-surface-outset)))')
  })

  it('keeps a layered composer shadow, 8px insets and smaller scoped controls', () => {
    const html = renderToStaticMarkup(createElement(Composer, null, createElement(ComposerInput, null, 'Draft')))
    expect(html).toContain('rounded-lg')
    expect(html).toContain('shadow-sm shadow-black/15 dark:shadow-black/35')
    expect(html).toContain('flex w-full flex-col gap-1 p-2')
    expect(html).not.toContain('overflow-y-auto px-2 pt-2')
  })

  it('keeps inner cards while grouped lists are plain and their headers only collapse', () => {
    const card = renderToStaticMarkup(createElement(PageCard, null, 'Settings'))
    const list = renderToStaticMarkup(createElement(ListCard, null, createElement(ListGroup, { label: 'Chats', count: 1, children: 'Row' })))
    expect(card).toContain('card-surface rounded-md bg-card')
    expect(list).not.toContain('card-surface')
    expect(list).toContain('data-slot="list-card"')
    expect(list).toContain('px-4 text-left')
    expect(list).not.toContain('pr-10')
  })

  it('owns the entire caption and loading title inset in the Gallery primitive', () => {
    const item = renderToStaticMarkup(createElement(GalleryItem, { title: 'Fictional file' }))
    const skeleton = renderToStaticMarkup(createElement(GalleryItemSkeleton))
    expect(item).toContain('flex h-5 min-w-0 items-center gap-2 px-4')
    expect(skeleton).toContain('flex h-5 items-center px-4')
  })
})

describe('stock confirmation composition', () => {
  it('keeps title/description left aligned and stock responsive footer order', () => {
    const header = renderToStaticMarkup(createElement(AlertDialogHeader, null, 'Title'))
    const footer = renderToStaticMarkup(createElement(AlertDialogFooter, null, 'Cancel', 'Delete'))
    expect(header).toContain('flex flex-col gap-2 text-left')
    expect(header).not.toContain('place-items-center')
    expect(footer).toContain('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end')
  })

  it('reuses the existing nested dialog state for shielding and removes the decorative API', () => {
    const alert = readFileSync(new URL('../alert-dialog.tsx', import.meta.url), 'utf8')
    const dialog = readFileSync(new URL('../dialog.tsx', import.meta.url), 'utf8')
    expect(alert).not.toContain('AlertDialogMedia')
    expect(alert).toContain('data-nested-dialog-open:pointer-events-none')
    expect(dialog).toContain('data-nested-dialog-open:pointer-events-none')
    expect(alert).not.toContain('forceRender')
  })
})
