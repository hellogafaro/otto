/**
 * PageHeader - what a page renders at its top: `<PageHeader title=… actions=… />`.
 *
 * The design system's `ContentCardHeader` with the app's navigation wired in, so
 * a page passes no handlers:
 * - leading: the menu button below 768px (the sidebar is a sheet there), or Back
 *   on a view with a parent (see `useParentView`; on a phone Back replaces the menu);
 * - crumbs: the parent's name as a link to it, after the title;
 * - a page opened from a list (a chat) also gets the floating Back / Previous / Next
 *   in the card's left margin when the card is wide, and Previous / Next in the
 *   header's actions when it is not;
 * - on Chats, New chat is the last of the actions;
 * - on Electron the header is the window's drag region; the controls opt out.
 */

import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { ContentCardCrumbs, ContentCardHeader } from '@workspace/ui/components/content-card'
import { FloatingNav, FloatingNavButtons } from '@workspace/ui/components/floating-nav'
import { SidebarTrigger, useSidebar } from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/app-shell-context'
import { useSession } from '@/hooks/use-session'
import { isSessionsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useParentView } from '@/hooks/use-parent-view'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { BrowserTabStrip } from '../browser/browser-tab-strip'
import { HeaderNewChat } from './header-new-chat'

export interface PageHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: React.ReactNode
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** Optional dropdown menu content for interactive title (renders chevron when provided) */
  titleMenu?: React.ReactNode
  /**
   * Replacement for the interactive title below 768px. The caller renders its own
   * trigger (see `CompactSessionMenu`): a drawer, because nested submenus would be
   * clipped on a phone.
   */
  compactTitleMenu?: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** Optional className for additional styling */
  className?: string
  /** Whether title is being regenerated (shows shimmer effect) */
  isRegeneratingTitle?: boolean
}

export function PageHeader({
  title,
  badge,
  titleMenu,
  compactTitleMenu,
  actions,
  className,
  isRegeneratingTitle,
}: PageHeaderProps) {
  const { t } = useTranslation()
  const { isCompactMode, onNewChat } = useAppShellContext()
  const { isMobile } = useSidebar()
  const { listNav } = useNavigation()
  const navState = useNavigationState()
  const parent = useParentView()
  const [session] = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

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

  const titleNode = (isCompactMode && compactTitleMenu)
    ? compactTitleMenu
    : titleMenu
      ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="titlebar-no-drag -ml-2 max-w-full min-w-0 text-base font-medium text-foreground"
            >
              {titleContent}
              <ChevronDown className="shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" sideOffset={4}>
            {titleMenu}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )
      : titleContent

  // A page opened from a list has its Back in the card's margin while it is wide.
  const floatingNav = !!(parent && listNav)

  return (
    <>
      <ContentCardHeader
        className={cn('titlebar-drag-region', className)}
        leading={
          <>
            {!(parent && isMobile) && <SidebarTrigger className="titlebar-no-drag" />}
            {parent && (
              <Button
                variant="ghost"
                size="icon-compact"
                className={cn('titlebar-no-drag', floatingNav && '@[896px]/panel:hidden')}
                aria-label={t('common.back')}
                onClick={parent.onBack}
              >
                <ArrowLeft />
              </Button>
            )}
          </>
        }
        title={titleNode}
        crumbs={parent?.label ? (
          <ContentCardCrumbs
            className="titlebar-no-drag"
            crumbs={[{ label: parent.label, onClick: parent.onBack }]}
          />
        ) : undefined}
        actions={
          <div className="titlebar-no-drag flex items-center gap-1">
            <BrowserTabStrip activeSessionId={session.selected} />
            {listNav && (
              <FloatingNavButtons
                previous={{ label: t('common.previous'), onClick: listNav.goPrev, disabled: !listNav.hasPrev }}
                next={{ label: t('common.next'), onClick: listNav.goNext, disabled: !listNav.hasNext }}
              />
            )}
            {actions}
            {onNewChat && isSessionsNavigation(navState) && <HeaderNewChat onClick={onNewChat} />}
          </div>
        }
      />
      {floatingNav && parent && listNav && (
        <FloatingNav
          back={{ label: t('common.back'), onClick: parent.onBack }}
          previous={{ label: t('common.previous'), onClick: listNav.goPrev, disabled: !listNav.hasPrev }}
          next={{ label: t('common.next'), onClick: listNav.goNext, disabled: !listNav.hasNext }}
        />
      )}
    </>
  )
}
