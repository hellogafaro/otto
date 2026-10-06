import { useEffect, useMemo, useState } from 'react'
import { debounce, SEARCH_DEBOUNCE_MS } from '@otto/shared/utils/debounce'

/**
 * `value` as it was `ms` after it last changed (the shared `debounce`, trailing edge).
 * Returns `[debounced, pending, flush]`: `pending` is true while `value` has not
 * caught up, and `flush()` makes it catch up now (Enter on a search field). The
 * first value is never delayed, and the timer is dropped on unmount.
 */
export function useDebouncedValue<T>(value: T, ms = SEARCH_DEBOUNCE_MS): [debounced: T, pending: boolean, flush: () => void] {
  const [debounced, setDebounced] = useState(value)
  const update = useMemo(() => debounce(setDebounced, ms), [ms])

  useEffect(() => {
    // Back to what is already shown: nothing to wait for.
    if (Object.is(value, debounced)) update.cancel()
    else update(value)
  }, [value, debounced, update])

  useEffect(() => update.cancel, [update])

  return [debounced, !Object.is(value, debounced), update.flush]
}
