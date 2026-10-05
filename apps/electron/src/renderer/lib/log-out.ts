import i18n from 'i18next'
import { toast } from 'sonner'

/** Web only: the server clears the session cookie, then the login page takes over. */
export async function logOut(): Promise<void> {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    if (!response.ok) throw new Error(`Log out failed (${response.status})`)
    window.location.assign('/login')
  } catch {
    toast.error(i18n.t('toast.couldNotLogOut'))
  }
}
