/**
 * Sources Atom
 *
 * The active workspace's sources, null until they have loaded. AppShell populates it; the Sources grid,
 * Previous / Next on a source and the command palette read it.
 */

import { atom } from 'jotai'
import type { LoadedSource } from '../../shared/types'

export const sourcesAtom = atom<LoadedSource[] | null>(null)
