/**
 * HomePage (`/{ws}/home`; `/{ws}/inbox`, the old Inbox, redirects here) - where a day starts: a greeting by the time
 * of day with your first name, a calm line, then the shell's ONE composer, full, floating in the page under them
 * (`PageComposerAnchor`: the frame's `centered` placement, so sending starts a chat as anywhere and the composer
 * glides down into it), then four cards (`home-cards.tsx`). On the photo wallpaper (the shell mounts it on Home).
 * No title row: the greeting is the page's head (below 768px `PageHeader` still draws the sidebar's menu button).
 */

import { useTranslation } from 'react-i18next'
import { PageColumn } from '@workspace/ui/components/page'
import { PageComposerAnchor } from '@workspace/ui/components/page-frame'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { useCurrentUser } from '@/hooks/use-current-user'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ChatsCard, NotificationsCard, RoutinesCard, TasksCard } from './home-cards'
import { dayPart, firstName } from './home-rules'

function Greeting() {
  const { t } = useTranslation()
  const { members, me } = useWorkspaceMembers()
  const user = useCurrentUser()
  const name = firstName(members.find((member) => member.actor === me)?.name ?? user?.name)
  const part = dayPart(new Date().getHours())
  return (
    <hgroup className="flex flex-col items-center gap-1 px-4 text-center">
      <h1 className="text-xl font-medium text-muted-foreground">{name ? t(`home.${part}Name`, { name }) : t(`home.${part}`)}</h1>
      <p className="text-xl font-medium text-foreground">{t('home.prompt')}</p>
    </hgroup>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:home', mode: 'full', placeholder: t('composer.placeholder.start') })
  return (
    <div className="flex h-full flex-col">
      <PageHeader />
      <PageColumn>
        {/* The greeting sits 128px down (88px on a phone, under the menu button), the composer 20px under it. */}
        <div className="flex flex-col items-center gap-5 pt-22 md:pt-32">
          <Greeting />
          <PageComposerAnchor />
        </div>
        <div data-content-start="" className="grid grid-cols-1 gap-3 @xl/panel:grid-cols-2">
          <TasksCard />
          <ChatsCard />
          <NotificationsCard />
          <RoutinesCard />
        </div>
      </PageColumn>
    </div>
  )
}
