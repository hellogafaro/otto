/**
 * HomePage (`/{ws}/home`; `/{ws}/inbox`, the old Inbox, redirects here) - where a day starts: a greeting by the time
 * of day with your first name in the centered title row, then four stacked cards
 * (`home-cards.tsx`). The shell's one full composer stays at the bottom, as on every other page.
 */

import { useTranslation } from 'react-i18next'
import { PageColumn } from '@workspace/ui/components/page'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { useCurrentUser } from '@/hooks/use-current-user'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ChatsCard, NotificationsCard, RoutinesCard, TasksCard } from './home-cards'
import { dayPart, firstName } from './home-rules'

export function HomePage() {
  const { t } = useTranslation()
  const { members, me } = useWorkspaceMembers()
  const user = useCurrentUser()
  const name = firstName(members.find((member) => member.actor === me)?.name ?? user?.name)
  const part = dayPart(new Date().getHours())
  useComposerContext({ key: 'page:home', placeholder: t('composer.placeholder.start') })
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={name ? t(`home.${part}Name`, { name }) : t(`home.${part}`)}
        className="relative [&_h1]:text-center [&_h1>span]:justify-center"
      />
      <PageColumn>
        <NotificationsCard />
        <TasksCard />
        <ChatsCard />
        <RoutinesCard />
      </PageColumn>
    </div>
  )
}
