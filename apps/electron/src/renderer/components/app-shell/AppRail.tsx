import * as React from 'react'
import {
  CircleCheck,
  Clock,
  FileText,
  FolderClosed,
  Folder,
  Inbox,
  MessageCircle,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export type RailItemId =
  | 'inbox'
  | 'search'
  | 'tasks'
  | 'projects'
  | 'chats'
  | 'schedules'
  | 'documents'
  | 'files'
  | 'settings'

interface RailItem {
  id: RailItemId
  label: string
  icon: LucideIcon
  /** Items without a handler are placeholders: shown, not linked yet. */
  onSelect?: () => void
}

/**
 * The app rail: one icon per area, in a column on the left edge.
 * Areas that don't exist yet are shown without a link so the layout is final.
 */
export function AppRail({
  active,
  onChats,
  onProjects,
  onDocuments,
  onSettings,
}: {
  active: RailItemId | null
  onChats: () => void
  onProjects: () => void
  onDocuments: () => void
  onSettings: () => void
}) {
  const main: RailItem[] = [
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'tasks', label: 'Tasks', icon: CircleCheck },
    { id: 'projects', label: 'Projects', icon: Folder, onSelect: onProjects },
    { id: 'chats', label: 'Chats', icon: MessageCircle, onSelect: onChats },
    { id: 'schedules', label: 'Schedules', icon: Clock },
    { id: 'documents', label: 'Documents', icon: FileText, onSelect: onDocuments },
    { id: 'files', label: 'Files', icon: FolderClosed },
  ]
  const settings: RailItem = { id: 'settings', label: 'Settings', icon: Settings, onSelect: onSettings }
  return (
    <nav aria-label="Main" className="flex h-full w-[48px] shrink-0 select-none flex-col items-center justify-between py-2">
      <div className="flex flex-col items-center gap-1">
        {main.map((item) => (
          <RailButton key={item.id} item={item} active={active === item.id} />
        ))}
      </div>
      <RailButton item={settings} active={active === 'settings'} />
    </nav>
  )
}

function RailButton({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          onClick={item.onSelect}
          className={cn(
            'flex size-[32px] items-center justify-center rounded-[8px] text-foreground/60 outline-none transition-colors',
            'hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
            active && 'bg-foreground/10 text-foreground',
            !item.onSelect && 'cursor-default',
          )}
        >
          <Icon className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
