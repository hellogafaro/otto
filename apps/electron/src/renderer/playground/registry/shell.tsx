import * as React from 'react'
import { Box, CircleDot, MessagesSquare, MoreHorizontal, Search, Settings } from 'lucide-react'
import { createPortal } from 'react-dom'
import { PageNavigationButtons } from '@workspace/ui/components/page-navigation'
import { PageCard, PageCenterpiece, PageColumn, PageSection } from '@workspace/ui/components/page'
import { PageFrame, PageHeaderRow, PageScroll, usePageFrame } from '@workspace/ui/components/page-frame'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { Sidecar, SidecarToggle } from '@workspace/ui/components/sidecar'
import { Logo } from '@workspace/ui/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
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
import { PRODUCT_NAME } from '@otto/shared/branding'

// =============================================================================
// Shell primitives: Sidebar, PageFrame (the rounded main panel: the column with
// its title row first, the gutters, the chat's pinned row), a blocks page or a centerpiece page, the
// Sidecar and panel navigation, in one frame. The sidebar follows the window width
// (icons only below 1024px, a sheet below 768px); the frame's layout follows the
// frame's own width, so resize the window to see the split work.
// =============================================================================

const CHATS = ['Casual greeting', 'Fix the sidebar width', 'Plan the release', 'Summarize the thread']

interface ShellDemoProps {
  page: 'blocks' | 'centerpiece'
  sidecarOpen: boolean
  showNav: boolean
}

// The shell's `PageHeader` does this: draw the title row in the column's title
// slot (it scrolls with the page) or, on a centerpiece (the chat), the compact
// pinned row in the frame's header slot; navigation sits at the upper corners and the
// sidecar's toggle in the trailing slot (`SidecarDetails`).
function DemoHeader({ active, setActive, showNav, pinned, open, setOpen }: {
  active: number
  setActive: React.Dispatch<React.SetStateAction<number>>
  showNav: boolean
  pinned: boolean
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const frame = usePageFrame()
  const back = { label: 'Back', onClick: () => {} }
  const prev = { label: 'Previous', onClick: () => setActive((i) => Math.max(0, i - 1)), disabled: active === 0 }
  const next = { label: 'Next', onClick: () => setActive((i) => Math.min(CHATS.length - 1, i + 1)), disabled: active === CHATS.length - 1 }
  const target = pinned ? frame?.header : frame?.title
  return (
    <>
      {target && createPortal(
        <PageHeaderRow
          density={pinned ? 'compact' : 'roomy'}
          title={CHATS[active]}
        />,
        target,
      )}
      {frame?.leading && createPortal(<><SidebarTrigger />{showNav && <PageNavigationButtons back={back} />}</>, frame.leading)}
      {frame?.trailing && createPortal(<>{showNav && <PageNavigationButtons previous={prev} next={next} />}<SidecarToggle open={open} onOpenChange={setOpen} label="Details" /></>, frame.trailing)}
    </>
  )
}

function ShellDemo({ page, sidecarOpen, showNav }: ShellDemoProps) {
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
              <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">{PRODUCT_NAME}</span>
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
          asideOpen={open}
          onAsideOpenChange={setOpen}
          aside={
            <Sidecar open={open} onOpenChange={setOpen} title="Details">
              <PropertySection title="Properties">
                <PropertyRow icon={<CircleDot />} label="Status" value="In progress" />
                <PropertyRow icon={<Box />} label="Project" value={PRODUCT_NAME} />
              </PropertySection>
            </Sidecar>
          }
        >
          <DemoHeader active={active} setActive={setActive} showNav={showNav} pinned={page === 'centerpiece'} open={open} setOpen={setOpen} />
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
                  A centerpiece page: one card as wide as the column and as tall as the space under the pinned
                  compact row. The transcript or the document scrolls inside it.
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
    name: 'Shell (Sidebar, rounded panel, resizable details)',
    category: 'Shell',
    description: 'The shell primitives in one frame: a blocks page or a centerpiece page, resizable details and upper-corner navigation. The sidebar and the frame follow the window width.',
    component: ShellDemo,
    layout: 'top',
    props: [
      { name: 'page', description: 'Page type', control: { type: 'select', options: [{ label: 'Blocks', value: 'blocks' }, { label: 'Centerpiece', value: 'centerpiece' }] }, defaultValue: 'blocks' },
      { name: 'sidecarOpen', description: 'Sidecar open', control: { type: 'boolean' }, defaultValue: false },
      { name: 'showNav', description: 'Upper-corner Back / Previous / Next', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Blocks page', props: { page: 'blocks', sidecarOpen: false, showNav: true } },
      { name: 'Centerpiece page', props: { page: 'centerpiece', sidecarOpen: false, showNav: true } },
      { name: 'Sidecar open', props: { page: 'centerpiece', sidecarOpen: true, showNav: true } },
      { name: 'No navigation', props: { page: 'blocks', sidecarOpen: false, showNav: false } },
    ],
  },
]
