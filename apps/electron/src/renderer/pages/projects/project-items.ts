/**
 * The Project page's pure logic: which library items its Documents and Files tabs show (the project's `library`
 * resources resolved against the loaded library; a ref may dangle), what "Add from library" and "Add member"
 * offer, and the tabs' counts. No React.
 */

import type { LibraryItem, Resource, Task } from '../../../shared/types'

export type ProjectLibraryKind = 'document' | 'file'

/** One library link of the project: its index in `resources` (to remove it) and the item, null when it is gone. */
export interface ProjectLibraryEntry {
  index: number
  resource: Resource
  item: LibraryItem | null
}

/**
 * The tab of a link whose item is gone, guessed from the title it was linked with: a document is stored as
 * `<title>.md`. Shortcut: a renamed or non-markdown document that is deleted lands under Files.
 */
export function guessLibraryKind(title: string): ProjectLibraryKind {
  return /\.md$/i.test(title) ? 'document' : 'file'
}

/** The project's library links of one kind, in `resources` order; folders are in neither tab. */
export function getProjectLibrary(resources: Resource[], items: LibraryItem[], kind: ProjectLibraryKind): ProjectLibraryEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  return resources.flatMap((resource, index) => {
    if (resource.type !== 'library') return []
    const item = byId.get(resource.ref) ?? null
    if (item?.type === 'folder') return []
    return (item ? item.type : guessLibraryKind(resource.title)) === kind ? [{ index, resource, item }] : []
  })
}

/** What "Add from library" offers: items of the kind not linked yet, newest first. */
export function getLibraryCandidates(items: LibraryItem[], resources: Resource[], kind: ProjectLibraryKind): LibraryItem[] {
  const linked = new Set(resources.filter((r) => r.type === 'library').map((r) => r.ref))
  return items.filter((item) => item.type === kind && !linked.has(item.id)).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The workspace's people and agents who are not in the project yet. */
export function getMemberCandidates<T extends { actor: string }>(people: T[], members: string[]): T[] {
  return people.filter((person) => !members.includes(person.actor))
}

/** The tabs' counts: open tasks (not archived) and the Documents and Files tabs' tiles. */
export function getProjectTabCounts(projectId: string, resources: Resource[], tasks: Task[], items: LibraryItem[]) {
  return {
    tasks: tasks.filter((task) => task.projectId === projectId && task.status !== 'archived' && task.status !== 'deleted').length,
    documents: getProjectLibrary(resources, items, 'document').length,
    files: getProjectLibrary(resources, items, 'file').length,
  }
}
