/**
 * PageHeader - what a page renders for its title: `<PageHeader title=… description=… actions=… />`.
 *
 * The design system's `PageHeaderRow` with the app's navigation wired in, so
 * a page passes no handlers. It renders where the page puts it but draws in the
 * `PageFrame`'s slots, so it never sits in a card:
 * - by default the row is the first block of the page's column (`PageColumn`'s
 *   title slot; in place when the page has no column), 64px from the top (on the
 *   top axis below 768px), and it scrolls away with the content: nothing is pinned;
 * - `density="compact"` (the chat only) draws the compact 80px header (24 + 32 + 24) (section-size title)
 *   in the frame's header slot instead, pinned above the wrapper;
 * - the row is the title (plain text: one line that fades out under the actions,
 *   no dropdown, no Back button, no crumbs) and the page's actions. Below 768px
 *   the sidebar is a sheet and its menu button is fixed over the column's
 *   top-left on the axis (the title row clears it), or leads the pinned row;
 * - an item's page (a skill, a source) may pass `description`: its lead line, muted body
 *   text 4px under the title, in the same slot (shown once: the page never repeats it);
 * - a page with a menu of actions on its subject (`menu`: a chat's session menu, a
 *   source's) gets a "More actions" button last in the actions; below 768px a page
 *   may pass `compactMenu` instead (a drawer whose trigger is `HeaderMoreButton`);
 * - going back and stepping through a list is the floating navigation: Back when the
 *   view has a parent (see `useParentView`), Previous / Next when the page is an item of a
 *   list (`listNav`: a chat in Chats, a skill or a source in its grid; Settings' own pages have neither), in the frame's left gutter
 *   with Back level with the title row when it is wide enough, and as ghost buttons at the end of
 *   the row's actions (Back, Previous, Next) when it is not;
 * - on the Chats index, New chat is the last of the actions (a chat has More instead);
 * - with no title (an unbuilt section) only the menu button is drawn;
 * - on Electron the pinned row is the window's drag region; the controls opt out.
 */

import * as React from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp, Ellipsis } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PAGE_INSET, PageHeaderRow, usePageFrame } from '@workspace/ui/components/page-frame'
import { FloatingNav, FloatingNavButtons } from '@workspace/ui/components/floating-nav'
import { SidebarTrigger } from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/app-shell-context'
import { useSession } from '@/hooks/use-session'
import { isSessionsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useParentView } from '@/hooks/use-parent-view'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { BrowserTabStrip } from '../browser/browser-tab-strip'
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

  // Back (a parent) and Previous / Next (a list): in the gutter while it is wide.
  const back = parent ? { label: t('common.back'), onClick: parent.onBack } : undefined
  const previous = listNav ? { label: t('common.previous'), onClick: listNav.goPrev, disabled: !listNav.hasPrev } : undefined
  const next = listNav ? { label: t('common.next'), onClick: listNav.goNext, disabled: !listNav.hasNext } : undefined
  const navInGutter = !!((back || listNav) && frame?.navFits)

  // On a phone the row keeps the menu, Back, the title and More: Previous and Next are the first items of More.
  const listInMore = isCompactMode && !navInGutter && !!listNav
  const phoneListNav = listInMore && !compactMenu
  const moreActions = (isCompactMode && compactMenu)
    ? compactMenu
    : (menu || phoneListNav)
      ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <HeaderMoreButton />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4}>
            {phoneListNav && (
              <>
                <StyledDropdownMenuItem disabled={!listNav.hasPrev} onClick={listNav.goPrev}>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('common.previous')}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem disabled={!listNav.hasNext} onClick={listNav.goNext}>
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('common.next')}</span>
                </StyledDropdownMenuItem>
                {menu && <StyledDropdownMenuSeparator />}
              </>
            )}
            {menu}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )
      : null

  // In-content below 768px, the sheet's menu button is fixed over the column, raised
  // (outline, 32px, as the floating navigation) since content scrolls under it.
  const pinned = density === 'compact'
  const fixedTrigger = !pinned && !!frame?.leading
  const row = (pinned || title !== undefined) && (
    <PageHeaderRow
      density={density}
      className={cn(pinned && 'titlebar-drag-region', fixedTrigger && 'max-md:pl-14', className)}
      leading={!fixedTrigger && <SidebarTrigger className="titlebar-no-drag" />}
      title={titleContent}
      actions={
        <div className="titlebar-no-drag flex items-center gap-1">
          <BrowserTabStrip activeSessionId={session.selected} />
          {!navInGutter && <FloatingNavButtons back={back} previous={listInMore ? undefined : previous} next={listInMore ? undefined : next} />}
          {actions}
          {onNewChat && isSessionsNavigation(navState) && !navState.details && <HeaderNewChat onClick={onNewChat} />}
          {moreActions}
        </div>
      }
    />
  )

  const lead = row && !pinned && description && (
    <p className={cn('text-sm text-muted-foreground', PAGE_INSET, fixedTrigger && 'max-md:pl-14')}>{description}</p>
  )
  const block = <>{row}{lead}</>

  // Outside the shell (a demo) the row draws in place.
  if (!frame) return row ? block : null

  const target = pinned ? frame.header : frame.title
  return (
    <>
      {row && (target ? createPortal(block, target) : !pinned && block)}
      {fixedTrigger && frame.leading && createPortal(
        <SidebarTrigger variant="outline" size="icon" className="titlebar-no-drag" />,
        frame.leading,
      )}
      {navInGutter && frame.nav && createPortal(
        <FloatingNav back={back} previous={previous} next={next} />,
        frame.nav,
      )}
    </>
  )
}
