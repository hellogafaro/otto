/**
 * The workspace's routines with their last runs, and what a person does to one: run it now, enable or disable it,
 * delete it. Built on the automations RPCs (`automations.json` and its history file today); when routines move to
 * their own tables behind the same contract, only this body changes. Same shape as `useTasks`: results, not
 * throws, and a reload after each mutation; it also reloads when the server says the routines changed and on
 * window focus (a run adds history without that event).
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { routinesAtom } from '@/atoms/routines'
import { failedList, listFor } from '@/atoms/workspace-list'
import { useAppShellContext } from '@/context/app-shell-context'
import { toResult } from '@/lib/domain-result'
import { parseRoutines, type Routine } from '@/pages/routines/routine-items'

/** The server keeps at most 20 runs per routine. */
const RUNS = 20

async function loadRoutines(workspaceId: string): Promise<Routine[]> {
  const api = window.electronAPI
  const routines = parseRoutines(await api.getAutomations(workspaceId))
  return Promise.all(routines.map(async (routine) => {
    const runs = await api.getAutomationHistory(workspaceId, routine.id, RUNS)
    return { ...routine, runs: runs.map(({ ts, ok, sessionId, error, skipped }) => ({ ts, ok, sessionId, error, skipped })) }
  }))
}

export function useRoutines() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const [state, setState] = useAtom(routinesAtom)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      setState({ workspaceId: activeWorkspaceId, items: await loadRoutines(activeWorkspaceId), loaded: true })
    } catch (error) {
      console.error('[useRoutines] load failed:', error)
      setState((prev) => failedList(prev, activeWorkspaceId))
      toast.error(t('common.loadFailed'), { id: 'load-failed' })
    }
  }, [activeWorkspaceId, setState, t])

  useEffect(() => {
    void refresh()
    const off = window.electronAPI.onAutomationsChanged((workspaceId) => { if (workspaceId === activeWorkspaceId) void refresh() })
    window.addEventListener('focus', refresh)
    return () => {
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [refresh, activeWorkspaceId])

  const actions = useMemo(() => {
    const api = window.electronAPI
    const workspaceId = activeWorkspaceId ?? ''
    const mutate = <T,>(call: () => Promise<T>) => toResult(call).finally(() => void refresh())
    return {
      /** Runs its actions once now (the RPC's test run, recorded in its history); a prompt starts a chat. */
      runRoutine: (routine: Routine) => mutate(() => api.testAutomation({
        workspaceId,
        automationId: routine.id,
        automationName: routine.name,
        actions: routine.actions,
        permissionMode: routine.permissionMode,
        labels: routine.labels,
        telegramTopic: routine.telegramTopic,
      })),
      setRoutineEnabled: (routine: Routine, enabled: boolean) =>
        mutate(() => api.setAutomationEnabled(workspaceId, routine.event, routine.matcherIndex, enabled)),
      deleteRoutine: (routine: Routine) => mutate(() => api.deleteAutomation(workspaceId, routine.event, routine.matcherIndex)),
    }
  }, [activeWorkspaceId, refresh])

  const { items, loaded } = listFor(state, activeWorkspaceId)
  return { routines: items, loaded, refresh, ...actions }
}
