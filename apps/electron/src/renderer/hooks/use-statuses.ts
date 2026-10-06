/**
 * useStatuses Hook
 *
 * React hook to load and manage workspace statuses.
 * Auto-refreshes when workspace changes or statuses change (`domain:changed`).
 */

import { useState, useEffect, useCallback } from 'react'
import type { StatusConfig } from '@otto/shared/statuses'
import { useLiveData } from './use-live-data'

export interface UseStatusesResult {
  statuses: StatusConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load statuses for a workspace via IPC
 * Auto-refreshes when workspaceId changes
 */
export function useStatuses(workspaceId: string | null): UseStatusesResult {
  const [statuses, setStatuses] = useState<StatusConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setStatuses([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listStatuses(workspaceId)
      setStatuses(configs)
      setError(null)
    } catch (err) {
      console.error('[useStatuses] Failed to load statuses:', err)
      setError(err instanceof Error ? err.message : 'Failed to load statuses')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Load statuses when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  useLiveData('statuses', workspaceId, refresh)

  return {
    statuses,
    isLoading,
    error,
    refresh,
  }
}
