import { useEffect, useState } from 'react'
import { isWebUI } from '@/lib/platform'

export interface CurrentUser {
  /** The user id (the actor is `user:<id>`): the signed-in person on the web, never set in Electron (no sessions there). */
  id?: string
  name: string
  email: string
}

/** Electron: the name and email set in Settings -> Preferences (nothing else identifies the local person). */
export async function readLocalAccount(): Promise<CurrentUser> {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  try {
    const prefs = JSON.parse((await window.electronAPI.readPreferences()).content)
    return { name: text(prefs.name), email: text(prefs.email) }
  } catch {
    return { name: '', email: '' }
  }
}

/** One request per page load: signing in or out reloads the page. A failed request is retried by the next caller. */
let request: Promise<CurrentUser | null> | undefined

/**
 * The person using the app. Web: the signed-in one, from the session cookie (`GET /api/auth/get-session`);
 * null while loading and without a session. Electron: the local identity from preferences, without an id.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    let live = true
    if (!isWebUI) {
      void readLocalAccount().then((account) => live && setUser(account))
      return () => {
        live = false
      }
    }
    request ??= fetch('/api/auth/get-session', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<{ user?: { id?: string; name?: string; email?: string } } | null>) : null))
      .then((data) => (data?.user ? { id: data.user.id, name: data.user.name ?? '', email: data.user.email ?? '' } : null))
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
