import i18n from 'i18next'
import { toast } from '@workspace/ui/components/sonner'

/** Web only: the server ends the session (Better Auth clears its cookie), then the login page takes over. */
export async function logOut(): Promise<void> {
  try {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`Log out failed (${response.status})`)
    window.location.assign('/login')
  } catch {
    toast.error(i18n.t('toast.couldNotLogOut'))
  }
}
