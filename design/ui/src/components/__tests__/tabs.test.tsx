import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs'

function renderTabs(className?: string, size: 'default' | 'compact' = 'default', orientation: 'horizontal' | 'vertical' = 'horizontal') {
  return renderToStaticMarkup(
    <Tabs defaultValue="all" size={size} orientation={orientation}>
      <TabsList className={className} aria-label="Library items">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="all">All items</TabsContent>
      <TabsContent value="files">Files only</TabsContent>
      <TabsContent value="documents">Documents only</TabsContent>
    </Tabs>,
  )
}

function listClass(html: string) {
  const tag = html.match(/<[^>]*data-slot="tabs-list"[^>]*>/)?.[0]
  if (!tag) throw new Error('TabsList is missing')
  return tag.match(/class="([^"]*)"/)?.[1].split(' ') ?? []
}

describe('shared tablist horizontal padding', () => {
  it('has zero horizontal padding without page overrides', () => {
    expect(listClass(renderTabs())).toContain('px-0')
  })

  it.each(['px-1', 'px-3 pl-2 pr-4', 'p-3', 'py-2 px-4'])('overrides horizontal instance padding in %s', (className) => {
    const classes = listClass(renderTabs(className))
    expect(classes).toContain('px-0')
    expect(classes).not.toContain('px-1')
    expect(classes).not.toContain('px-3')
    expect(classes).not.toContain('px-4')
    expect(classes).not.toContain('pl-2')
    expect(classes).not.toContain('pr-4')
  })

  it('retains vertical instance padding for horizontal and vertical lists', () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      expect(listClass(renderTabs('p-3', 'default', orientation))).toContain('p-3')
      expect(listClass(renderTabs('py-2 px-4', 'default', orientation))).toContain('py-2')
      expect(listClass(renderTabs('py-2 px-4', 'default', orientation))).toContain('px-0')
    }
  })

  it('preserves three tab controls, selection semantics, trigger spacing, and focus styles at both sizes', () => {
    for (const size of ['default', 'compact'] as const) {
      const html = renderTabs('px-1', size)
      expect(html.match(/role="tab"/g)?.length).toBe(3)
      expect(html).toContain('role="tablist"')
      expect(html).toContain('aria-label="Library items"')
      expect(html).toContain('aria-selected="true"')
      expect(html).toContain('data-size="' + size + '"')
      expect(html).toContain('px-3')
      expect(html).toContain('group-data-[size=compact]/tabs:px-2.5')
      expect(html).toContain('focus-visible:ring-2')
      expect(html).toContain('focus-visible:ring-inset')
      expect(html).toContain('h-8')
      expect(html).toContain('group-data-[size=compact]/tabs:h-7')
    }
  })
})
