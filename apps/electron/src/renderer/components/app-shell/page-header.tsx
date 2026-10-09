/**
 * Page titles remain in content (compact chats pin their title). Parent-route
 * Back sits at the panel's upper left; previous/next item and page actions sit
 * at its upper right, without a separate topbar or header border.
 */

import * as React from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Ellipsis } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PageHeaderRow, usePageFrame } from '@workspace/ui/components/page-frame'
import { PageNavigationButtons } from '@workspace/ui/components/page-navigation'
import { SidebarTrigger } from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/app-shell-context'
import { isSessionsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useParentView } from '@/hooks/use-parent-view'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { HeaderNewChat } from './header-new-chat'

export interface PageHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: React.ReactNode
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** The item's description, muted under the title (not with `compact`). */
  description?: React.ReactNode
  /** The menu content of the page's "More actions" button (dropdown items). */
  menu?: React.ReactNode
  /**
   * Replacement for `menu` below 768px. The caller renders its own trigger, a
   * `HeaderMoreButton` (see `CompactSessionMenu`): a drawer, because nested submenus
   * would be clipped on a phone.
   */
  compactMenu?: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** Optional className for additional styling */
  className?: string
  /** Whether title is being regenerated (shows shimmer effect) */
  isRegeneratingTitle?: boolean
  /** The row's density (`PageHeaderRow`): `compact` is the chat's, pinned above its wrapper (no other page yet). */
  density?: 'roomy' | 'compact'
}

/** The header's "More actions": a 28px ghost icon button that opens the page's menu (the trigger of a dropdown or drawer). */
export function HeaderMoreButton(props: Omit<React.ComponentProps<typeof Button>, 'children'>) {
  const { t } = useTranslation()
  return <HeaderIconButton icon={<Ellipsis />} tooltip={t('common.moreActions')} {...props} />
}

export function PageHeader({
  title,
  badge,
  description,
  menu,
  compactMenu,
  actions,
  className,
  isRegeneratingTitle,
  density = 'roomy',
}: PageHeaderProps) {
  const { t } = useTranslation()
  const { isCompactMode, onNewChat } = useAppShellContext()
  const { listNav } = useNavigation()
  const navState = useNavigationState()
  const parent = useParentView()
  const [menuOpen, setMenuOpen] = useState(false)
  const frame = usePageFrame()

  // The open state outlives the unmount of the desktop menu when the window narrows.
  React.useEffect(() => {
    if (isCompactMode && menuOpen) setMenuOpen(false)
    const leading = frame?.leading
    const trailing = frame?.trailing
    if (!leading || !trailing) return
    const root = leading.closest<HTMLElement>('[data-slot="page-frame"]')
    const measure = () => root?.style.setProperty('--page-controls-width', `${Math.max(leading.getBoundingClientRect().width, trailing.getBoundingClientRect().width)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(leading)
    observer.observe(trailing)
    return () => observer.disconnect()
  }, [isCompactMode, menuOpen, frame?.leading, frame?.trailing])

  const titleContent = (
    <motion.span
      initial={false}
      animate={{ opacity: title ? 1 : 0 }}
      transition={{ duration: 0.15 }}
      className={cn('flex min-w-0 items-center gap-1', isRegeneratingTitle && 'animate-shimmer-text')}
    >
      {title}
      {badge}
    </motion.span>
  )

  // Back keeps parent-route semantics; previous/next keep their existing list.
  const back = parent ? { label: t('common.back'), onClick: parent.onBack } : undefined
  const previous = listNav ? { label: t('common.previous'), onClick: listNav.goPrev, disabled: !listNav.hasPrev } : undefined
  const next = listNav ? { label: t('common.next'), onClick: listNav.goNext, disabled: !listNav.hasNext } : undefined
  const moreActions = (isCompactMode && compactMenu)
    ? compactMenu
    : menu
      ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <HeaderMoreButton />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4}>
            {menu}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )
      : null

  const pinned = density === 'compact'
  const row = (pinned || title !== undefined) && (
    <PageHeaderRow
      density={density}
      className={cn(pinned && 'titlebar-drag-region', className)}
      title={titleContent}
      actions={!frame ? <div className="titlebar-no-drag flex items-center gap-1">{actions}{moreActions}</div> : undefined}
    />
  )

  const lead = row && !pinned && description && (
    <p className="text-sm text-muted-foreground">{description}</p>
  )
  const block = <>{row}{lead}</>

  // Outside the shell (a demo) the row draws in place.
  if (!frame) return row ? block : null

  const target = pinned ? frame.header : frame.title
  return (
    <>
      {row && (target ? createPortal(block, target) : !pinned && block)}
      {frame.leading && createPortal(
        <><SidebarTrigger className="titlebar-no-drag" /><PageNavigationButtons back={back} /></>,
        frame.leading,
      )}
      {frame.trailing && createPortal(
        <div className="titlebar-no-drag flex items-center gap-1">
          <PageNavigationButtons previous={previous} next={next} />
          {actions}
          {onNewChat && isSessionsNavigation(navState) && !navState.details && <HeaderNewChat onClick={onNewChat} />}
          {moreActions}
        </div>,
        frame.trailing,
      )}
    </>
  )
}
