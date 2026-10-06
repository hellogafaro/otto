/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Returns the label tree (nested structure with children) from config.
 * Also exposes a flattened version for components that need flat lookups.
 * Auto-refreshes when workspace changes or labels change (`domain:changed`).
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { LabelConfig } from '@otto/shared/labels'
import { flattenLabels } from '@otto/shared/labels'
import { useLiveData } from './use-live-data'

export interface UseLabelsResult {
  /** Label tree (root-level nodes with nested children) */
  labels: LabelConfig[]
  /** Flattened label list for lookups and non-hierarchical display */
  flatLabels: LabelConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load labels for a workspace via IPC.
 * Returns the tree structure (labels with nested children).
 * Auto-refreshes when workspaceId changes.
 * Reloads on `domain:changed` for labels.
 */
export function useLabels(workspaceId: string | null): UseLabelsResult {
  const [labels, setLabels] = useState<LabelConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Memoized flat version of the tree for lookups
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLabels([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listLabels(workspaceId)
      setLabels(configs)
      setError(null)
    } catch (err) {
      console.error('[useLabels] Failed to load labels:', err)
      setError(err instanceof Error ? err.message : 'Failed to load labels')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Load labels when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  useLiveData('labels', workspaceId, refresh)

  return {
    labels,
    flatLabels,
    isLoading,
    error,
    refresh,
  }
}
