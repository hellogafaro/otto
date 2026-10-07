/**
 * The `@` menu's people, agents, tasks and projects, from the lists the app already loads. Pure: the composer passes
 * the lists (null until loaded) and gets the menu's sections; the menu ranks what is typed (prefix first, then
 * newest). Each item's id is the entity token that goes into the text (`task:<id>`). In a chat its members (other
 * than the viewer) come first, in their own section, and are left out of People and Agents.
 */

import type { Agent, Project, Task } from '../../../shared/types'
import type { MentionSection } from '@/components/ui/mention-menu'

/** How many rows of each type the menu shows before anything is typed. */
const PREVIEW = 3

interface Lists {
  /** `user:<id>` and `agent:<id>` actors: only people here (the agents come as `agents`). */
  people: { actor: string; name: string; email?: string }[] | null
  /** The workspace's agents, the default first. */
  agents: Agent[] | null
  tasks: Task[] | null
  projects: Project[] | null
  /** The open chat's members other than the viewer ('user:<id>', 'agent:<id>'), agents first; none outside a chat. */
  members?: readonly string[]
}

export function buildEntitySections(lists: Lists, t: (key: string) => string): MentionSection[] {
  const sections: MentionSection[] = []
  const members = new Set(lists.members ?? [])

  const people = (lists.people ?? [])
    .filter((person) => person.actor.startsWith('user:'))
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''))
    .map((person) => ({ id: person.actor, type: 'user' as const, label: person.name || person.email || person.actor, description: person.email }))
  // The workspace's own order: the default agent first.
  const agents = (lists.agents ?? []).map((agent) => ({ id: `agent:${agent.id}`, type: 'agent' as const, label: agent.title, agent }))

  const byId = new Map<string, MentionSection['items'][number]>([...agents, ...people].map((item) => [item.id, item]))
  const inChat = [...members].flatMap((actor) => byId.get(actor) ?? [])
  if (inChat.length > 0) sections.push({ id: 'members', label: t('composer.mention.members'), items: inChat, preview: PREVIEW })

  if (lists.people) {
    const items = people.filter((item) => !members.has(item.id))
    if (items.length > 0) sections.push({ id: 'people', label: t('composer.mention.people'), items, preview: PREVIEW })
  }

  if (lists.agents) {
    const items = agents.filter((item) => !members.has(item.id))
    sections.push({ id: 'agents', label: t('composer.mention.agents'), items, empty: t('composer.mention.noAgents'), preview: PREVIEW })
  }

  if (lists.tasks) {
    const items = lists.tasks
      .filter((task) => task.status === 'todo' || task.status === 'doing' || task.status === 'done')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((task) => ({ id: `task:${task.id}`, type: 'task' as const, label: task.title, rank: task.updatedAt }))
    sections.push({ id: 'tasks', label: t('composer.mention.tasks'), items, empty: t('composer.mention.noTasks'), preview: PREVIEW })
  }

  if (lists.projects) {
    const items = lists.projects
      .filter((project) => project.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((project) => ({ id: `project:${project.id}`, type: 'project' as const, label: project.title, rank: project.updatedAt }))
    sections.push({ id: 'projects', label: t('composer.mention.projects'), items, empty: t('composer.mention.noProjects'), preview: PREVIEW })
  }

  return sections
}
