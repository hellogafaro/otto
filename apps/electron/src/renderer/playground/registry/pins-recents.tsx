import * as React from 'react'
import { useHydrateAtoms } from 'jotai/utils'
import { useAtom } from 'jotai'
import { Circle, CircleCheck, CircleDashed, CircleDot } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarProvider } from '@workspace/ui/components/sidebar'
import type { ComponentEntry } from './types'
import { ActionRegistryProvider } from '@/actions/registry'
import { AppShellProvider, useAppShellContext } from '@/context/app-shell-context'
import { ModalProvider } from '@/context/modal-context'
import { currentRouteAtom } from '@/atoms/current-route'
import { pinnedItemsAtom, recentItemsAtom, type NavItem, type PinnedItem, type RecentItem } from '@/atoms/pins-recents'
import { sessionMetaMapAtom, windowWorkspaceIdAtom, type SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import { NavigationContext } from '@/contexts/navigation-context'
import { SidebarPinsRecents } from '@/components/app-shell/sidebar-pins-recents'
import { useJumpShortcuts } from '@/hooks/use-jump-shortcuts'
import { routes, type ViewRoute } from '../../../shared/routes'
import { PlaygroundAppShellProvider } from '../playground-app-shell-provider'

// =============================================================================
// SidebarPinsRecents: the sidebar's Pinned and Recent groups. One-line rows, the
// title fading under the right slot. Seeded with every slot state: the status of a
// waiting (c8), failed (c7), working (c2) and unread (c1) chat, or the time since the
// last message (c3 is a long title, c4 and c5 show hours and days). Hover or Tab to a
// row for Pin, Archive and More, open the ⋯ menu to keep them, hold ⌘ (Option in the
// browser) to swap the slot for the jump keys, press ⌘1–⌘9 / Option+1–9 to open.
// =============================================================================

const WORKSPACE = 'playground-pins'

const statuses: SessionStatus[] = [
  { id: 'backlog', label: 'Backlog', resolvedColor: 'var(--muted-foreground)', icon: <CircleDashed />, iconColorable: true, category: 'open' },
  { id: 'todo', label: 'Todo', resolvedColor: 'var(--foreground)', icon: <Circle />, iconColorable: true, category: 'open' },
  { id: 'needs-review', label: 'Needs review', resolvedColor: 'var(--info)', icon: <CircleDot />, iconColorable: true, category: 'open' },
  { id: 'done', label: 'Done', resolvedColor: 'var(--success)', icon: <CircleCheck />, iconColorable: true, category: 'closed' },
]

const MINUTE = 60_000
const ago = (ms: number) => Date.now() - ms
const sessions = new Map<string, SessionMeta>(
  (
    [
      ['c1', 'Fix the sidebar width', 'needs-review', { hasUnread: true, lastMessageAt: ago(3 * MINUTE) }],
      ['c2', 'Plan the release', 'todo', { isProcessing: true, lastMessageAt: ago(20_000) }],
      ['c3', 'Summarize the thread about the quarterly planning review and what we decided', 'backlog', { lastMessageAt: ago(45 * MINUTE) }],
      ['c4', 'Casual greeting', 'done', { lastMessageAt: ago(5 * 60 * MINUTE) }],
      ['c5', 'Debug the login flow', 'todo', { lastMessageAt: ago(3 * 24 * 60 * MINUTE) }],
      ['c6', 'Write the migration notes', 'backlog', { lastMessageAt: ago(9 * 24 * 60 * MINUTE) }],
      ['c7', 'Rename the workspace', 'done', { lastMessageRole: 'error', lastMessageAt: ago(2 * 60 * MINUTE) }],
      ['c8', 'Review pull request 412', 'needs-review', { lastMessageAt: ago(8 * MINUTE) }],
      ['c9', 'Draft the changelog', 'todo', { lastMessageAt: ago(30 * 60 * MINUTE) }],
      ['c10', 'Archive old drafts', 'done', {}],
      ['c11', 'Check the billing export', 'todo', { lastMessageAt: ago(60 * 24 * 60 * MINUTE) }],
    ] as [string, string, string, Partial<SessionMeta>][]
  ).map(([id, name, sessionStatus, extra]) => [
    id,
    { id, name, workspaceId: WORKSPACE, sessionStatus, messageCount: 3, ...extra } satisfies SessionMeta,
  ]),
)

const chat = (id: string): NavItem => ({ type: 'chat', id, title: sessions.get(id)!.name!, route: routes.view.allSessions(id) })
const pinnedSeed = (ids: string[]): PinnedItem[] => ids.map((id, i) => ({ ...chat(id), pinnedAt: i }))
const recentSeed = (ids: string[]): RecentItem[] => ids.map((id, i) => ({ ...chat(id), visitedAt: 100 - i }))

interface Props {
  pinned: string
  recent: string
}

const ids = (list: string) => list.split(',').map(s => s.trim()).filter(Boolean)

function Demo({ pinned, recent }: Props) {
  useHydrateAtoms([
    [windowWorkspaceIdAtom, WORKSPACE],
    [sessionMetaMapAtom, sessions],
    [currentRouteAtom, routes.view.allSessions('c2')],
    [pinnedItemsAtom(WORKSPACE), pinnedSeed(ids(pinned))],
    [recentItemsAtom(WORKSPACE), recentSeed(ids(recent))],
  ] as never)
  const [route, setRoute] = useAtom(currentRouteAtom)
  // The shell's pending requests: c8 waits on the user.
  const shell = useAppShellContext()
  const shellWithRequest = React.useMemo(
    () => ({ ...shell, pendingPermissions: new Map([['c8', [{ requestId: 'p1' }]]]) }) as unknown as typeof shell,
    [shell],
  )

  // The shell's navigation context, reduced to what the sidebar uses: opening a route.
  const navigation = React.useMemo(
    () => ({ navigate: async (next: ViewRoute) => setRoute(next) }) as unknown as NonNullable<React.ContextType<typeof NavigationContext>>,
    [setRoute],
  )

  return (
    <AppShellProvider value={shellWithRequest}>
      <NavigationContext.Provider value={navigation}>
        <Shortcuts />
        <div className="flex h-[560px] w-full overflow-hidden rounded-lg border">
          <SidebarProvider className="min-h-0">
            <Sidebar>
              <SidebarContent>
                <SidebarPinsRecents sessionStatuses={statuses} />
              </SidebarContent>
            </Sidebar>
            <div className="flex-1 p-6 text-sm text-muted-foreground">
              Open route: <code data-testid="route">{route}</code>
            </div>
          </SidebarProvider>
        </div>
      </NavigationContext.Provider>
    </AppShellProvider>
  )
}

/** The shell mounts this once; the demo does it under its fake navigation. */
function Shortcuts() {
  useJumpShortcuts()
  return null
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ActionRegistryProvider>
      <PlaygroundAppShellProvider>
        <ModalProvider>{children}</ModalProvider>
      </PlaygroundAppShellProvider>
    </ActionRegistryProvider>
  )
}

