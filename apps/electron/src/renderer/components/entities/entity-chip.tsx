/**
 * EntityChip - a typed reference (`user:<id>`, `task:<id>`, `project:<id>`, `library:<id>`, `agent:<id>`, `comment:<id>`) drawn
 * inline as a tag: the type's icon (an agent's avatar) and the live title in primary on its soft tint (a person reads "@Name"), a button
 * that opens the item, or plain for a person and a comment. Muted "Unavailable" once its list has loaded without it.
 *
 * A chip only reads the shared lists (no fetch per chip): the surface that draws chips calls `useEntityData()` once.
 */

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { CircleCheck, Folder, Library, MessageSquare, type LucideIcon } from 'lucide-react'
import { agentsAtom } from '@/atoms/agents'
import { libraryAtom } from '@/atoms/library'
import { projectsAtom } from '@/atoms/projects'
import { tasksAtom } from '@/atoms/tasks'
import { listFor } from '@/atoms/workspace-list'
import { workspaceMembersAtom } from '@/atoms/workspace-members'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useAgents } from '@/hooks/use-agents'
import { useLibrary } from '@/hooks/use-library'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMemberList } from '@/hooks/use-workspace-members'
import { cn } from '@/lib/utils'
import { AgentAvatar } from '@/components/people/agent-avatar'
import type { Route } from '../../../shared/routes'
import { describeEntity, type EntityInfo, type EntityLists, type EntityType } from './entity-tokens'

const ICONS: Record<EntityType, LucideIcon | null> = {
  user: null,
  task: CircleCheck,
  project: Folder,
  library: Library,
  agent: null,
  comment: MessageSquare,
}

/** Loads the lists chips read titles from (once per surface: a comment thread, the inbox). */
export function useEntityData() {
  useWorkspaceMemberList()
  useTasks()
  useProjects()
  useLibrary()
  useAgents()
}

/** The loaded lists of the active workspace, read without fetching. */
export function useEntityLists(): EntityLists {
  const { activeWorkspaceId } = useAppShellContext()
  const loadedItems = <T,>(list: { items: T[]; loaded: boolean }) => (list.loaded ? list.items : null)
  return {
    members: loadedItems(listFor(useAtomValue(workspaceMembersAtom), activeWorkspaceId)),
    tasks: loadedItems(listFor(useAtomValue(tasksAtom), activeWorkspaceId)),
    projects: loadedItems(listFor(useAtomValue(projectsAtom), activeWorkspaceId)),
    library: loadedItems(listFor(useAtomValue(libraryAtom), activeWorkspaceId)),
    agents: loadedItems(listFor(useAtomValue(agentsAtom), activeWorkspaceId)),
  }
}

/** The chip's text: the title, "Unavailable" when gone, the type's name while it loads (and for a comment). */
export function useEntityLabel(): (info: EntityInfo) => string {
  const { t } = useTranslation()
  return (info) => {
    if (info.missing) return t('entities.unavailable')
    if (info.title === null) return t(`entities.type_${info.type}`)
    return info.type === 'user' ? `@${info.title}` : info.title
  }
}

export function EntityChip({ entity, className }: { entity: string; className?: string }) {
  const { navigate } = useNavigation()
  const label = useEntityLabel()
  const lists = useEntityLists()
  const info = describeEntity(entity, lists)
  if (!info) return <>{entity}</>

  const Icon = info.missing ? null : ICONS[info.type]
  const agent = info.type === 'agent' && !info.missing ? lists.agents?.find((entry) => entry.id === info.id) : undefined
  const route = info.missing ? null : info.route
  const chip = cn(
    // Otto: the tag (DESIGN.md, Tags): primary on its 10% tint (15% dark), `xs` corners, medium, the 14px type icon.
    'inline-flex max-w-full items-baseline gap-1 rounded-xs px-1 align-baseline font-medium [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:self-center',
    info.missing ? 'bg-foreground/5 text-muted-foreground' : 'bg-primary/10 text-primary dark:bg-primary/15',
    className,
  )
  const content = (
    <>
      {Icon && <Icon aria-hidden />}
      {agent && <AgentAvatar agent={agent} size="sm" className="data-[size=sm]:size-3.5 self-center" />}
      <span className="truncate">{label(info)}</span>
    </>
  )
  if (!route) return <span data-entity={entity} className={chip}>{content}</span>
  return (
    <button
      type="button"
      data-entity={entity}
      onClick={() => void navigate(route as Route)}
      className={cn(chip, 'cursor-pointer outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-primary/20')}
    >
      {content}
    </button>
  )
}
