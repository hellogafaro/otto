import * as React from 'react'

type ShareCapabilities = { viewerConfigured: boolean }

const NONE: ShareCapabilities = { viewerConfigured: false }

// Module-level cache: the value is server-evaluated and process-stable.
let capabilitiesPromise: Promise<ShareCapabilities> | null = null

/**
 * What the server allows for sharing. `viewerConfigured` is false when
 * OTTO_VIEWER_URL is unset: every session share entry point is hidden.
 */
export function useShareCapabilities(): ShareCapabilities & { loaded: boolean } {
  const [state, setState] = React.useState<ShareCapabilities & { loaded: boolean }>({ ...NONE, loaded: false })
  React.useEffect(() => {
    let stale = false
    if (!capabilitiesPromise) {
      capabilitiesPromise = window.electronAPI.getSessionShareCapabilities().catch(() => {
        capabilitiesPromise = null
        return NONE
      })
    }
    void capabilitiesPromise.then(caps => {
      if (!stale) setState({ ...caps, loaded: true })
    })
    return () => { stale = true }
  }, [])
  return state
}
