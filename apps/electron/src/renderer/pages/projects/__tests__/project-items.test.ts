import { describe, expect, it } from 'bun:test'
import type { LibraryItem, Resource, Task } from '../../../../shared/types'
import { getLibraryCandidates, getMemberCandidates, getProjectLibrary, getProjectTabCounts, guessLibraryKind } from '../project-items'

function item(id: string, type: LibraryItem['type'], updatedAt = 1): LibraryItem {
  return { id, type, parentId: null, title: type === 'document' ? `${id}.md` : id, mime: null, size: null, createdBy: 'user:aaaaaaaaaaaa', createdAt: 1, updatedAt }
}
const link = (ref: string, title = ref): Resource => ({ type: 'library', ref, title })
const url: Resource = { type: 'url', ref: 'https://example.com', title: 'Example' }

function task(id: string, projectId: string, status: Task['status']): Task {
  return { id, projectId, title: id, description: '', status, dueAt: null, assignees: [], resources: [], createdBy: 'user:aaaaaaaaaaaa', createdAt: 1, updatedAt: 1 }
}

describe('getProjectLibrary', () => {
  const items = [item('d1', 'document'), item('f1', 'file'), item('folder', 'folder')]

  it('resolves library links by kind, keeping their index in resources', () => {
    const resources = [url, link('f1'), link('d1'), link('folder')]
    expect(getProjectLibrary(resources, items, 'document').map((e) => [e.index, e.item?.id])).toEqual([[2, 'd1']])
    expect(getProjectLibrary(resources, items, 'file').map((e) => [e.index, e.item?.id])).toEqual([[1, 'f1']])
  })

  it('keeps dangling links with no item, in the tab their title suggests', () => {
    const resources = [link('gone', 'Notes.md'), link('lost', 'report.pdf')]
    expect(getProjectLibrary(resources, items, 'document')).toEqual([{ index: 0, resource: resources[0]!, item: null }])
    expect(getProjectLibrary(resources, items, 'file')).toEqual([{ index: 1, resource: resources[1]!, item: null }])
  })

  it('guesses a document from a .md title', () => {
    expect(guessLibraryKind('Plan.MD')).toBe('document')
    expect(guessLibraryKind('plan.md.pdf')).toBe('file')
  })
})

describe('getLibraryCandidates', () => {
  it('offers items of the kind not linked yet, newest first', () => {
    const items = [item('d1', 'document', 1), item('d2', 'document', 3), item('d3', 'document', 2), item('f1', 'file')]
    expect(getLibraryCandidates(items, [link('d1')], 'document').map((i) => i.id)).toEqual(['d2', 'd3'])
  })
})

describe('getMemberCandidates', () => {
  it('lists the people and agents not in the project', () => {
    const people = [{ actor: 'user:a' }, { actor: 'user:b' }, { actor: 'agent:default' }]
    expect(getMemberCandidates(people, ['user:a']).map((p) => p.actor)).toEqual(['user:b', 'agent:default'])
  })
})

describe('getProjectTabCounts', () => {
  it('counts open tasks of the project and the tiles of each library tab', () => {
    const tasks = [task('t1', 'p1', 'todo'), task('t2', 'p1', 'done'), task('t3', 'p1', 'archived'), task('t4', 'p2', 'todo')]
    const items = [item('d1', 'document'), item('f1', 'file')]
    expect(getProjectTabCounts('p1', [link('d1'), link('f1'), link('gone', 'x.md'), url], tasks, items)).toEqual({ tasks: 2, documents: 2, files: 1 })
  })
})
