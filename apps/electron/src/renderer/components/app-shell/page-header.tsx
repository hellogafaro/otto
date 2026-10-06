/**
 * PageHeader - what a page renders at its top: `<PageHeader title=… actions=… />`.
 *
 * The design system's `PageHeaderRow` with the app's navigation wired in, so
 * a page passes no handlers. It renders where the page puts it but draws in the
 * `PageFrame`'s header slot (above the column, on the frame), so it never sits in
 * a card:
 * - the row is the title (plain text: one line that fades out under the actions,
 *   no dropdown, no Back button, no crumbs) and the page's actions; the only thing
 *   before it is the menu button below 768px (the sidebar is a sheet there);
 * - a page with a menu of actions on its subject (`menu`: a chat's session menu, a
 *   source's) gets a "More actions" button last in the actions; below 768px a page
 *   may pass `compactMenu` instead (a drawer whose trigger is `HeaderMoreButton`);
 * - going back and stepping through a list is the floating navigation: Back when the
 *   view has a parent (see `useParentView`), Previous / Next when the page is an item of a
 *   list (`listNav`: a chat in Chats, a page in Settings), in the frame's left gutter
 *   with Back on the title's line when it is wide enough, and as ghost buttons at the end of
 *   the header's actions (Back, Previous, Next) when it is not;
 * - on the Chats index, New chat is the last of the actions (a chat has More instead);
 * - on Electron the header is the window's drag region; the controls opt out.
 */

import * as React from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Ellipsis } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PageHeaderRow, usePageFrame } from '@workspace/ui/components/page-frame'
import { FloatingNav, FloatingNavButtons } from '@workspace/ui/components/floating-nav'
import { SidebarTrigger } from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/app-shell-context'
import { useSession } from '@/hooks/use-session'
import { isSessionsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useParentView } from '@/hooks/use-parent-view'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { BrowserTabStrip } from '../browser/browser-tab-strip'
import { HeaderNewChat } from './header-new-chat'

export interface PageHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: React.ReactNode
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
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
}

/** The header's "More actions": a 28px ghost icon button that opens the page's menu (the trigger of a dropdown or drawer). */
export function HeaderMoreButton(props: Omit<React.ComponentProps<typeof Button>, 'children'>) {
  const { t } = useTranslation()
  return <HeaderIconButton icon={<Ellipsis />} tooltip={t('common.moreActions')} {...props} />
}

export function PageHeader({
  title,
  badge,
  menu,
  compactMenu,
  actions,
  className,
  isRegeneratingTitle,
}: PageHeaderProps) {
  const { t } = useTranslation()
  const { isCompactMode, onNewChat } = useAppShellContext()
  const { listNav } = useNavigation()
  const navState = useNavigationState()
  const parent = useParentView()
  const [session] = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const frame = usePageFrame()

  // The open state outlives the unmount of the desktop menu when the window narrows.
  React.useEffect(() => {
    if (isCompactMode && menuOpen) setMenuOpen(false)
  }, [isCompactMode, menuOpen])

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

  // Back (a parent) and Previous / Next (a list): in the gutter while it is wide.
  const back = parent ? { label: t('common.back'), onClick: parent.onBack } : undefined
  const previous = listNav ? { label: t('common.previous'), onClick: listNav.goPrev, disabled: !listNav.hasPrev } : undefined
  const next = listNav ? { label: t('common.next'), onClick: listNav.goNext, disabled: !listNav.hasNext } : undefined
  const navInGutter = !!((back || listNav) && frame?.navFits)

  const row = (
    <PageHeaderRow
      className={cn('titlebar-drag-region', className)}
      leading={<SidebarTrigger className="titlebar-no-drag" />}
      title={titleContent}
      actions={
        <div className="titlebar-no-drag flex items-center gap-1">
          <BrowserTabStrip activeSessionId={session.selected} />
          {!navInGutter && <FloatingNavButtons back={back} previous={previous} next={next} />}
          {actions}
          {onNewChat && isSessionsNavigation(navState) && !navState.details && <HeaderNewChat onClick={onNewChat} />}
          {moreActions}
        </div>
      }
    />
  )

  // Outside the shell (a demo) the row draws in place.
  if (!frame) return row

  return (
    <>
      {frame.header && createPortal(row, frame.header)}
      {navInGutter && frame.nav && createPortal(
        <FloatingNav back={back} previous={previous} next={next} />,
        frame.nav,
      )}
    </>
  )
}
