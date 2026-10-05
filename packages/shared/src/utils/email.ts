/** A basic email shape (one `@`, a dotted domain, no spaces); not full RFC validation. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

/** True when `value` looks like an email address. The empty string is not one: callers that allow "no email" check for it first. */
export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim())
}
