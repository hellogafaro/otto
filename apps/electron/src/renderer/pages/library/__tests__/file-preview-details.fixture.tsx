import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { SidecarProvider, useOptionalSidecar } from '../../../context/sidecar-context'
import { ShikiThemeProvider } from '../../../../../../../packages/ui/src/context/shiki-theme-context'
import en from '../../../../../../../packages/shared/src/i18n/locales/en.json'
import type { LibraryItem } from '../../../../shared/types'
import { FilePreview } from '../file-preview'
import '../../../index.css'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })

const markdown = '# Controlled file preview\n\nThis is the actual FilePreview component with fake content and metadata.\n\n## Read-only document\n\nIts prose measure stays unchanged while Details can be opened or closed.\n\n```ts\nconst unchanged = true\n```'
const text = 'const source_fixture = true\n' + 'const long_reference = "Controlled source-file content stays uncapped and has no runtime effect."\n'.repeat(8)
const make = (id: string, title: string, mime: string, content: string): LibraryItem => ({ id, title, mime, size: new TextEncoder().encode(content).length, type: 'file', parentId: null, createdBy: 'user:2d94ad10-b63e-4dcf-80fb-1cc5fbfcd889', createdAt: 1791532800000, updatedAt: 1791532800000 })
const items = {
  markdown: make('86ae10e8-ff8e-4c53-9331-4c2c633c6450', 'Details fixture.md', 'text/markdown', markdown),
  text: make('ae21377d-56df-43a3-b8c1-96fbbe20c3df', 'Source fixture.ts', 'text/plain', text),
}
const proof = {
  effects: [] as string[], reads: [] as string[], closes: 0,
  refresh: () => {}, navigate: (_kind: keyof typeof items) => {},
  setAvailable: (_available: boolean) => {}, remount: () => {}, setDark: (_dark: boolean) => {},
  sharedOpen: null as boolean | null,
}
Object.assign(window, { proof, electronAPI: {
  readLibraryItem: async (id: string) => {
    proof.reads.push(id)
    const item = Object.values(items).find((item) => item.id === id)!
    return { item, content: { encoding: 'utf8', data: item.mime === 'text/markdown' ? markdown : text } }
  },
  openUrl: async () => { proof.effects.push('openUrl') },
} })

function Fixture() {
  const sidecar = useOptionalSidecar()
  proof.sharedOpen = sidecar?.open ?? null
  const [kind, setKind] = React.useState<keyof typeof items>('markdown')
  const [refresh, setRefresh] = React.useState(0)
  const [available, setAvailable] = React.useState(true)
  const [mount, setMount] = React.useState(0)
  const [visible, setVisible] = React.useState(true)
  const [dark, setDark] = React.useState(false)
  proof.refresh = () => setRefresh((value) => value + 1)
  proof.navigate = setKind
  proof.setAvailable = setAvailable
  proof.remount = () => { setMount((value) => value + 1); setVisible(true) }
  proof.setDark = (dark) => { document.documentElement.classList.toggle('dark', dark); setDark(dark) }
  const item = items[kind]
  const details = (
    <dl className="grid gap-3" data-fixture-refresh={refresh}>
      <div><dt>File</dt><dd>{item.title}</dd></div>
      {Array.from({ length: 24 }, (_, index) => <div key={index}><dt>Field {index + 1}</dt><dd>Controlled metadata {index + 1}</dd></div>)}
    </dl>
  )
  return (
    <TooltipProvider><ShikiThemeProvider shikiTheme={dark ? 'github-dark' : 'github-light'}>
      {visible && <FilePreview
        key={mount} item={item} details={available ? details : null} dialogs={null} menu={null}
        onDownload={() => { proof.effects.push('download') }}
        onCopyLink={() => { proof.effects.push('copyLink') }}
        onDelete={() => { proof.effects.push('delete') }}
        onClose={() => { proof.closes++; setVisible(false) }}
      />}
    </ShikiThemeProvider></TooltipProvider>
  )
}

if (new URLSearchParams(location.search).has('routed')) {
  const rootRoute = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => ({ details: search.details === 'closed' ? 'closed' as const : undefined, routed: '1' as const }),
    component: () => <SidecarProvider><Outlet /></SidecarProvider>,
  })
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Fixture })
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createBrowserHistory() })
  createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
} else {
  createRoot(document.getElementById('root')!).render(<Fixture />)
}
