import { describe, expect, it } from 'bun:test'
import { loginError, safeNextPath } from '../login-rules'

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
    expect(loginError('SETUP_TOKEN_INVALID', 403).fields).toEqual(['setupToken'])
  })

  it('names rate limits and falls back to the generic message', () => {
    expect(loginError(undefined, 429).key).toBe('login.error.tooManyAttempts')
    expect(loginError('SOMETHING_NEW', 500)).toEqual({ key: 'login.error.generic', fields: [] })
  })
})
