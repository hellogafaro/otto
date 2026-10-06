/**
 * Keeps data in step with the server: when `domain:changed` arrives for this domain and workspace, `reload` runs
 * (debounced, so a burst of writes reloads once) unless one of this hook's own mutations is in flight (it reloads
 * when it ends). Returns `mutate`: runs a call as a `MutationResult`, then reloads, also on failure so the page
 * shows what changed (`conflict`).
 */

import { useCallback, useEffect, useRef } from 'react'
import { debounce } from '@otto/shared/utils/debounce'
import { toResult } from '@/lib/domain-result'
import type { DomainChange } from '../../shared/types'

export const RELOAD_MS = 200

export function useLiveData(domain: DomainChange['domain'], workspaceId: string | null, reload: () => unknown) {
  const mutating = useRef(0)
  const latest = useRef(reload)
  latest.current = reload

  useEffect(() => {
    if (!workspaceId) return
    const run = debounce(() => {
      if (mutating.current === 0) void latest.current()
    }, RELOAD_MS)
    const off = window.electronAPI.onDomainChanged((change) => {
      if (change.domain === domain && change.workspaceId === workspaceId) run()
    })
    return () => {
      off()
      run.cancel()
    }
  }, [domain, workspaceId])

  return useCallback(<T,>(call: () => Promise<T>) => {
    mutating.current++
    return toResult(call).finally(() => {
      mutating.current--
      void latest.current()
    })
  }, [])
}
