/**
 * What the Skills and Sources grids show, in their order: the items their filter keeps, by name. The grid and
 * Previous / Next on an item (`listNav`) both read this, so stepping follows the grid exactly.
 */

import type { SkillsSearch } from '../../shared/section-search'
import type { LoadedSkill, LoadedSource, SourceFilter } from '../../shared/types'

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

export function getVisibleSkills(skills: LoadedSkill[], search: SkillsSearch): LoadedSkill[] {
  return skills
    .filter((skill) => !search.scope || skill.source === search.scope)
    .sort((a, b) => byName(a.metadata.name || a.slug, b.metadata.name || b.slug))
}

export function getVisibleSources(sources: LoadedSource[], filter: SourceFilter | undefined): LoadedSource[] {
  return sources
    .filter((source) => !filter || source.config.type === filter.sourceType)
    .sort((a, b) => byName(a.config.name || a.config.slug, b.config.name || b.config.slug))
}
