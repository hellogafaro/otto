/**
 * The workspace's routines with their last runs, and what a person does to one: run it now, pause or resume it,
 * delete it. Same contract as `useAgents`: results, not throws, and a reload after each mutation and on
 * `domain:changed` `routines` (a run that ends pushes one too), plus on window focus.
 */

import { useMemo } from 'react'
import { routinesAtom } from '@/atoms/routines'
import type { Routine } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadRoutines = () => window.electronAPI.getRoutines()

export function useRoutines() {
  const { items: routines, loaded, refresh, mutate } = useWorkspaceList(routinesAtom, loadRoutines, 'routines')

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      /** Starts a run in the background (`running`); a prompt starts a chat. */
      runRoutine: (routine: Routine) => mutate(() => api.runRoutine(routine.id)),
      pauseRoutine: (routine: Routine) => mutate(() => api.pauseRoutine(routine.id)),
      resumeRoutine: (routine: Routine) => mutate(() => api.resumeRoutine(routine.id)),
      deleteRoutine: (routine: Routine) => mutate(() => api.deleteRoutine(routine.id)),
    }
  }, [mutate])

  return { routines: routines as Routine[], loaded, refresh, ...actions }
}
