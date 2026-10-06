import { describe, expect, it } from 'bun:test'
import type { Project, Task } from '../../../../shared/types'
import { buildEntitySections } from '../mention-entities'

const t = (key: string) => key
const task = (id: string, status: Task['status'], updatedAt: number) => ({ id, title: `Task ${id}`, status, updatedAt }) as Task
const project = (id: string, status: Project['status'], updatedAt: number) => ({ id, title: `Project ${id}`, status, updatedAt }) as Project

describe('buildEntitySections', () => {
  it('lists people (not agents) by name, newest tasks and projects first, as entity tokens', () => {
    const sections = buildEntitySections({
      people: [{ actor: 'user:bbbbbbbbbbbb', name: 'Zed', email: 'z@x.test' }, { actor: 'agent:default', name: 'Agent' }, { actor: 'user:aaaaaaaaaaaa', name: 'Ann' }],
      tasks: [task('aaaaaaaaaaaa', 'todo', 1), task('bbbbbbbbbbbb', 'done', 3), task('cccccccccccc', 'archived', 9), task('dddddddddddd', 'doing', 2)],
      projects: [project('aaaaaaaaaaaa', 'active', 1), project('bbbbbbbbbbbb', 'archived', 5)],
    }, t)
    expect(sections.map(section => section.id)).toEqual(['people', 'tasks', 'projects'])
    expect(sections[0]!.items.map(item => item.id)).toEqual(['user:aaaaaaaaaaaa', 'user:bbbbbbbbbbbb'])
    expect(sections[1]!.items.map(item => item.id)).toEqual(['task:bbbbbbbbbbbb', 'task:dddddddddddd', 'task:aaaaaaaaaaaa'])
    expect(sections[2]!.items.map(item => [item.id, item.rank])).toEqual([['project:aaaaaaaaaaaa', 1]])
  })

  it('says there are none once a list has loaded empty, and draws nothing for a list that has not loaded', () => {
    const empty = buildEntitySections({ people: null, tasks: [], projects: [] }, t)
    expect(empty.map(section => [section.id, section.items.length, section.empty])).toEqual([
      ['tasks', 0, 'composer.mention.noTasks'],
      ['projects', 0, 'composer.mention.noProjects'],
    ])
    expect(buildEntitySections({ people: null, tasks: null, projects: null }, t)).toEqual([])
  })
})
