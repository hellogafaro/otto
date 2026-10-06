import { describe, expect, it } from 'bun:test'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import { getVisibleSkills, getVisibleSources } from '../skill-source-lists'

const skill = (slug: string, name: string, source: LoadedSkill['source']) =>
  ({ slug, metadata: { name, description: '' }, content: '', path: `/s/${slug}`, source }) as LoadedSkill
const source = (slug: string, name: string, type: LoadedSource['config']['type']) =>
  ({ config: { id: slug, slug, name, type, enabled: true, provider: slug }, guide: null, folderPath: '', workspaceRootPath: '', workspaceId: 'w' }) as LoadedSource

describe('the Skills and Sources grids (and Previous / Next on an item)', () => {
  const skills = [skill('b', 'beta', 'workspace'), skill('g', 'Gamma', 'global'), skill('a', 'Alpha', 'workspace'), skill('p', 'pi', 'project')]
  const sources = [source('w', 'Weather', 'api'), source('l', 'linear', 'mcp'), source('g', 'GitHub', 'mcp'), source('n', 'Notes', 'local')]

  it('lists skills by name, case-insensitive, without changing the list given', () => {
    expect(getVisibleSkills(skills, {}).map((s) => s.slug)).toEqual(['a', 'b', 'g', 'p'])
    expect(skills.map((s) => s.slug)).toEqual(['b', 'g', 'a', 'p'])
  })

  it('keeps the skills of the scope filter', () => {
    expect(getVisibleSkills(skills, { scope: 'workspace' }).map((s) => s.slug)).toEqual(['a', 'b'])
    expect(getVisibleSkills(skills, { scope: 'project' }).map((s) => s.slug)).toEqual(['p'])
  })

  it('lists sources by name and keeps the type filter', () => {
    expect(getVisibleSources(sources, undefined).map((s) => s.config.slug)).toEqual(['g', 'l', 'n', 'w'])
    expect(getVisibleSources(sources, { kind: 'type', sourceType: 'mcp' }).map((s) => s.config.slug)).toEqual(['g', 'l'])
  })
})
