/**
 * What a page gets back from a Projects, Tasks or Library mutation: the value, or the error's `code`
 * (`conflict`, `not_found`, `invalid`, `too_large`, `not_empty`: the domains' `domainError` codes, kept on
 * the RPC error; `unknown` for any other failure). Pages turn a code into a toast. Never throws.
 */

export type MutationResult<T> = { ok: true; value: T } | { ok: false; code: string }

export async function toResult<T>(call: () => Promise<T>): Promise<MutationResult<T>> {
  try {
    return { ok: true, value: await call() }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    return { ok: false, code: typeof code === 'string' && code ? code : 'unknown' }
  }
}
