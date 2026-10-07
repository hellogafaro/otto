/**
 * The one place that maps the Agents UI to an agent's fields (`agents(title, instructions, provider, model,
 * thinking_level, skills, sources, avatar)`, docs/final-plan.md 2.7): the page's draft and the patch it saves, the
 * gallery's subtitle, the provider and model choices from the person's connections, and the `[]` = all checklists.
 * Pure, so it is unit-tested.
 */

import type { TFunction } from 'i18next'
import { getProviderMetadata } from '@config/provider-metadata'
import type { ThinkingLevel } from '@otto/shared/agent/thinking-levels'
import type { Agent, AgentUpdate, LlmConnection, LoadedSkill, LoadedSource } from '../../../shared/types'

/** What the agent's page edits, saved as one draft. `model` null is the connection's default. */
export interface AgentDraft {
  title: string
  instructions: string
  provider: string
  model: string | null
  thinkingLevel: ThinkingLevel
  skills: string[]
  sources: string[]
  avatar: string
}

export const toDraft = (agent: Agent): AgentDraft => ({
  title: agent.title,
  instructions: agent.instructions,
  provider: agent.provider,
  model: agent.model,
  thinkingLevel: agent.thinkingLevel,
  skills: agent.skills,
  sources: agent.sources,
  avatar: agent.avatar,
})

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What changed from the saved agent, or null; never an empty name (it springs back on blur). */
export function toPatch(agent: Agent, draft: AgentDraft): Omit<AgentUpdate, 'expectedUpdatedAt'> | null {
  const patch: Omit<AgentUpdate, 'expectedUpdatedAt'> = {}
  const title = draft.title.trim()
  if (title && title !== agent.title) patch.title = title
  if (draft.instructions !== agent.instructions) patch.instructions = draft.instructions
  if (draft.provider !== agent.provider) patch.provider = draft.provider
  if (draft.model !== agent.model) patch.model = draft.model
  if (draft.thinkingLevel !== agent.thinkingLevel) patch.thinkingLevel = draft.thinkingLevel
  if (!same(draft.skills, agent.skills)) patch.skills = draft.skills
  if (!same(draft.sources, agent.sources)) patch.sources = draft.sources
  if (draft.avatar !== agent.avatar) patch.avatar = draft.avatar
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * The id an agent stores for a skill or a source: its slug, the identifier the MCP pool and skill mentions use.
 */
export const skillKey = (skill: LoadedSkill) => skill.slug
export const sourceKey = (source: LoadedSource) => source.config.slug

// =============================================================================
// Provider and model
// =============================================================================

/** A provider's name ("Anthropic", "OpenAI"), else the name of a connection of it, else the stored value. */
export function providerLabel(provider: string, connections: readonly LlmConnection[]): string {
  return getProviderMetadata(provider)?.name ?? connections.find((c) => c.type === provider)?.name ?? provider
}

export interface Choice {
  value: string
  label: string
}

/** The providers of the person's connections, the agent's own first when they have none of it. */
export function providerChoices(current: string, connections: readonly LlmConnection[]): Choice[] {
  const providers = [...new Set(connections.map((c) => c.type))]
  if (!providers.includes(current)) providers.unshift(current)
  return providers.map((value) => ({ value, label: providerLabel(value, connections) }))
}

/** The models of a provider across the person's connections of it, deduplicated by id. */
export function modelChoices(provider: string, connections: readonly LlmConnection[]): Choice[] {
  const seen = new Map<string, string>()
  for (const connection of connections) {
    if (connection.type !== provider) continue
    for (const model of connection.models ?? []) {
      const id = typeof model === 'string' ? model : model.id
      if (!seen.has(id)) seen.set(id, typeof model === 'string' ? model : (model.name ?? model.id))
    }
  }
  return [...seen].map(([value, label]) => ({ value, label }))
}

/** A model's name for the gallery and the picker; null (the connection's default) is the provider's name. */
export function modelLabel(agent: Pick<Agent, 'provider' | 'model'>, connections: readonly LlmConnection[]): string {
  if (!agent.model) return providerLabel(agent.provider, connections)
  return modelChoices(agent.provider, connections).find((choice) => choice.value === agent.model)?.label ?? agent.model
}

// =============================================================================
// Skills and sources: `[]` is all
// =============================================================================

/** How many of `all` the list allows: all of them for `[]`, else the ones that still exist. */
export function allowedCount(selected: readonly string[], all: readonly string[]): number {
  return selected.length === 0 ? all.length : selected.filter((key) => all.includes(key)).length
}

export const isAllowed = (selected: readonly string[], key: string) => selected.length === 0 || selected.includes(key)

/**
 * The list after the row `key` is toggled. From `[]` (all) unchecking one lists the others; checking the last one
 * missing is `[]` again; the last allowed one cannot be unchecked (an empty list would mean all).
 */
export function toggleAllowed(selected: readonly string[], all: readonly string[], key: string): string[] {
  const current = selected.length === 0 ? [...all] : selected.filter((entry) => all.includes(entry))
  const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
  if (next.length === 0) return [...selected]
  return all.every((entry) => next.includes(entry)) ? [] : next
}

/** The gallery tile's caption, two lines so neither truncates in a 171px tile: the model, then "3 skills · 2 sources". */
export function agentSubtitle(
  agent: Agent,
  lists: { skills: readonly string[]; sources: readonly string[]; connections: readonly LlmConnection[] },
  t: TFunction,
): [model: string, access: string] {
  return [
    modelLabel(agent, lists.connections),
    [
      t('agents.skillCount', { count: allowedCount(agent.skills, lists.skills) }),
      t('agents.sourceCount', { count: allowedCount(agent.sources, lists.sources) }),
    ].join(' · '),
  ]
}
