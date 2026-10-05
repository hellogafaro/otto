import * as React from 'react'
import { MessagesSquare, MoreHorizontal, PanelRight, Plus, Search, Settings } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { createPortal } from 'react-dom'
import { FloatingNav } from '@workspace/ui/components/floating-nav'
import { PageCard, PageCenterpiece, PageColumn, PageSection } from '@workspace/ui/components/page'
import { PageCrumbs, PageFrame, PageHeaderRow, PageScroll, usePageFrame } from '@workspace/ui/components/page-frame'
import { Sidecar } from '@workspace/ui/components/sidecar'
import { Logo } from '@workspace/ui/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@workspace/ui/components/sidebar'
import type { ComponentEntry } from './types'

// =============================================================================
// Shell primitives: Sidebar, PageFrame (the flat main region, with the header
// row, the column and the gutters), a blocks page or a centerpiece page, the
// Sidecar and FloatingNav, in one frame. The sidebar follows the window width
// (icons only below 1024px, a sheet below 768px); the frame's layout follows the
// frame's own width, so resize the window to see the gutters work.
// =============================================================================

const CHATS = ['Casual greeting', 'Fix the sidebar width', 'Plan the release', 'Summarize the thread']

interface ShellDemoProps {
  page: 'blocks' | 'centerpiece'
  sidecarOpen: boolean
  sidecarSurface: boolean
  showNav: boolean
  showCrumbs: boolean
}

// The shell's `PageHeader` does this: draw the header row (and the nav) in the
// frame's slots, outside the column's body.
function DemoHeader({ active, setActive, showNav, showCrumbs, onDetails }: {
  active: number
  setActive: React.Dispatch<React.SetStateAction<number>>
  showNav: boolean
  showCrumbs: boolean
  onDetails: () => void
}) {
  const frame = usePageFrame()
  const navInGutter = showNav && !!frame?.navFits
  const prev = { label: 'Previous', onClick: () => setActive((i) => Math.max(0, i - 1)), disabled: active === 0 }
  const next = { label: 'Next', onClick: () => setActive((i) => Math.min(CHATS.length - 1, i + 1)), disabled: active === CHATS.length - 1 }
  return (
    <>
      {frame?.header && createPortal(
        <PageHeaderRow
          leading={<SidebarTrigger />}
          title={CHATS[active]}
          crumbs={showCrumbs ? <PageCrumbs crumbs={[{ label: 'Chats', onClick: () => {} }]} /> : undefined}
          actions={
            <Button variant="ghost" size="icon-compact" aria-label="Details" onClick={onDetails}>
              <PanelRight />
            </Button>
          }
        />,
        frame.header,
      )}
      {navInGutter && frame?.nav && createPortal(
        <FloatingNav back={{ label: 'Back', onClick: () => {} }} previous={prev} next={next} />,
        frame.nav,
      )}
    </>
  )
}

