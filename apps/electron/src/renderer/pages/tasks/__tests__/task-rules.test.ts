import { describe, expect, it } from 'bun:test'
import type { Task } from '../../../../shared/types'
import { groupTasks, hasTaskFilters, matchesTaskFilters } from '../use-task-filters'
import { parseMinutes, splitDuration } from '../task-time-section'

const task = (patch: Partial<Task>): Task => ({
  id: 't', projectId: 'p1', title: 'T', description: '', status: 'todo', dueAt: null, assignees: [], resources: [],
  createdBy: 'user:a', createdAt: 0, updatedAt: 0, ...patch,
})

describe('task filters', () => {
  const a = task({ id: 'a', projectId: 'p1', assignees: ['user:me'], status: 'todo' })
  const b = task({ id: 'b', projectId: 'p2', assignees: ['agent:default'], status: 'done' })
  const c = task({ id: 'c', projectId: 'p1', status: 'archived' })

  it('keeps everything without filters, archived included (it folds into its group)', () => {
    expect([a, b, c].filter((x) => matchesTaskFilters(x, {}))).toEqual([a, b, c])
    expect(hasTaskFilters({})).toBe(false)
  })
  it('ANDs fields and ORs the statuses', () => {
    expect([a, b, c].filter((x) => matchesTaskFilters(x, { project: 'p1' }))).toEqual([a, c])
    expect([a, b, c].filter((x) => matchesTaskFilters(x, { assignee: 'user:me' }))).toEqual([a])
    expect([a, b, c].filter((x) => matchesTaskFilters(x, { status: ['todo', 'done'] }))).toEqual([a, b])
    expect([a, b, c].filter((x) => matchesTaskFilters(x, { project: 'p1', status: ['done'] }))).toEqual([])
    expect(hasTaskFilters({ status: ['todo'] })).toBe(true)
  })
  it('Archived keeps only archived tasks', () => {
    expect([a, b, c].filter((x) => matchesTaskFilters(x, { archived: true }))).toEqual([c])
  })
  it('groups by status in lifecycle order, keeping the given order inside a group', () => {
    const d = task({ id: 'd', status: 'doing' })
    const a2 = task({ id: 'a2', status: 'todo' })
    const groups = groupTasks([d, a, b, a2, c, task({ id: 'x', status: 'deleted' })])
    expect(Object.keys(groups)).toEqual(['todo', 'doing', 'done', 'archived'])
    expect(groups.todo.map((x) => x.id)).toEqual(['a', 'a2'])
    expect(groups.doing.map((x) => x.id)).toEqual(['d'])
    expect(groups.archived.map((x) => x.id)).toEqual(['c'])
  })
  it('keeps unlinked tasks in workspace lists, status groups and assignee filters', () => {
    const unlinked = task({ id: 'unlinked', projectId: null, assignees: ['user:me'], status: 'doing' })
    expect(matchesTaskFilters(unlinked, {})).toBe(true)
    expect(matchesTaskFilters(unlinked, { assignee: 'user:me', status: ['doing'] })).toBe(true)
    expect(matchesTaskFilters(unlinked, { project: 'p1' })).toBe(false)
    expect(groupTasks([a, unlinked]).doing).toEqual([unlinked])
  })
})

describe('time entries', () => {
  it('splits a duration into hours and minutes', () => {
    expect(splitDuration(90 * 60_000)).toEqual({ hours: 1, minutes: 30 })
    expect(splitDuration(45 * 60_000)).toEqual({ hours: 0, minutes: 45 })
    expect(splitDuration(120 * 60_000 + 20_000)).toEqual({ hours: 2, minutes: 0 })
  })
  it('accepts whole minutes from 1 to 24 hours', () => {
    expect(parseMinutes('90')).toBe(90)
    expect(parseMinutes(' 1440 ')).toBe(1440)
    for (const bad of ['', '0', '1441', '1.5', 'abc', '-3']) expect(parseMinutes(bad)).toBeNull()
  })
})
