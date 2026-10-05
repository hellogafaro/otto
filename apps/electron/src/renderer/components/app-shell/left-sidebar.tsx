import type { LucideIcon } from "lucide-react"
import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronRight } from "lucide-react"

import { SidebarMenuButton } from "@workspace/ui/components/sidebar"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { ContextMenuProvider } from '@/components/ui/menu-context'
import { SidebarMenu, type SidebarMenuProps } from './sidebar-menu'
import { SortableList } from '@/components/ui/sortable-list'

/** Context menu configuration for sidebar items: the props of the menu content. */
export type SidebarContextMenuConfig = SidebarMenuProps

/**
 * Sortable configuration for expandable sidebar items.
 * When present on an expandable LinkItem, its children become drag-sortable.
 */
export interface SortableConfig {
  /** Flat list reorder: called with new ordered array of item IDs after a drag-drop */
  onReorder: (orderedIds: string[]) => void
}

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:allSessions')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon | React.ReactNode  // LucideIcon or custom React element
  iconColor?: string    // Optional color class for the icon
  /** Whether the icon responds to color (uses currentColor). Default true for Lucide icons. */
  iconColorable?: boolean
  variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
  onClick?: () => void
  // Expandable item properties
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  items?: SidebarItem[]    // Subitems as data (rendered as nested LeftSidebar) - supports separators
  // Tutorial system
  dataTutorial?: string // data-tutorial attribute for tutorial targeting
  // Context menu configuration (optional - if provided, right-click shows context menu)
  contextMenu?: SidebarContextMenuConfig
  // Drag-and-drop: flat list reorder (e.g., statuses)
  sortable?: SortableConfig
  // Optional element rendered after the title (e.g., label type icon), revealed on hover
  afterTitle?: React.ReactNode
}

export interface SeparatorItem {
  id: string
  type: 'separator'
}

export type SidebarItem = LinkItem | SeparatorItem

export const isSeparatorItem = (item: SidebarItem): item is SeparatorItem =>
  'type' in item && item.type === 'separator'


interface LeftSidebarProps {
  isCollapsed: boolean
  links: SidebarItem[]
  /** Get props for each item (from unified sidebar navigation) */
  getItemProps?: (id: string) => {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** Currently focused item ID */
  focusedItemId?: string | null
  /** Whether this is a nested sidebar (child of expandable item) */
  isNested?: boolean
}

/**
 * LeftSidebar - the Chats filters: status and label rows of the sidebar's third group.
 *
 * Rows are the sidebar's own `SidebarMenuButton`: 28px, an icon in a 20px slot, the
 * label on the same column as the pages above, the open one filled, the count muted
 * at the end. Rows 2px apart; a nested level (statuses under All Sessions, sub-labels)
 * is indented by exactly one icon slot (20px), no guide line.
 *
 * Navigation is managed by the parent (app-shell) for unified sidebar keyboard
 * navigation. Expandable items show a chevron over their icon on hover; their
 * items may be drag-sortable (@dnd-kit, overlay portaled to the body).
 */
export function LeftSidebar({ links, getItemProps, focusedItemId, isNested }: Omit<LeftSidebarProps, 'isCollapsed'> & { isCollapsed?: boolean }) {
  return (
    <nav
      className={cn("flex select-none flex-col gap-0.5", isNested && "pl-5")}
      aria-label={isNested ? "Sub navigation" : "Main navigation"}
    >
      {links.map((item) => {
        if (isSeparatorItem(item)) return null

        const link = item
        const expandedContent = link.expandable && link.items && link.expanded
          ? renderExpandedContent(link, getItemProps, focusedItemId)
          : null

        return (
          <React.Fragment key={link.id}>
            <SidebarRow link={link} itemProps={getItemProps?.(link.id)} />
            {/* Sub-items sit outside the row's hover scope, so only the pointed row fills. */}
            <AnimatePresence initial={false}>
              {link.expandable && link.items && link.expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  {expandedContent}
                </motion.div>
              )}
            </AnimatePresence>
          </React.Fragment>
        )
      })}
    </nav>
  )
}

// ============================================================
// Expanded Content Renderer
// Chooses between sortable or regular nested sidebar
// ============================================================

function renderExpandedContent(
  link: LinkItem,
  getItemProps: LeftSidebarProps['getItemProps'],
  focusedItemId: string | null | undefined,
): React.ReactNode {
  // Flat sortable (e.g., statuses): wrap items in SortableList
  if (link.sortable && link.items) {
    // Split at first separator: items before are sortable, items after are trailing (non-sortable)
    const separatorIndex = link.items.findIndex(isSeparatorItem)
    const sortableItems = separatorIndex >= 0 ? link.items.slice(0, separatorIndex) : link.items
    const trailingItems = separatorIndex >= 0
      ? link.items.slice(separatorIndex + 1).filter((item): item is LinkItem => !isSeparatorItem(item))
      : []

    return (
      <SortableStatusList
        items={sortableItems}
        onReorder={link.sortable.onReorder}
        getItemProps={getItemProps}
        trailingItems={trailingItems.length > 0 ? trailingItems : undefined}
      />
    )
  }

  // Default: regular nested sidebar (no DnD)
  return (
    <LeftSidebar
      isNested
      getItemProps={getItemProps}
      focusedItemId={focusedItemId}
      links={link.items!}
    />
  )
}

