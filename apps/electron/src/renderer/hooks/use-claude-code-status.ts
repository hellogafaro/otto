import { useCallback, useEffect, useState } from 'react'
import type { ClaudeCodeStatus } from '../../shared/types'

/**
 * Whether the user's own `claude` runs on the machine the server is on (`claude --version`, no credentials):
 * checked on mount while `enabled`, and again with `check` ("Check again"). `status` is null until the first answer.
 */
export function useClaudeCodeStatus(enabled = true) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await window.electronAPI.getClaudeCodeStatus())
    } catch {
      setStatus({ found: false, path: 'claude' })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) void check()
  }, [enabled, check])

  return { status, checking, check }
}
