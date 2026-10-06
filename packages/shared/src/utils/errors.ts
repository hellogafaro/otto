/** A failure the caller can act on. `code` is a stable machine string (`not_found`, `conflict`, ...) that the transport sends to clients as is. */
export function domainError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: 'DomainError', code, domain: true })
}

export function isDomainError(e: unknown): e is Error & { code: string } {
  return e instanceof Error && (e as { domain?: unknown }).domain === true && typeof (e as { code?: unknown }).code === 'string'
}
