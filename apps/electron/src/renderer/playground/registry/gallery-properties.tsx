import * as React from 'react'
import {
  Box,
  CalendarDays,
  CircleDashed,
  CircleDot,
  Clock,
  File,
  FileText,
  Folder,
  HardDrive,
  Link,
  MoreHorizontal,
  User,
  X,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
import { Button } from '@workspace/ui/components/button'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@workspace/ui/components/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { CreateButton } from '@/components/ui/create-button'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

// =============================================================================
// Gallery (projects 3 columns 16:9, library 4 columns 4:5, files 1:1) and the
// sidecar's property list, light and dark side by side. Static states: rest,
// current, pending (disabled), menu open (an expanded ⋯), loading. Hover the
// tiles, Tab to them and right-click them for the interactive ones.
// =============================================================================

function TileMenu() {
  return (
    <ContextMenuContent>
      <ContextMenuItem>Open</ContextMenuItem>
      <ContextMenuItem shortcut="R">Rename</ContextMenuItem>
      <ContextMenuItem shortcut="C">Copy link</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" shortcut="⌫">Delete</ContextMenuItem>
    </ContextMenuContent>
  )
}

function More({ open = false }: { open?: boolean }) {
  // `open`: the open look, shown statically (a menu would close on the next click).
  if (open) return <Button variant="ghost" size="icon-compact" aria-label="More actions" aria-expanded><MoreHorizontal /></Button>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label="More actions" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>Open</DropdownMenuItem>
        <DropdownMenuItem shortcut="C">Copy link</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const PROJECTS = ['Website relaunch', 'Quarterly investor update with the hiring plan for the board', 'Lisbon offsite', 'Billing migration']

function Projects() {
  return (
    <Gallery columns={3}>
      {PROJECTS.map((title, i) => (
        <GalleryItem
          key={title}
          ratio="16:9"
          media={<Box />}
          icon={<Box />}
          title={i === 3 ? `${title} (pending)` : title}
          current={i === 1}
          disabled={i === 3}
          menu={<TileMenu />}
          actions={<More open={i === 2} />}
        />
      ))}
      <GalleryItemSkeleton ratio="16:9" />
    </Gallery>
  )
}

function Library() {
  return (
    <Gallery columns={4}>
      <GalleryItem media={<Folder />} label="12 items" icon={<Folder />} title="Brand" menu={<TileMenu />} actions={<More />} />
      <GalleryItem media={<File />} label="PDF" icon={<File />} title="Pitch deck v3.pdf" menu={<TileMenu />} actions={<More />} />
      <GalleryItem media={<File />} label="PNG" icon={<File />} title="Logo on dark background, final, exported for print.png" menu={<TileMenu />} actions={<More />} />
      <GalleryItem media={<FileText />} icon={<FileText />} title="Launch plan" menu={<TileMenu />} actions={<More open />} />
      <GalleryItem media={<FileText />} icon={<FileText />} title="Meeting notes" current menu={<TileMenu />} actions={<More />} />
      <GalleryItem media={<File />} label="CSV" icon={<File />} title="Uploading.csv" disabled />
      <GalleryItemSkeleton />
      <GalleryItemSkeleton />
    </Gallery>
  )
}

function Files() {
  return (
    <Gallery columns={4}>
      <GalleryItem ratio="1:1" media={<File />} label="MP4" icon={<File />} title="Demo recording.mp4" menu={<TileMenu />} actions={<More />} />
      <GalleryItem ratio="1:1" media={<File />} label="ZIP" icon={<File />} title="Assets.zip" menu={<TileMenu />} actions={<More />} />
      <GalleryItemSkeleton ratio="1:1" />
    </Gallery>
  )
}

const STATUS = {
  todo: { label: 'Todo', icon: <CircleDashed className="text-status-todo" /> },
  doing: { label: 'In progress', icon: <CircleDot className="text-status-doing" /> },
} as const

function StatusRow() {
  const [status, setStatus] = React.useState<keyof typeof STATUS>('doing')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<PropertyRow icon={<CircleDot />} label="Status" value={<>{STATUS[status].icon}<span className="truncate">{STATUS[status].label}</span></>} kbd="S" />}
      />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel shortcut="S">Change status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={status} onValueChange={(next) => setStatus(next as keyof typeof STATUS)}>
            {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>{STATUS[key].icon}{STATUS[key].label}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Remove() {
  return <Button variant="ghost" size="icon-xs" aria-label="Remove"><X /></Button>
}

function Properties() {
  return (
    <div className="w-74">
      <PropertySection title="Properties">
        <StatusRow />
        <PropertyRow
          icon={<Avatar size="sm"><AvatarFallback>JG</AvatarFallback></Avatar>}
          label="Assignees"
          value="Johan Gafaro"
          kbd="A"
          aria-expanded
        />
        <PropertyRow icon={<CalendarDays />} label="Due date" placeholder="No due date" kbd="D" />
        <PropertyRow icon={<Box />} label="Project" value="Website relaunch" disabled />
      </PropertySection>
      <PropertySection title="Resources" count={2} action={<CreateButton size="icon-xs" label="New resource" />}>
        <PropertyRow icon={<Link />} value="Brand guidelines" actions={<Remove />} />
        <PropertyRow icon={<FileText />} value="Launch plan with a title long enough to truncate" actions={<Remove />} />
      </PropertySection>
      <PropertySection title="Details">
        <PropertyRow readOnly icon={<Folder />} label="Folder" value="Brand / Logos" />
        <PropertyRow readOnly icon={<User />} label="Created by" value="Johan Gafaro" />
        <PropertyRow readOnly icon={<Clock />} label="Created" value="Oct 1, 2026" />
        <PropertyRow readOnly icon={<HardDrive />} label="Size" value="2.4 MB" />
      </PropertySection>
      <PropertySection title="Folded" count={3} defaultOpen={false}>
        <PropertyRow value="Hidden row" />
      </PropertySection>
      <PropertySection title="Empty (not drawn)">{[]}</PropertySection>
    </div>
  )
}

function Panel({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <div className={cn(mode === 'dark' && 'dark', 'flex min-w-0 gap-5 bg-sidebar p-5 text-foreground')}>
      <div className="@container/panel flex w-192 shrink-0 flex-col gap-8">
        <Projects />
        <Library />
        <Files />
      </div>
      <Properties />
    </div>
  )
}

export function GalleryPropertiesPage() {
  return (
    <div className="flex min-w-[1150px] flex-col">
      <Panel mode="light" />
      <Panel mode="dark" />
    </div>
  )
}

export const galleryPropertiesComponents: ComponentEntry[] = [
  {
    id: 'gallery-properties',
    name: 'Gallery and property list',
    category: 'Shell',
    description: 'Gallery / GalleryItem (3 and 4 columns, 16:9, 4:5, 1:1, current, pending, menu open, loading) and the sidecar PropertySection / PropertyRow (editable, open, disabled, list items, New row, read-only, folded), light and dark.',
    component: GalleryPropertiesPage,
    props: [],
    layout: 'top',
    previewOverflow: 'auto',
  },
]
