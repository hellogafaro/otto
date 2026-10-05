import * as React from 'react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from '@workspace/ui/components/sidebar'

/**
 * SidebarSection - the sidebar's section for the open area: a group whose title row
 * ends in the area's own actions (a filter menu, an add button), then its content
 * (a list, the settings pages) taking the height that is left; content taller than
 * that (an empty state on a short window) scrolls with the edge fade.
 */
export function SidebarSection({
  title,
  actions,
  children,
}: {
  /** The group's title row; none when the content brings its own headings. */
  title?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SidebarGroup className="min-h-0 flex-1 pb-0">
      {title && (
        <SidebarGroupLabel>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {actions && <div className="-mr-2 flex shrink-0 items-center gap-0.5">{actions}</div>}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent className="no-scrollbar flex min-h-0 flex-1 scroll-fade-y flex-col overflow-y-auto">{children}</SidebarGroupContent>
    </SidebarGroup>
  )
}
