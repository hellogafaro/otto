/**
 * ComposerProvider - the one composer's place in the shell (docs/composer.md (f)). Mounted once around the page
 * frame. Pages tell it what they are about (`useComposerContext`, the last one mounted wins) and anything can
 * drive it (`useComposer`: prefill, focus, expand, collapse). `ShellComposer` draws it in the frame's slot and
 * implements the handle, so the editor never remounts on navigation.
 */

import * as React from 'react'
import type { ComposerContext } from './composer-state'

export interface ComposerHandle {
  /** Replace the text, put the cursor at the end, focus, and expand when it needs the room. */
  prefill: (text: string) => void
  focus: () => void
  expand: () => void
  collapse: () => void
}

interface ComposerRegistry {
  set: (id: string, context: ComposerContext) => void
  remove: (id: string) => void
}

const RegistryContext = React.createContext<ComposerRegistry | null>(null)
const HandleContext = React.createContext<{ handle: ComposerHandle; ref: React.RefObject<ComposerHandle | null> } | null>(null)
const CurrentContext = React.createContext<ComposerContext | null>(null)

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  // Registered contexts in mount order; re-registering keeps its place.
  const [entries, setEntries] = React.useState<[string, ComposerContext][]>([])
  const registry = React.useMemo<ComposerRegistry>(() => ({
    set: (id, context) => setEntries((list) => {
      const index = list.findIndex(([entry]) => entry === id)
      if (index === -1) return [...list, [id, context]]
      const next = list.slice()
      next[index] = [id, context]
      return next
    }),
    remove: (id) => setEntries((list) => list.filter(([entry]) => entry !== id)),
  }), [])

  // A stable handle that forwards to whatever `ShellComposer` put in the ref (nothing while no bar shows).
  const ref = React.useRef<ComposerHandle | null>(null)
  const handles = React.useMemo(() => ({
    ref,
    handle: {
      prefill: (text: string) => ref.current?.prefill(text),
      focus: () => ref.current?.focus(),
      expand: () => ref.current?.expand(),
      collapse: () => ref.current?.collapse(),
    },
  }), [])

  return (
    <RegistryContext.Provider value={registry}>
      <HandleContext.Provider value={handles}>
        <CurrentContext.Provider value={entries.at(-1)?.[1] ?? null}>
          {children}
        </CurrentContext.Provider>
      </HandleContext.Provider>
    </RegistryContext.Provider>
  )
}

/** Drive the composer from anywhere: `prefill`, `focus`, `expand`, `collapse`. No-ops outside the shell. */
export function useComposer(): ComposerHandle {
  const handles = React.useContext(HandleContext)
  return handles?.handle ?? NOOP_HANDLE
}

const NOOP_HANDLE: ComposerHandle = { prefill: () => {}, focus: () => {}, expand: () => {}, collapse: () => {} }

/** For `useComposerContext`: the stable registry. */
export function useComposerRegistry() {
  return React.useContext(RegistryContext)
}

/** For `ShellComposer`: the page's context and the ref it fills with the handle. */
export function useComposerShell() {
  return {
    context: React.useContext(CurrentContext),
    handleRef: React.useContext(HandleContext)?.ref ?? null,
  }
}
