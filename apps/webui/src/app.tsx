/**
 * Web UI App — thin wrapper that:
 * 1. Fetches WS config from the server
 * 2. Creates the web API adapter + sets window.electronAPI
 * 3. Delegates to the Electron renderer's App component
 *
 * Mobile responsiveness is handled by container queries and isAutoCompact
 * in the shared renderer components — no webui-specific layout hacks needed.
 */

import { Loader } from 'lucide-react'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { createWebApi } from './adapter/web-api'
import { logOut } from '@/lib/log-out'
import type { WsRpcClient } from '../../electron/src/transport/client'

// Lazy-load the Electron App after window.electronAPI is set up.
// This prevents any Electron component from accessing window.electronAPI
// before the web adapter is ready.
const ElectronApp = lazy(() => import('@/app'))

type Phase = 'loading' | 'error' | 'ready'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen text-foreground/50">
      <Loader className="size-5 animate-spin" />
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium text-destructive">{t("webui.connectionFailed")}</p>
      <p className="text-[13px] max-w-md text-center">{message}</p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onRetry}
          className="px-4 py-1.5 rounded-md bg-background text-[13px] text-foreground/70 cursor-pointer"
        >
          {t("common.retry")}
        </button>
        <button
          onClick={() => void logOut()}
          className="px-4 py-1.5 rounded-md bg-background text-[13px] text-foreground/70 cursor-pointer"
        >
          {t("webui.logOut")}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const clientRef = useRef<WsRpcClient | null>(null)
  const initRef = useRef(false)

  const initialize = async () => {
    setPhase('loading')
    setError('')

    try {
      // 1. Fetch WS URL from the server (cookie auth)
      const configRes = await fetch('/api/config', { credentials: 'same-origin' })
      if (!configRes.ok) {
        if (configRes.status === 401) {
          // Session expired — redirect to login, which returns to this page
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
          return
        }
        throw new Error(`Failed to fetch config: ${configRes.status}`)
      }

      const config = await configRes.json() as { wsUrl: string }
      if (!config.wsUrl) throw new Error('Server did not return a WebSocket URL')
      // Dev: the session cookie belongs to this origin, so connect through the
      // Vite /ws proxy instead of the server's public address (another host).
      const wsUrl = import.meta.env.DEV
        ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
        : config.wsUrl

      // 2. Determine workspace — check URL params first
      const params = new URLSearchParams(window.location.search)
      let workspaceId = params.get('workspace') ?? undefined

      // If no workspace in URL, fetch the default from the server
      // so we can include it in the WebSocket handshake
      if (!workspaceId) {
        try {
          const wsRes = await fetch('/api/config/workspaces', { credentials: 'same-origin' })
          if (wsRes.ok) {
            const { defaultWorkspaceId } = await wsRes.json() as { defaultWorkspaceId?: string }
            if (defaultWorkspaceId) workspaceId = defaultWorkspaceId
          }
        } catch {
          // Non-fatal — workspace will be set via switchWorkspace later
        }
      }

      // 3. Create web API adapter
      // Destroy previous client on retry
      if (clientRef.current) {
        clientRef.current.destroy()
      }

      const { api, client } = createWebApi({ serverUrl: wsUrl, workspaceId })
      clientRef.current = client

      // 4. Set window.electronAPI — must happen before any Electron component mounts
      ;(window as any).electronAPI = api

      // 5. Connect the WebSocket client
      client.connect()

      setPhase('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('error')
    }
  }

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true
      initialize()
    }

    return () => {
      // Cleanup on unmount
      clientRef.current?.destroy()
    }
  }, [])

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'error') return <ErrorScreen message={error} onRetry={initialize} />

  return (
    <Suspense fallback={<LoadingScreen />}>
      <ElectronApp />
    </Suspense>
  )
}