export const pinsRecentsComponents: ComponentEntry[] = [
  {
    id: 'sidebar-pins-recents',
    name: 'Sidebar pins and recents',
    category: 'Shell',
    description: 'The Pinned and Recent groups: one-line rows whose title fades under the right slot. The slot is the status (waiting, failed, working, unread) or else the time; hover, Tab or an open menu show Pin, Archive and More; holding the reveal key (⌘, Option in the browser) shows the jump keys (⌘1–⌘9, Option+1–9) in its place. Drag a pinned row to reorder.',
    component: Demo,
    wrapper: Wrapper,
    layout: 'top',
    props: [
      { name: 'pinned', description: 'Pinned chat ids, in order', control: { type: 'string' }, defaultValue: 'c1,c3' },
      { name: 'recent', description: 'Recent chat ids, most recent first', control: { type: 'string' }, defaultValue: 'c2,c1,c4,c5,c6,c7,c8,c9,c10,c11' },
    ],
    variants: [
      { name: 'Pinned and recent', props: { pinned: 'c1,c3', recent: 'c2,c1,c4,c5,c6,c7,c8,c9,c10,c11' } },
      { name: 'Recent only', props: { pinned: '', recent: 'c2,c4,c5' } },
      { name: 'Pinned only', props: { pinned: 'c1,c3', recent: '' } },
      { name: 'Empty (renders nothing)', props: { pinned: '', recent: '' } },
    ],
  },
]
