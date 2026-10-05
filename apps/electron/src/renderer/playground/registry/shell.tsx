import * as React from 'react'
import { MessagesSquare, MoreHorizontal, PanelRight, Plus, Search, Settings } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { ContentCard, ContentCardBody, ContentCardCrumbs, ContentCardHeader } from '@workspace/ui/components/content-card'
import { FloatingActionButton } from '@workspace/ui/components/floating-action-button'
import { FloatingCard } from '@workspace/ui/components/floating-card'
import { FloatingNav } from '@workspace/ui/components/floating-nav'
import { Kbd } from '@workspace/ui/components/kbd'
import { Logo } from '@workspace/ui/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
// Shell primitives: Sidebar, ContentCard (+ header, crumbs), FloatingCard,
// FloatingNav and FloatingActionButton, in one frame. The sidebar follows the
// window width (icons only below 1024px, a sheet below 768px); the page card's
// container queries follow the frame. Resize the window to see both.
// =============================================================================

const CHATS = ['Casual greeting', 'Fix the sidebar width', 'Plan the release', 'Summarize the thread']

interface ShellDemoProps {
  floatingOpen: boolean
  showNav: boolean
  showCrumbs: boolean
  showFab: boolean
}

function ShellDemo({ floatingOpen, showNav, showCrumbs, showFab }: ShellDemoProps) {
  const [open, setOpen] = React.useState(floatingOpen)
  const [active, setActive] = React.useState(1)
  React.useEffect(() => setOpen(floatingOpen), [floatingOpen])

  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-lg border border-border">
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
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <ContentCard>
          <ContentCardHeader
            leading={<SidebarTrigger />}
            title={CHATS[active]}
            crumbs={showCrumbs ? <ContentCardCrumbs crumbs={[{ label: 'Chats', onClick: () => {} }]} /> : undefined}
            actions={
              <Button variant="ghost" size="icon-compact" aria-label="Details" onClick={() => setOpen((v) => !v)}>
                <PanelRight />
              </Button>
            }
          />
          <ContentCardBody className="px-4 pb-4">
            <div className="mx-auto max-w-3xl text-sm text-muted-foreground">
              The page card: 12px corners, hairline ring, shadow-xs, 8px from the top, right and bottom.
            </div>
          </ContentCardBody>
          {showNav && (
            <FloatingNav
              back={{ label: 'Back', onClick: () => {} }}
              previous={{ label: 'Previous', onClick: () => setActive((i) => Math.max(0, i - 1)), disabled: active === 0 }}
              next={{ label: 'Next', onClick: () => setActive((i) => Math.min(CHATS.length - 1, i + 1)), disabled: active === CHATS.length - 1 }}
            />
          )}
          {showFab && (
            <FloatingActionButton aria-label="New chat" tooltip={<>New chat<Kbd>⌘N</Kbd></>}>
              <Plus />
            </FloatingActionButton>
          )}
        </ContentCard>

        <FloatingCard open={open} onOpenChange={setOpen} title="Details">
          <p className="text-sm text-muted-foreground">
            The floating card: the page card's sibling, 8px away. It shrinks the page card from 1280px up and overlays it below.
          </p>
        </FloatingCard>
      </SidebarProvider>
    </div>
  )
}

export const shellComponents: ComponentEntry[] = [
  {
    id: 'shell-primitives',
    name: 'Shell (Sidebar, ContentCard, FloatingCard, FloatingNav, FAB)',
    category: 'Shell',
    description: 'The shell primitives in one frame. The sidebar and the floating card follow the window width.',
    component: ShellDemo,
    layout: 'top',
    props: [
      { name: 'floatingOpen', description: 'Floating card open', control: { type: 'boolean' }, defaultValue: false },
      { name: 'showNav', description: 'Floating Back / Previous / Next', control: { type: 'boolean' }, defaultValue: true },
      { name: 'showCrumbs', description: 'Crumb trail after the title', control: { type: 'boolean' }, defaultValue: false },
      { name: 'showFab', description: 'Floating action button', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'Floating card closed', props: { floatingOpen: false, showNav: true, showCrumbs: false, showFab: true } },
      { name: 'Floating card open', props: { floatingOpen: true, showNav: true, showCrumbs: false, showFab: true } },
      { name: 'Drill-down with crumbs', props: { floatingOpen: false, showNav: false, showCrumbs: true, showFab: false } },
    ],
  },
]