function ShellDemo({ page, sidecarOpen, sidecarSurface, showNav, showCrumbs }: ShellDemoProps) {
  const [open, setOpen] = React.useState(sidecarOpen)
  const [active, setActive] = React.useState(1)
  React.useEffect(() => setOpen(sidecarOpen), [sidecarOpen])

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border border-border">
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex h-7 items-center gap-2 pl-1">
              <span className="flex size-5 items-center justify-center">
                <Logo className="size-4 text-foreground" />
              </span>
              <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">Otto</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="shrink-0">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Search">
                    <Search />
                    <span>Search</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive tooltip="Chats">
                    <MessagesSquare />
                    <span>Chats</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings">
                    <Settings />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>All sessions</SidebarGroupLabel>
              <SidebarGroupAction aria-label="Add"><Plus /></SidebarGroupAction>
              <SidebarGroupContent>
                <SidebarMenu>
                  {CHATS.map((chat, index) => (
                    <SidebarMenuItem key={chat}>
                      <SidebarMenuButton isActive={active === index} onClick={() => setActive(index)}>
                        <span>{chat}</span>
                      </SidebarMenuButton>
                      <SidebarMenuAction aria-label="More"><MoreHorizontal /></SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <PageFrame
          aside={
            <Sidecar open={open} onOpenChange={setOpen} title="Details" surface={sidecarSurface}>
              <div className="space-y-5 text-muted-foreground">
                <section className="space-y-1.5">
                  <h3 className="text-xs font-medium">Status</h3>
                  <p>In progress, started today.</p>
                </section>
                <section className="space-y-1.5">
                  <h3 className="text-xs font-medium">Project</h3>
                  <p>Otto</p>
                </section>
              </div>
            </Sidecar>
          }
        >
          <DemoHeader active={active} setActive={setActive} showNav={showNav} showCrumbs={showCrumbs} onDetails={() => setOpen((v) => !v)} />
          {page === 'blocks' ? (
            <PageColumn>
              <PageSection title="Interface" description="Surfaces are siblings on the frame.">
                <PageCard>
                  <div className="px-4 py-3 text-sm">Sidebar</div>
                  <div className="px-4 py-3 text-sm">Open links in the desktop app</div>
                </PageCard>
              </PageSection>
              <PageSection title="Input">
                <PageCard>
                  <div className="px-4 py-3 text-sm">Enter behavior</div>
                  <div className="px-4 py-3 text-sm">Send shortcut</div>
                </PageCard>
              </PageSection>
            </PageColumn>
          ) : (
            <>
              <PageCenterpiece>
                <PageScroll className="px-5 py-5 text-sm text-muted-foreground">
                  A centerpiece page: one card as wide as the column and as tall as the space under the header
                  row. The transcript or the document scrolls inside it.
                </PageScroll>
              </PageCenterpiece>
              <div className="mt-2 rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground card-surface [--card-shadow:var(--shadow-sm)]">
                The composer: a sibling card under the centerpiece, never inside it.
              </div>
            </>
          )}
        </PageFrame>
      </SidebarProvider>
    </div>
  )
}

export const shellComponents: ComponentEntry[] = [
  {
    id: 'shell-primitives',
    name: 'Shell (Sidebar, PageFrame, Sidecar, FloatingNav)',
    category: 'Shell',
    description: 'The shell primitives in one frame: a blocks page or a centerpiece page, the sidecar and the floating navigation. The sidebar and the frame follow the window width.',
    component: ShellDemo,
    layout: 'top',
    props: [
      { name: 'page', description: 'Page type', control: { type: 'select', options: [{ label: 'Blocks', value: 'blocks' }, { label: 'Centerpiece', value: 'centerpiece' }] }, defaultValue: 'blocks' },
      { name: 'sidecarOpen', description: 'Sidecar open', control: { type: 'boolean' }, defaultValue: false },
      { name: 'sidecarSurface', description: 'Sidecar wrapped in a card (A/B)', control: { type: 'boolean' }, defaultValue: false },
      { name: 'showNav', description: 'Floating Back / Previous / Next', control: { type: 'boolean' }, defaultValue: true },
      { name: 'showCrumbs', description: 'Crumb trail after the title', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Blocks page', props: { page: 'blocks', sidecarOpen: false, sidecarSurface: false, showNav: true, showCrumbs: false } },
      { name: 'Centerpiece page', props: { page: 'centerpiece', sidecarOpen: false, sidecarSurface: false, showNav: true, showCrumbs: false } },
      { name: 'Sidecar as canvas', props: { page: 'centerpiece', sidecarOpen: true, sidecarSurface: false, showNav: true, showCrumbs: false } },
      { name: 'Sidecar with surface', props: { page: 'centerpiece', sidecarOpen: true, sidecarSurface: true, showNav: true, showCrumbs: false } },
      { name: 'Drill-down with crumbs', props: { page: 'blocks', sidecarOpen: false, sidecarSurface: false, showNav: false, showCrumbs: true } },
    ],
  },
]
