import { useEffect, useState } from 'react'
import { isWebUI } from '@/lib/platform'

export interface CurrentUser {
  name: string
  email: string
}

/** One request per page load: signing in or out reloads the page. A failed request is retried by the next caller. */
let request: Promise<CurrentUser | null> | undefined

/**
 * Web only: the signed-in person, from the session cookie (`GET /api/auth/get-session`). Null in
 * Electron (no session: the local identity is preferences.json), while loading and without a session.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    if (!isWebUI) return
    let live = true
    request ??= fetch('/api/auth/get-session', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<{ user?: { name?: string; email?: string } } | null>) : null))
      .then((data) => (data?.user ? { name: data.user.name ?? '', email: data.user.email ?? '' } : null))
      .catch(() => {
        request = undefined
        return null
      })
    void request.then((current) => {
      if (live) setUser(current)
    })
    return () => {
      live = false
    }
  }, [])

  return user
}
