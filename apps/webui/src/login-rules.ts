/**
 * The sign-in page's pure rules: where to go after signing in, and what each auth error says.
 * The server keeps its own copy of the `next` rule (`safeNextPath` in packages/server-core).
 */

/** Better Auth's `minPasswordLength` on the server. */
export const MIN_PASSWORD_LENGTH = 12

export type LoginField = 'name' | 'email' | 'password' | 'setupToken'

/** `next` when it is a same-origin app path (one leading `/`, no backslash or control characters, not the login page), otherwise `/`. */
export function safeNextPath(next: string | null): string {
  if (!next || next.length > 2048) return '/'
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/'
  try {
    const parsed = new URL(next, 'http://app.invalid')
    if (parsed.origin !== 'http://app.invalid' || /^\/(login|login\.html)\/?$/.test(parsed.pathname)) return '/'
  } catch {
    return '/'
  }
  return next
}

/** The i18n key of an auth error (`{ code }` from the server, or the HTTP status) and the fields it marks. */
export function loginError(code: string | undefined, status: number): { key: string; fields: LoginField[] } {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD': return { key: 'login.error.invalidCredentials', fields: ['email', 'password'] }
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return { key: 'login.error.userExists', fields: ['email'] }
    case 'INVALID_EMAIL': return { key: 'login.error.invalidEmail', fields: ['email'] }
    case 'PASSWORD_TOO_SHORT': return { key: 'login.error.passwordTooShort', fields: ['password'] }
    case 'PASSWORD_TOO_LONG': return { key: 'login.error.passwordTooLong', fields: ['password'] }
    case 'SETUP_TOKEN_INVALID': return { key: 'login.error.setupToken', fields: ['setupToken'] }
    case 'INVITATION_REQUIRED': return { key: 'login.error.invitationRequired', fields: ['email'] }
    case 'INVITATION_NOT_FOUND':
    case 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION': return { key: 'login.error.invitationInvalid', fields: [] }
  }
  if (status === 429) return { key: 'login.error.tooManyAttempts', fields: [] }
  return { key: 'login.error.generic', fields: [] }
}
