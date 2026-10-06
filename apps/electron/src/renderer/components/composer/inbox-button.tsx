/**
 * The compact bar's Inbox slot (docs/composer.md (g)): a 32px ghost icon button with a red dot while something
 * needs you (an unread notification, a chat with news), opening the Inbox. Always shown, so the bar keeps its
 * shape (open question 7). While a modifier is held it shows its shortcut (`Kbd`) instead of the icon.
 */

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Kbd } from '@workspace/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useHotkeyLabel } from '@/actions'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useNotifications } from '@/hooks/use-notifications'
import { navigate, routes } from '@/lib/navigate'

export function InboxButton({ showKey }: { showKey: boolean }) {
  const { t } = useTranslation()
  const { unreadCount } = useNotifications()
  const sessions = useAtomValue(sessionMetaMapAtom)
  let unreadChats = 0
  for (const meta of sessions.values()) if (meta.hasUnread) unreadChats++
  const count = unreadCount + unreadChats
  const key = useHotkeyLabel('nav.inbox')
  const label = count > 0 ? t('composer.inboxCount', { count }) : t('composer.inbox')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            className="relative"
            onClick={() => navigate(routes.view.inbox())}
          />
        }
      >
        {showKey && key ? (
          <Kbd>{key}</Kbd>
        ) : (
          <>
            <Inbox />
            {count > 0 && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />}
          </>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {key && <Kbd>{key}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
