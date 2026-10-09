import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageHeaderRow } from '../../../../../../../design/ui/src/components/page-frame'
import { PageTitle } from '../../../../../../../design/ui/src/components/page-title'

describe('shared header alignment', () => {
  it('centers compact title, leading control and actions in the actual token-sized row', () => {
    const html = renderToStaticMarkup(createElement(PageHeaderRow, {
      density: 'compact', title: 'Conversation title',
      leading: createElement('button', null, 'Menu'), actions: createElement('button', null, 'More'),
    }))
    expect(html).toContain('flex items-center gap-1 select-none')
    expect(html).toContain('min-h-(--header-compact) py-(--header-gap) md:px-6')
    expect(html).not.toContain('mt-(--header-gap)')
    expect(html).not.toContain('mb-(--header-gap)')
    expect(html).not.toContain('flex-col')
    expect(html).not.toContain('justify-center')
    expect(html).toContain('whitespace-nowrap')
    expect(html).toContain('mask-image:linear-gradient')
  })

  it('keeps the roomy row inset and leaves intentional centered PageTitle variants alone', () => {
    const html = renderToStaticMarkup(createElement(PageHeaderRow, { title: 'Page title' }))
    expect(html).toContain('mt-(--nav-top-roomy) h-8')
    expect(html).toContain('px-4')
    expect(html).not.toContain('min-h-(--header-compact)')
    const greeting = renderToStaticMarkup(createElement(PageTitle, { className: 'text-center' }, 'Greeting'))
    expect(greeting).toContain('text-lg font-medium text-center')
  })
})