// ============================================================
// SortableStatusList — flat sortable wrapper for status items
// ============================================================

interface SortableStatusListProps {
  items: SidebarItem[]
  onReorder: (orderedIds: string[]) => void
  getItemProps: LeftSidebarProps['getItemProps']
  /** Non-sortable items rendered after the sortable list (e.g., Flagged, Archived) */
  trailingItems?: LinkItem[]
}

function SortableStatusList({ items, onReorder, getItemProps, trailingItems }: SortableStatusListProps) {
  // Filter to LinkItems only (separators don't participate in DnD)
  const sortableItems = items.filter((item): item is LinkItem => !isSeparatorItem(item))

  const handleReorder = React.useCallback((newItems: LinkItem[]) => {
    // Extract the raw IDs (strip 'nav:state:' prefix) for the IPC call
    onReorder(newItems.map(item => item.id.split(':').at(-1)!))
  }, [onReorder])

  return (
    <div className="flex select-none flex-col gap-0.5 pl-5">
      <SortableList
        items={sortableItems}
        onReorder={handleReorder}
        className="flex flex-col gap-0.5"
        renderItem={(item) => <SidebarRow link={item} itemProps={getItemProps?.(item.id)} />}
        renderOverlay={(item) => <SidebarRow link={item} isOverlay />}
      />
      {trailingItems?.map(item => (
        <SidebarRow key={item.id} link={item} itemProps={getItemProps?.(item.id)} />
      ))}
    </div>
  )
}

// ============================================================
// SidebarRow - one 28px row, with its context menu when it has one
// ============================================================

interface SidebarRowProps {
  link: LinkItem
  itemProps?: {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** True when rendering inside the DragOverlay (floating clone) */
  isOverlay?: boolean
}

function SidebarRow({ link, itemProps, isOverlay }: SidebarRowProps) {
  const { ref: itemRef, ...itemRest } = (isOverlay ? undefined : itemProps) ?? {}

  const button = (
    <SidebarMenuButton
      {...itemRest}
      ref={itemRef}
      isActive={link.variant === "default"}
      onClick={isOverlay ? undefined : link.onClick}
      data-tutorial={link.dataTutorial}
    >
      {/* Icon slot, with the toggle chevron over it on hover for expandable items.
       * data-no-dnd keeps a click on the chevron from starting a drag. */}
      <span data-slot="icon-slot" className="relative flex size-5 shrink-0 items-center justify-center">
        {link.expandable && !isOverlay ? (
          <>
            <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/menu-button:opacity-0">
              {renderIcon(link)}
            </span>
            <span
              className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity duration-150 group-hover/menu-button:opacity-100"
              data-no-dnd="true"
              data-touch-reveal="true"
              onClick={(e) => {
                e.stopPropagation()
                link.onToggle?.()
              }}
            >
              <ChevronRight className={cn("transition-transform duration-200", link.expanded && "rotate-90")} />
            </span>
          </>
        ) : (
          renderIcon(link)
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{link.title}</span>
      {/* After-title element (a label's type icon), revealed on hover */}
      {link.afterTitle && (
        <span data-touch-reveal="true" className="shrink-0 opacity-0 transition-opacity group-hover/menu-item:opacity-100">
          {link.afterTitle}
        </span>
      )}
      {link.label && <span className="shrink-0 text-xs tabular-nums">{link.label}</span>}
    </SidebarMenuButton>
  )

  // The context menu wraps the button only, so the open state marks the clicked row, not its sub-items.
  return (
    <div className="group/menu-item relative">
      {link.contextMenu && !isOverlay ? (
        <ContextMenu modal={true}>
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
          <StyledContextMenuContent>
            <ContextMenuProvider>
              <SidebarMenu {...link.contextMenu} />
            </ContextMenuProvider>
          </StyledContextMenuContent>
        </ContextMenu>
      ) : (
        button
      )}
    </div>
  )
}

/**
 * The row's icon: a component (Lucide) or an element. An icon with its own color
 * (a status, a label) is tinted inline; any other inherits the row's muted/foreground.
 */
function renderIcon(link: LinkItem) {
  const isComponent = typeof link.icon === 'function' ||
    (typeof link.icon === 'object' && link.icon !== null && 'render' in link.icon)
  const colorStyle = link.iconColorable !== false && link.iconColor ? { color: link.iconColor } : undefined

  if (isComponent) {
    const Icon = link.icon as React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    return <Icon className="size-3.5 shrink-0" style={colorStyle} />
  }
  // Already a React element or primitive ReactNode.
  // Clone with bare={true} to remove EntityIcon container, the slot provides sizing.
  // Only pass bare to components that accept it (have acceptsBare marker) to avoid
  // forwarding unknown props to DOM elements (e.g., Lucide icons → SVG)
  const iconElement = link.icon as React.ReactNode
  const bareIcon = React.isValidElement(iconElement)
    ? (typeof iconElement.type === 'function' && (iconElement.type as { acceptsBare?: boolean }).acceptsBare)
      ? React.cloneElement(iconElement as React.ReactElement<{ bare?: boolean }>, { bare: true })
      : iconElement
    : iconElement
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-full" style={colorStyle}>
      {bareIcon}
    </span>
  )
}
