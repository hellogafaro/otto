import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { debounce, DEBOUNCE_MS } from '@otto/shared/utils/debounce'

export interface AutosaveState<T> {
  /** What the field shows: the last change, saved or not. */
  value: T
  /** A change is waiting or being sent. */
  pending: boolean
  /** The last save's failure; cleared by the next change or retry. */
  error: Error | null
}

export interface AutosaveEvents {
  /** After each save the server acknowledged, with what `save` returned (e.g. the new `updatedAt`). */
  saved: (result: unknown) => void
  failed: (error: Error) => void
  /** A save that failed with `code === 'conflict'`; the draft is already dropped. */
  conflict: () => void
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The save loop behind `useAutosave`, without React. `change` shows the value at once and saves it `ms` after the
 * last change; saves never overlap; the acknowledged value advances only after a success; the loop runs until the
 * draft equals it. `adopt` takes a new external value only when the draft is clean.
 */
export function createAutosave<T>(
  initial: T,
  save: (value: T) => unknown | Promise<unknown>,
  notify: (state: AutosaveState<T>) => void,
  events: AutosaveEvents,
  ms = DEBOUNCE_MS,
) {
  let draft = initial
  let acknowledged = initial
  let lastInitial = initial
  let running = false
  let error: Error | null = null

  const emit = () => notify({ value: draft, pending: running || (!error && !sameValue(draft, acknowledged)), error })

  const persist = async () => {
    if (running) return
    running = true
    error = null
    try {
      while (!sameValue(draft, acknowledged)) {
        const next = draft
        emit()
        const result = await save(next)
        acknowledged = next
        events.saved(result)
      }
    } catch (cause) {
      if ((cause as { code?: unknown } | null)?.code === 'conflict') {
        draft = acknowledged
        events.conflict()
      } else {
        error = cause instanceof Error ? cause : new Error(String(cause))
        events.failed(error)
      }
    } finally {
      running = false
      emit()
    }
  }

  const debounced = debounce(() => void persist(), ms)

  return {
    change(next: T) {
      draft = next
      error = null
      emit()
      debounced()
    },
    /** Save now what is waiting (on blur, and on leaving). */
    flush: debounced.flush,
    retry: () => void persist(),
    /** A new value from outside (a refetch, a live update): taken only when nothing here is unsaved. */
    adopt(next: T) {
      if (sameValue(next, lastInitial)) return
      lastInitial = next
      if (running || !sameValue(draft, acknowledged)) return
      draft = acknowledged = next
      emit()
    },
  }
}

/**
 * A field that saves itself: no Save button. `change(next)` shows it now and saves 800 ms after the last change;
 * call `flush()` on blur; leaving saves too. One toast per save, replaced by the next (one `id`); a failure shows
 * its error and `retry()` sends it again; a `conflict` (stale `expectedUpdatedAt`) says so, drops the draft and
 * calls `onConflict` so the page refetches.
 */
export function useAutosave<T>(
  initial: T,
  save: (value: T) => unknown | Promise<unknown>,
  options: { message?: string; id?: string; onSaved?: (result: unknown) => void; onConflict?: () => void; /** The wait after the last change (default `DEBOUNCE_MS`; an agent's page waits 600 ms, BB's). */ ms?: number } = {},
) {
  const { t } = useTranslation()
  const latest = useRef({ save, options, t })
  latest.current = { save, options, t }
  const [state, setState] = useState<AutosaveState<T>>({ value: initial, pending: false, error: null })
  const [autosave] = useState(() =>
    createAutosave(initial, (value) => latest.current.save(value), setState, {
      saved: (result) => {
        const { options, t } = latest.current
        toast.success(options.message ?? t('common.saved'), { id: options.id ?? 'saved' })
        options.onSaved?.(result)
      },
      failed: (error) => toast.error(error.message, { id: latest.current.options.id ?? 'saved' }),
      conflict: () => {
        const { options, t } = latest.current
        toast.error(t('common.changedElsewhere'), { id: options.id ?? 'saved' })
        options.onConflict?.()
      },
    }, options.ms),
  )

  const initialJson = JSON.stringify(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is read when its JSON changes
  useEffect(() => autosave.adopt(initial), [autosave, initialJson])
  useEffect(() => autosave.flush, [autosave])

  return { value: state.value, change: autosave.change, flush: autosave.flush, pending: state.pending, error: state.error, retry: autosave.retry }
}
