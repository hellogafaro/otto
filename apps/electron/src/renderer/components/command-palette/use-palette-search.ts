/**
 * The palette's server search (`search:run`): asked for the settled query, it answers the
 * keys of the chats, tasks, projects and library items found by what they hold, with the text
 * around the match. A failed search answers nothing, so the palette keeps its local rows.
 */

import * as React from 'react'
import { foundKeys } from './palette-model'

export function usePaletteSearch() {
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState<{ query: string; keys: ReadonlyMap<string, string> }>({ query: '', keys: new Map() })

  React.useEffect(() => {
    if (!query) return
    let current = true
    window.electronAPI
      .searchWorkspace(query)
      .then(foundKeys, () => new Map<string, string>())
      .then((keys) => current && setFound({ query, keys }))
    return () => {
      current = false
    }
  }, [query])

  return { found, onSearch: setQuery }
}
