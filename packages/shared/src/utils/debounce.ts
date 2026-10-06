/**
 * Shared debounce (browser-safe, pure): trailing edge, the last call's arguments win.
 * One implementation for every delayed action (draft saving, search) instead of
 * per-module timers.
 */

/** The one delay every search field waits after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 800

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  /** Drop the waiting call, if any. */
  cancel: () => void
  /** Run the waiting call now with its arguments, if there is one. */
  flush: () => void
}

/** Run `fn` once `ms` after the last call, with that call's arguments. */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiting: Args | undefined

  const run = () => {
    const args = waiting
    timer = undefined
    waiting = undefined
    if (args) fn(...args)
  }

  const debounced = ((...args: Args) => {
    waiting = args
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(run, ms)
  }) as Debounced<Args>

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    waiting = undefined
  }

  debounced.flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    run()
  }

  return debounced
}
