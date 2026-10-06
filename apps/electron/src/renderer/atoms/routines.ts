/** The workspace's routines and their runs (`useRoutines` loads it; the index, a routine's page and Previous / Next read it). */

import type { Routine } from '@/pages/routines/routine-items'
import { workspaceListAtom } from './workspace-list'

export const routinesAtom = workspaceListAtom<Routine>()
