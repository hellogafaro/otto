/**
 * A list loaded for one workspace (Projects, Tasks, Library). It remembers which workspace it came from,
 * so after a switch (or a response that arrives late) the old list is never shown for the new workspace.
 */

import { atom } from 'jotai'

export interface WorkspaceList<T> {
  workspaceId: string | null
  items: T[]
  loaded: boolean
}

export const workspaceListAtom = <T,>() => atom<WorkspaceList<T>>({ workspaceId: null, items: [], loaded: false })

const NONE: never[] = []

/** The list for this workspace: empty and not loaded until it has loaded for it. */
export function listFor<T>(state: WorkspaceList<T>, workspaceId: string | null): { items: T[]; loaded: boolean } {
  return state.workspaceId !== null && state.workspaceId === workspaceId
    ? { items: state.items, loaded: state.loaded }
    : { items: NONE, loaded: false }
}
