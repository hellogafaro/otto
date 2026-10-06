/**
 * Skills Atom
 *
 * The active workspace's skills (global, workspace and the open chat's project), null until they have loaded.
 * AppShell populates it; the Skills grid, Previous / Next on a skill and the command palette read it.
 */

import { atom } from 'jotai'
import type { LoadedSkill } from '../../shared/types'

export const skillsAtom = atom<LoadedSkill[] | null>(null)
