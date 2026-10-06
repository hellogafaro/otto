/**
 * Agents (`/{ws}/settings/agents`): the workspace's agents as a gallery, the Skills grid's anatomy. The title row
 * holds only "+" (New agent: prefills the composer, "Create an agent named ", and an agent creates it). A tile is the
 * agent's avatar, the "Default" badge on the default one (the oldest, listed first) and its model with how many skills
 * and sources it may use; it opens the agent's page, whose Back returns here and whose Previous / Next step through
 * this gallery. No search: a workspace has a handful of agents (YAGNI). No agents at all: the stock empty page alone.
 * TODO(A2 follow-up): the composer's "With" picker on a new chat.
 */

import { Bot } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposer } from '@/components/composer/composer-provider'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { AgentAvatar } from '@/components/people/agent-avatar'
import { CreateButton } from '@/components/ui/create-button'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useAgents } from '@/hooks/use-agents'
import { routes } from '@/lib/navigate'
import { agentSubtitle, skillKey, sourceKey } from './agent-fields'

export function AgentsPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:agents', placeholder: t('composer.placeholder.start') })
  const { agents, loaded } = useAgents()
  const skills = useAtomValue(skillsAtom) ?? []
  const sources = useAtomValue(sourcesAtom) ?? []
  const { llmConnections } = useAppShellContext()
  const { navigate } = useNavigation()
  const composer = useComposer()

  /** New agent: prefills the composer; Enter starts the chat in which an agent creates it. */
  const newAgent = () => composer.prefill(t('agentEdit.createAgent') + ' ')

  if (loaded && agents.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Bot />} title={t('agents.empty')} description={t('agents.emptyDescription')}>
          <Button onClick={newAgent}>{t('agents.newAgent')}</Button>
        </EntityListEmptyScreen>
      </div>
    )
  }

  const lists = { skills: skills.map(skillKey), sources: sources.map(sourceKey), connections: llmConnections }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('sidebar.agents')} actions={<CreateButton label={t('agents.newAgent')} onClick={newAgent} />} />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <Gallery columns={4}>
            {!loaded
              ? Array.from({ length: 4 }, (_, index) => <GalleryItemSkeleton key={index} />)
              : agents.map((agent) => (
                <GalleryItem
                  key={agent.id}
                  title={agent.title}
                  media={<AgentAvatar agent={agent} />}
                  label={agentSubtitle(agent, lists, t).map((line, index) => <span key={index} className="block truncate text-center">{line}</span>)}
                  badge={agent.isDefault ? <Badge variant="outline">{t('agents.default')}</Badge> : undefined}
                  onClick={() => navigate(routes.view.agents(agent.id))}
                />
              ))}
          </Gallery>
        </div>
      </PageColumn>
    </div>
  )
}
