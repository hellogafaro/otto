import { describe, expect, it } from 'bun:test'
import { loginError, loginFields, MIN_PASSWORD_LENGTH, safeNextPath } from '../login-rules'

describe('safeNextPath', () => {
  it('keeps a same-origin app path with its query', () => {
    expect(safeNextPath('/test/chats/abc?status=todo')).toBe('/test/chats/abc?status=todo')
  })

  it('falls back to / for anything else', () => {
    for (const next of [null, '', 'test', 'https://evil.example', '//evil.example', '/\\evil.example', '/a\nb', '/login', '/login/', '/login.html', '/login?next=%2Ftest']) {
      expect(safeNextPath(next), String(next)).toBe('/')
    }
  })
})

describe('loginError', () => {
  it('marks the fields a code is about', () => {
    expect(loginError('INVALID_EMAIL_OR_PASSWORD', 401)).toEqual({ key: 'login.error.invalidCredentials', fields: ['email', 'password'] })
    expect(loginError('OWNER_ONLY', 403)).toEqual({ key: 'login.error.ownerOnly', fields: ['email'] })
  })

  it('names rate limits and falls back to the generic message', () => {
    expect(loginError(undefined, 429).key).toBe('login.error.tooManyAttempts')
    expect(loginError('SOMETHING_NEW', 500)).toEqual({ key: 'login.error.generic', fields: [] })
  })
})

describe('loginFields', () => {
  const messages = { required: 'required', invalidEmail: 'email', passwordTooShort: 'short' }
  const messageOf = (schema: { safeParse: (value: string) => { error?: { issues: { message: string }[] } } }, value: string) => schema.safeParse(value).error?.issues[0]?.message

  it('needs an email that is one, and a password', () => {
    const fields = loginFields(false, messages)
    expect(messageOf(fields.email, '  ')).toBe('required')
    expect(messageOf(fields.email, 'nope')).toBe('email')
    expect(messageOf(fields.email, ' a@b.co ')).toBeUndefined()
    expect(messageOf(fields.password, '')).toBe('required')
    expect(messageOf(fields.password, 'x')).toBeUndefined()
    expect(messageOf(fields.name, '')).toBeUndefined()
  })

  it('creating an account also needs a name and a long enough password', () => {
    const fields = loginFields(true, messages)
    expect(messageOf(fields.name, ' ')).toBe('required')
    expect(messageOf(fields.password, '')).toBe('required')
    expect(messageOf(fields.password, 'x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('short')
    expect(messageOf(fields.password, 'x'.repeat(MIN_PASSWORD_LENGTH))).toBeUndefined()
  })
})
