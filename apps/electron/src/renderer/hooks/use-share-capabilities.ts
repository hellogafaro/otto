import * as React from 'react'

type ShareCapabilities = { sharingEnabled: boolean; viewerConfigured: boolean }

const NONE: ShareCapabilities = { sharingEnabled: false, viewerConfigured: false }

// Module-level cache: both values are server-evaluated and process-stable.
let capabilitiesPromise: Promise<ShareCapabilities> | null = null

/**
 * What the server allows for sharing. `viewerConfigured` is false when
 * OTTO_VIEWER_URL is unset: every share entry point (sessions and pages) is
 * hidden. `sharingEnabled` is the Pages publish gate (viewer configured and
 * the OTTO_FEATURE_PAGES_SHARING flag on).
 */
export function useShareCapabilities(): ShareCapabilities & { loaded: boolean } {
  const [state, setState] = React.useState<ShareCapabilities & { loaded: boolean }>({ ...NONE, loaded: false })
  React.useEffect(() => {
    let stale = false
    if (!capabilitiesPromise) {
      capabilitiesPromise = window.electronAPI.getPageShareCapabilities().catch(() => {
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
