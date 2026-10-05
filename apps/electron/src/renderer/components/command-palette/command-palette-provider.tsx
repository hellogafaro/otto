/**
 * CommandPaletteProvider - one command palette for the whole app.
 *
 * ⌘K / Ctrl+K anywhere toggles it (`app.commandPalette`; it does not open over another
 * dialog or menu), and `useCommandPalette().open(category?)` opens it from a page's or
 * the sidebar's Search, on that category. While it is open every other shortcut is
 * paused (the action registry skips them). Closing returns focus to where it was; a
 * pick runs once the dialog has closed, so an action that moves focus (New chat) keeps it.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CommandDialog } from '@workspace/ui/components/command'
import { useAction } from '@/actions'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { CommandPalette, type PaletteItem } from './command-palette'
import type { PaletteCategory } from './palette-model'
import { usePaletteData } from './use-palette-data'

interface CommandPaletteContextValue {
  /** Open the palette, on a category (All when none is given). */
  open: (category?: PaletteCategory) => void
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue>({ open: () => {} })

export const useCommandPalette = () => React.useContext(CommandPaletteContext)

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<{ open: boolean; category: PaletteCategory }>({ open: false, category: 'all' })
  const isOpen = React.useRef(false)
  isOpen.current = state.open
  const pending = React.useRef<(() => void) | null>(null)

  const open = React.useCallback((category: PaletteCategory = 'all') => setState({ open: true, category }), [])
  const close = React.useCallback(() => setState((s) => ({ ...s, open: false })), [])

  useAction(
    'app.commandPalette',
    () => (isOpen.current ? close() : open()),
    { enabled: () => isOpen.current || !hasOpenOverlay() },
  )

  const value = React.useMemo(() => ({ open }), [open])

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandDialog
        open={state.open}
        onOpenChange={(next) => (next ? setState((s) => ({ ...s, open: true })) : close())}
        onOpenChangeComplete={(next) => {
          if (next || !pending.current) return
          const run = pending.current
          pending.current = null
          run()
        }}
        title={t('sidebar.search')}
        description={t('commandPalette.description')}
      >
        <ConnectedPalette
          category={state.category}
          onPick={(item) => {
            pending.current = item.run
            close()
          }}
        />
      </CommandDialog>
    </CommandPaletteContext.Provider>
  )
}

/** The panel on the app's live data; mounted only while the dialog is open. */
function ConnectedPalette({ category, onPick }: { category: PaletteCategory; onPick: (item: PaletteItem) => void }) {
  const data = usePaletteData()
  return <CommandPalette data={data} initialCategory={category} onPick={onPick} />
}
