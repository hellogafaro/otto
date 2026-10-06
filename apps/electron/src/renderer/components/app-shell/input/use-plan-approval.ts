/**
 * Accepting a plan (moved from the old chat input): `otto:approve-plan` leaves Explore and sends the approval with
 * the composer's draft; `otto:approve-plan-with-compact` persists the approval, compacts, and the pending-plan
 * dispatcher sends it once compaction has finished (or on reload). Scoped to the chat's session.
 */

import * as React from 'react'
import { planExecutionMode, type PermissionMode } from '@otto/shared/agent/modes'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { shouldHandleScopedInputEvent } from './input-event-guards'
import { createPendingPlanDispatcher } from './pending-plan-dispatch'

type PlanApprovalEventDetail = {
  sessionId?: string
  planPath?: string
  includeDraftInput?: boolean
}

export function usePlanApproval({
  sessionId,
  isProcessing,
  permissionMode,
  previousPermissionMode,
  onPermissionModeChange,
  submit,
  takeDraft,
}: {
  sessionId?: string
  isProcessing: boolean
  permissionMode?: PermissionMode
  previousPermissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  submit: (message: string) => void
  /** The draft, now cleared: the approval sends it along. */
  takeDraft: () => string
}) {
  const latest = React.useRef({ isProcessing, permissionMode, previousPermissionMode, onPermissionModeChange, submit, takeDraft })
  latest.current = { isProcessing, permissionMode, previousPermissionMode, onPermissionModeChange, submit, takeDraft }

  // Leave Explore so the plan can run without prompts (back to Guarded if the chat came from it); another mode is the user's choice.
  const leaveExplore = React.useCallback(() => {
    const { permissionMode: mode, previousPermissionMode: previous, onPermissionModeChange: change } = latest.current
    if (mode === 'safe') change?.(planExecutionMode(previous))
  }, [])

  React.useEffect(() => {
    if (!sessionId) return
    const scoped = (event: CustomEvent<PlanApprovalEventDetail>) =>
      shouldHandleScopedInputEvent({ sessionId, targetSessionId: event.detail?.sessionId })

    const approve = (event: Event) => {
      const detail = (event as CustomEvent<PlanApprovalEventDetail>).detail
      if (!scoped(event as CustomEvent<PlanApprovalEventDetail>)) return
      const draftInput = detail?.includeDraftInput !== false ? latest.current.takeDraft() : ''
      leaveExplore()
      latest.current.submit(buildPlanApprovalMessage({ planPath: detail?.planPath, draftInput }))
    }

    let preparing = false
    const approveWithCompact = async (event: Event) => {
      const detail = (event as CustomEvent<PlanApprovalEventDetail>).detail
      if (!scoped(event as CustomEvent<PlanApprovalEventDetail>) || preparing || latest.current.isProcessing) return
      preparing = true
      try {
        const draftInputSnapshot = detail?.includeDraftInput !== false ? latest.current.takeDraft() : ''
        leaveExplore()
        // Persist first. Only a successful manual compaction makes it ready; a failed or automatic one never sends.
        await window.electronAPI.sessionCommand(sessionId, { type: 'setPendingPlanExecution', planPath: detail?.planPath ?? '', draftInputSnapshot })
        latest.current.submit('/compact')
      } catch (error) {
        console.error('[usePlanApproval] Failed to start plan compaction:', error)
      } finally {
        preparing = false
      }
    }

    window.addEventListener('otto:approve-plan', approve)
    window.addEventListener('otto:approve-plan-with-compact', approveWithCompact)
    return () => {
      window.removeEventListener('otto:approve-plan', approve)
      window.removeEventListener('otto:approve-plan-with-compact', approveWithCompact)
    }
  }, [sessionId, leaveExplore])

  // Live completion and reload recovery share one persisted-state dispatcher.
  const requestRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => {
    if (!sessionId) return
    const dispatcher = createPendingPlanDispatcher({
      isBusy: () => latest.current.isProcessing,
      load: () => window.electronAPI.getPendingPlanExecution(sessionId),
      claim: () => window.electronAPI.sessionCommand(sessionId, { type: 'markPendingPlanExecutionDispatched' }),
      submit: (pending) => latest.current.submit(buildPlanApprovalMessage({ planPath: pending.planPath, draftInput: pending.draftInputSnapshot })),
      clear: () => window.electronAPI.sessionCommand(sessionId, { type: 'clearPendingPlanExecution' }),
    })
    const request = () => {
      void dispatcher.request().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!/Connection closed|Client disconnected|transport|socket/.test(message)) {
          console.error('[usePlanApproval] Failed to resume pending plan execution:', error)
        }
      })
    }
    const onCompactionComplete = (event: Event) => {
      if ((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId === sessionId) request()
    }
    requestRef.current = request
    window.addEventListener('otto:compaction-complete', onCompactionComplete)
    request()
    return () => {
      window.removeEventListener('otto:compaction-complete', onCompactionComplete)
      if (requestRef.current === request) requestRef.current = null
      dispatcher.dispose()
    }
  }, [sessionId])

  // Completion may be published while the host is finishing the current turn: its idle transition is a second wakeup.
  React.useEffect(() => {
    if (!isProcessing) requestRef.current?.()
  }, [isProcessing, sessionId])
}
