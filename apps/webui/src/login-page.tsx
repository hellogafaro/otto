/**
 * LoginPage - `/login`, the web app's sign-in, outside the app (no shell, no WebSocket). One page,
 * three modes: sign in; "Create the owner account" while the server has no user (`GET /api/setup`);
 * and an invitation link (`?invite=<id>&email=<email>`), which creates the account (or signs in)
 * for that email and accepts the invitation. The form is the TanStack form of DESIGN.md (Forms). Success is a full page load to `?next=` (a safe
 * same-origin path) so the app starts with the session cookie.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup } from '@workspace/ui/components/field'
import { InputGroup, InputGroupInput } from '@workspace/ui/components/input-group'
import { OttoAppIcon } from '@/components/icons/otto-app-icon'
import { submitForm } from '@/lib/form'
import { loginError, loginFields, MIN_PASSWORD_LENGTH, safeNextPath, type LoginField } from './login-rules'

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

  useEffect(() => {
    if (mode) return
    fetch('/api/setup', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<{ needsOwner?: boolean }>) : null))
      .then((setup) => setMode(setup?.needsOwner ? 'owner' : 'signIn'))
      .catch(() => setMode('signIn'))
  }, [mode])

  if (!mode) return <div className="h-full bg-background" />

  const creating = mode !== 'signIn'
  // `login.signIn.*`, `login.owner.*`, `login.join.*`; signing in from an invitation says it accepts it
  const subtitle = t(mode === 'signIn' && invitationId ? 'login.signIn.inviteSubtitle' : `login.${mode}.subtitle`)

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full items-center justify-center p-6">
        <main className="w-full max-w-[21rem]">
          <OttoAppIcon className="mb-5" />
          <h1 className="text-base font-medium">{t(`login.${mode}.title`)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {/* Keyed by mode so switching remounts the form: fresh fields, and the first takes focus */}
          <LoginForm key={mode} mode={mode} invitationId={invitationId} email={invitedEmail} next={next}>
            {invitationId && (
              <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => setMode(creating ? 'signIn' : 'join')}>
                {t(creating ? 'login.signInInstead' : 'login.createAccountInstead')}
              </Button>
            )}
          </LoginForm>
        </main>
      </div>
    </div>
  )
}

function LoginForm({ mode, invitationId, email, next, children }: { mode: Mode; invitationId: string | null; email: string; next: string; children: ReactNode }) {
  const { t } = useTranslation()
  const creating = mode !== 'signIn'
  const min = MIN_PASSWORD_LENGTH
  // An invitation's email is fixed (shown, not editable) and comes before the name.
  const order: LoginField[] = invitationId ? ['email', 'name', 'password'] : ['name', 'email', 'password']
  const rules = loginFields(creating, {
    required: t('common.required'),
    invalidEmail: t('login.error.invalidEmail'),
    passwordTooShort: t('login.error.passwordTooShort', { min }),
  })
  const form = useForm({
    defaultValues: { name: '', email: invitationId ? email : '', password: '' },
    validators: {
      // The request is the last validation: the server's refusal marks the fields it is about and the form (the
      // message shows once, under the fields). It reruns on every submit, so it clears itself; typing clears a field's.
      onSubmitAsync: async ({ value }) => {
        const body = { email: value.email.trim(), password: value.password }
        try {
          if (mode === 'signIn') await post('/api/auth/sign-in/email', body)
          else await post('/api/auth/sign-up/email', { ...body, name: value.name.trim() })
          if (invitationId) await post('/api/auth/organization/accept-invitation', { invitationId })
        } catch (err) {
          const { key, fields } = err instanceof AuthError ? loginError(err.code, err.status) : { key: 'login.error.network', fields: [] }
          const error = { message: t(key, { min }) }
          return { form: error.message, fields: Object.fromEntries(fields.map((name) => [name, error])) }
        }
      },
    },
    onSubmit: async () => {
      window.location.assign(next)
      // Stay pending until the page unloads.
      await new Promise(() => {})
    },
  })

  // One control of the form, in the column's fields. Each field validates itself on blur (and the submit runs them
  // all), never while typing; its error shows as soon as it has one.
  const field = (name: LoginField, control: (props: Record<string, unknown>) => ReactNode) => (
    <form.Field name={name} validators={{ onBlur: rules[name] }}>
      {(f) => {
        const isInvalid = !f.state.meta.isValid
        return (
          <Field data-invalid={isInvalid}>
            {control({
              id: f.name,
              name: f.name,
              value: f.state.value,
              'aria-invalid': isInvalid,
              // A server error stays until the value changes: leaving a field (the submit focuses the first invalid one) must not clear another's.
              onBlur: () => !f.state.meta.errorMap.onSubmit && f.handleBlur(),
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => f.handleChange(event.target.value),
            })}
          </Field>
        )
      }}
    </form.Field>
  )
  const nameInput = creating && field('name', (props) => <Input {...props} autoComplete="name" autoFocus placeholder={t('login.name')} aria-label={t('login.name')} />)

  return (
    <form noValidate className="mt-5" onSubmit={(event) => submitForm(event, form)}>
      <FieldGroup className="gap-2">
        {!invitationId && nameInput}
        {field('email', (props) => (
          <Input
            {...props}
            type="email"
            autoComplete="username"
            readOnly={Boolean(invitationId)}
            autoFocus={!creating && !invitationId}
            placeholder={t('login.email')}
            aria-label={t('login.email')}
          />
        ))}
        {invitationId && nameInput}
        {field('password', (props) => (
          <PasswordInput
            {...props}
            autoComplete={creating ? 'new-password' : 'current-password'}
            autoFocus={Boolean(invitationId) && !creating}
            label={t('login.password')}
          />
        ))}
      </FieldGroup>
      {/* The first error (a field's, in the order shown, or the whole form's), or while creating a password the length it needs, in the same line under the fields */}
      <form.Subscribe
        selector={(state) => {
          for (const name of order) {
            const meta = state.fieldMeta[name]
            if (meta && !meta.isValid) return (meta.errors[0] as { message?: string } | undefined)?.message
          }
          return state.errors.find((error) => typeof error === 'string') as string | undefined
        }}
      >
        {(message) =>
          message ? (
            <FieldError className="mt-2 text-xs">{message}</FieldError>
          ) : creating && (
            <p className="mt-2 text-xs text-muted-foreground">{t('login.passwordHint', { min })}</p>
          )
        }
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="mt-3 w-full" loading={isSubmitting}>
            {t(`login.${mode}.submit`)}
          </Button>
        )}
      </form.Subscribe>
      {children}
    </form>
  )
}
