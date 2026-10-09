import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { CircleCheck, type LucideIcon } from 'lucide-react'
import { Count } from '@workspace/ui/components/count'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@workspace/ui/components/empty'
import { ListRowSkeleton } from '@workspace/ui/components/list-group'
import { PageCard, PageColumn, PageSection } from '@workspace/ui/components/page'
import { PageFrame } from '@workspace/ui/components/page-frame'

const cardsSource = readFileSync(new URL('../home-cards.tsx', import.meta.url), 'utf8')
const homeSource = readFileSync(new URL('../home-page.tsx', import.meta.url), 'utf8')
const frameSource = readFileSync(new URL('../../../../../../../design/ui/src/components/page-frame.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../../../../../../design/ui/src/styles/globals.css', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('home-cards.tsx', cardsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const card = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'HomeCard')
if (!card) throw new Error('HomeCard is missing')
const compiled = ts.transpileModule(card.getText(parsed), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText
const HomeCard = new Function(
  'React', 'SettingsSection', 'SettingsCard', 'Count', 'Empty', 'EmptyDescription', 'EmptyHeader', 'EmptyMedia', 'ListRowSkeleton',
  `${compiled}; return HomeCard`,
)(React, PageSection, PageCard, Count, Empty, EmptyDescription, EmptyHeader, EmptyMedia, ListRowSkeleton) as React.ComponentType<{
  icon: LucideIcon
  title: string
  count?: number
  loading: boolean
  empty: string | null
  after?: React.ReactNode
  children?: React.ReactNode
}>

function renderCard(options: { loading?: boolean; empty?: string | null; rows?: number; after?: React.ReactNode } = {}) {
  return renderToStaticMarkup(React.createElement(HomeCard, {
    icon: CircleCheck, title: 'Tasks', count: options.rows, loading: options.loading ?? false,
    empty: options.empty ?? null, after: options.after,
  }, Array.from({ length: options.rows ?? 0 }, (_, index) => React.createElement('li', { key: index }, `Task ${index}`))))
}

describe('Home natural Settings cards', () => {
  it('uses the empty-page icon and description slots without an inner title or control', () => {
    const html = renderCard({ empty: 'Keep track of what needs doing.' })
    expect(html).toContain('data-slot="empty"')
    expect(html).toContain('data-slot="empty-description"')
    expect(html).toContain('data-slot="empty-header"')
    expect(html).toContain('data-slot="empty-icon" data-variant="icon"')
    expect(html).toContain('<svg')
    expect(html).toContain('p-12')
    expect(html).not.toContain('data-slot="empty-title"')
    expect(html).not.toContain('<button')
    expect(html).not.toMatch(/\b(?:h-70|h-80|min-h-|overflow-y-auto|scroll-fade-y)\b/)
  })

  it('puts section titles outside cards and lets populated lists grow in the page scroll', () => {
    const html = renderCard({ rows: 50 })
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('data-slot="page-card"'))
    expect(html.match(/<li>/g)?.length).toBe(50)
    expect(html).toContain('<ul class="p-2">')
    expect(html).not.toContain('overflow-y-auto')
    expect(html).not.toContain('h-70')
    expect(html).not.toContain('md:h-80')
  })

  it('keeps loading rows naturally sized and dialogs outside the card surface', () => {
    const html = renderCard({ loading: true, after: React.createElement('div', { 'data-test-dialog': '' }) })
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/data-slot="list-row-skeleton"/g)?.length).toBe(3)
    expect(html).toContain('</ul></div><div data-test-dialog=""')
  })

  it('centers one greeting, removes the subtitle, and preserves today-only routine selection', () => {
    expect(homeSource).toContain('[&_h1]:text-center')
    expect(homeSource).toContain('[&_h1>span]:justify-center')
    expect(homeSource).not.toContain("t('home.prompt')")
    expect(homeSource.match(/<PageHeader\b/g)?.length).toBe(1)
    expect(cardsSource).toContain("title={t('sidebar.routines')}")
    expect(cardsSource).toContain('getRoutinesToday(api.routines, new Date(now))')
  })

  it('renders Notifications first and removes all View all wiring and imports', () => {
    const parsedHome = ts.createSourceFile('home-page.tsx', homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const page = parsedHome.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'HomePage')
    if (!page) throw new Error('HomePage is missing')
    const pageJs = ts.transpileModule(page.getText(parsedHome), {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace('export function', 'function')
    const cardMarker = (name: string) => () => React.createElement('div', { 'data-home-section': name })
    const Page = new Function(
      'React', 'useTranslation', 'useWorkspaceMembers', 'useCurrentUser', 'firstName', 'dayPart', 'useComposerContext',
      'PageHeader', 'PageColumn', 'NotificationsCard', 'TasksCard', 'ChatsCard', 'RoutinesCard',
      `${pageJs}; return HomePage`,
    )(
      React, () => ({ t: () => 'Greeting' }), () => ({ members: [], me: 'user:me' }), () => ({ name: 'Ana' }),
      () => 'Ana', () => 'afternoon', () => {}, () => null, PageColumn,
      cardMarker('Notifications'), cardMarker('Tasks'), cardMarker('Chats'), cardMarker('Routines'),
    ) as React.ComponentType
    const html = renderToStaticMarkup(React.createElement(Page))
    expect([...html.matchAll(/data-home-section="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(['Notifications', 'Tasks', 'Chats', 'Routines'])
    expect(cardsSource).not.toContain('onViewAll')
    expect(cardsSource).not.toContain('home.viewAll')
    expect(cardsSource).not.toContain("components/button'")
    expect(cardsSource).toContain('icon={Bell}')
    expect(cardsSource).toContain('icon={CircleCheck}')
    expect(cardsSource).toContain('icon={MessagesSquare}')
    expect(cardsSource).toContain('icon={Clock}')
  })
})

describe('shared composer fade', () => {
  it('renders exactly one always-on, noninteractive fade outside the page scroll', () => {
    const html = renderToStaticMarkup(React.createElement(PageFrame, {
      composer: React.createElement('div', { 'data-slot': 'composer' }, 'Composer'),
    }, React.createElement(PageColumn, null, React.createElement('button', null, 'Last content'))))
    expect(html.match(/data-slot="page-composer-fade"/g)?.length).toBe(1)
    expect(html).toMatch(/aria-hidden="true" data-slot="page-composer-fade" class="pointer-events-none/)
    expect(html.indexOf('data-slot="page-composer-fade"')).toBeGreaterThan(html.indexOf('Last content'))
    expect(html.indexOf('data-slot="page-composer-fade"')).toBeLessThan(html.indexOf('data-slot="page-composer-slot"'))
  })

  it('derives clearance from the measured composer slot and includes the safe-area inset', () => {
    expect(frameSource).toContain('composerSlot.offsetHeight')
    expect(frameSource).toContain('resizes.observe(composerSlot)')
    expect(frameSource).toContain('`calc(${composerHeight}px + var(--composer-gap))`')
    expect(frameSource).toContain('env(safe-area-inset-bottom,0px)')
    const html = renderToStaticMarkup(React.createElement(PageColumn, null, 'Last content'))
    expect(html).toContain('pb-[max(2.5rem,var(--composer-clearance,0px))]')
  })

  it('uses the live frame surface in light, dark and wallpaper themes, not a page-specific gradient', () => {
    const fade = styles.match(/\[data-slot="page-composer-fade"\]\s*\{[^}]+\}/)?.[0]
    expect(fade).toContain('var(--composer-clearance, 0px)')
    expect(fade).toContain('linear-gradient(to bottom, transparent, var(--background) 65%, var(--background))')
    expect(fade).toContain('pointer-events: none')
    expect(homeSource).not.toContain('gradient')
    expect(cardsSource).not.toContain('gradient')
  })
})
