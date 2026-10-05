/**
 * Jotai atoms for workspace Pages (agent-authored mini dashboards).
 *
 * `pagesAtom` is the single source of truth for the loaded page list —
 * `usePages` writes it and every consumer (sidebar count, grid, detail view)
 * reads it. There is deliberately no local-state mirror.
 *
 * `pagesProjectFilterAtom` selects pages by project (empty = all), plus the
 * `PAGES_UNASSIGNED_PROJECT` sentinel for pages that have no project. It is
 * cleared on workspace switch (PagesHome owns the pruning).
 */

import { atom } from 'jotai'
import type { LoadedPage } from '@otto/shared/pages/types'

export const pagesAtom = atom<LoadedPage[]>([])

/** Sentinel id representing "pages without a project" in the project filter. */
export const PAGES_UNASSIGNED_PROJECT = '__unassigned__'

/** Selected project ids to filter the pages grid by. Empty array = all pages. */
export const pagesProjectFilterAtom = atom<string[]>([])
