/**
 * LoginPage - `/login`, the web app's sign-in, outside the app (no shell, no WebSocket). One page,
 * three modes: sign in; "Create the owner account" while the server has no user (`GET /api/setup`);
 * and an invitation link (`?invite=<id>&email=<email>`), which creates the account (or signs in)
 * for that email and accepts the invitation. Success is a full page load to `?next=` (a safe
 * same-origin path) so the app starts with the session cookie.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupInput } from '@workspace/ui/components/input-group'
import { OttoAppIcon } from '@/components/icons/otto-app-icon'
import { loginError, MIN_PASSWORD_LENGTH, safeNextPath, type LoginField } from './login-rules'

type Mode = 'signIn' | 'owner' | 'join'

class AuthError extends Error {
  constructor(readonly code: string | undefined, readonly status: number) {
    super(code ?? String(status))
  }
}

async function post(path: string, body: object): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return
  const data = (await response.json().catch(() => ({}))) as { code?: string }
  throw new AuthError(data.code, response.status)
}

/** A password-type field with the eye button that shows or hides it (28px, nested 2px in the 32px field). */
function PasswordInput({ label, ...props }: React.ComponentProps<'input'> & { label: string }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput {...props} type={shown ? 'text' : 'password'} placeholder={label} aria-label={label} />
      <Button
        type="button"
        variant="ghost"
        size="icon-compact"
        className="mr-0.5"
        aria-label={t(shown ? 'login.hidePassword' : 'login.showPassword')}
        onClick={(event) => {
          setShown(!shown)
          ;(event.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus()
        }}
      >
        {shown ? <EyeOff /> : <Eye />}
      </Button>
    </InputGroup>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const [{ invitationId, invitedEmail, next }] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    return { invitationId: query.get('invite'), invitedEmail: query.get('email') ?? '', next: safeNextPath(query.get('next')) }
  })
  // An invitation link is never the first run; otherwise the server says whether an owner is needed.
  const [mode, setMode] = useState<Mode | null>(invitationId ? 'join' : null)
  const [values, setValues] = useState({ name: '', email: invitationId ? invitedEmail : '', password: '', setupToken: '' })
  const [error, setError] = useState<{ message: string; fields: LoginField[] } | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (mode) return
    fetch('/api/setup', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<{ needsOwner?: boolean }>) : null))
      .then((setup) => setMode(setup?.needsOwner ? 'owner' : 'signIn'))
      .catch(() => setMode('signIn'))
  }, [mode])

  if (!mode) return <div className="h-full bg-background" />

  const creating = mode !== 'signIn'
  const field = (name: LoginField) => ({
    name,
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
    'aria-invalid': error?.fields.includes(name) || undefined,
    required: true,
  })

  const switchMode = (to: Mode) => {
    setError(null)
    setMode(to)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (creating && values.password.length < MIN_PASSWORD_LENGTH) {
      setError({ message: t('login.error.passwordTooShort', { min: MIN_PASSWORD_LENGTH }), fields: ['password'] })
      return
    }
    setError(null)
    setPending(true)
    const email = values.email.trim()
    try {
      if (mode === 'signIn') await post('/api/auth/sign-in/email', { email, password: values.password })
      else await post('/api/auth/sign-up/email', {
        name: values.name.trim(),
        email,
        password: values.password,
        ...(mode === 'owner' && { setupToken: values.setupToken.trim() }),
      })
      if (invitationId) await post('/api/auth/organization/accept-invitation', { invitationId })
      window.location.assign(next)
    } catch (err) {
      const { key, fields } = err instanceof AuthError ? loginError(err.code, err.status) : { key: 'login.error.network', fields: [] }
      setError({ message: t(key, { min: MIN_PASSWORD_LENGTH }), fields })
      setPending(false)
    }
  }

  // `login.signIn.*`, `login.owner.*`, `login.join.*`; signing in from an invitation says it accepts it
  const copy = (key: 'title' | 'subtitle' | 'submit' | 'pending') =>
    t(key === 'subtitle' && mode === 'signIn' && invitationId ? 'login.signIn.inviteSubtitle' : `login.${mode}.${key}`)
  const nameInput = creating && <Input {...field('name')} autoComplete="name" autoFocus placeholder={t('login.name')} aria-label={t('login.name')} />

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full items-center justify-center p-6">
        <main className="w-full max-w-[21rem]">
          <OttoAppIcon className="mb-5" />
          <h1 className="text-base font-medium">{copy('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy('subtitle')}</p>

          {/* Keyed by mode so switching remounts it and the first field takes focus */}
          <form key={mode} className="mt-5" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              {/* An invitation's email is fixed (shown, not editable) and comes before the name */}
              {!invitationId && nameInput}
              <Input
                {...field('email')}
                type="email"
                autoComplete="username"
                readOnly={Boolean(invitationId)}
                autoFocus={!creating && !invitationId}
                placeholder={t('login.email')}
                aria-label={t('login.email')}
              />
              {invitationId && nameInput}
              <PasswordInput
                {...field('password')}
                autoComplete={creating ? 'new-password' : 'current-password'}
                autoFocus={Boolean(invitationId) && !creating}
                label={t('login.password')}
              />
              {mode === 'owner' && <PasswordInput {...field('setupToken')} autoComplete="off" label={t('login.setupToken')} />}
            </div>
            {/* The error, or while creating a password the length it needs, in the same line under the fields */}
            {error ? (
              <p role="alert" className="mt-2 text-xs text-destructive">{error.message}</p>
            ) : creating && (
              <p className="mt-2 text-xs text-muted-foreground">{t('login.passwordHint', { min: MIN_PASSWORD_LENGTH })}</p>
            )}
            <Button type="submit" className="mt-3 w-full" disabled={pending}>
              {copy(pending ? 'pending' : 'submit')}
            </Button>
            {invitationId && (
              <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => switchMode(creating ? 'signIn' : 'join')}>
                {t(creating ? 'login.signInInstead' : 'login.createAccountInstead')}
              </Button>
            )}
          </form>
        </main>
      </div>
    </div>
  )
}
