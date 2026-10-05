/**
 * Jotai atoms for workspace Pages (agent-authored mini dashboards).
 *
 * `pagesAtom` is the single source of truth for the loaded page list —
 * `usePages` writes it and every consumer (sidebar count, grid, detail view)
 * reads it. There is deliberately no local-state mirror.
 */

import { atom } from 'jotai'
import type { LoadedPage } from '@otto/shared/pages/types'

export const pagesAtom = atom<LoadedPage[]>([])
