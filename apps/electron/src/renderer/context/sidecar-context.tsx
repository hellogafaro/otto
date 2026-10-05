/**
 * The shell's sidecar (the metadata column in the right gutter of the page frame;
 * a card only when it overlays): one slot, closed by default. A page opens it
 * with its own content and title and closes it again:
 *
 * ```tsx
 * const { openSidecar, closeSidecar } = useSidecar()
 * openSidecar({ title: 'Session info', content: <SessionInfo … /> })
 * ```
 *
 * It closes when the page changes, so it never shows another page's details.
 */

import * as React from 'react'
import { Sidecar } from '@workspace/ui/components/sidecar'
import { useTranslation } from 'react-i18next'
import { useNavigationState } from '@/contexts/navigation-context'

export interface SidecarContent {
  title: React.ReactNode
  content: React.ReactNode
  /** Buttons before Close in the header. */
  actions?: React.ReactNode
}

interface SidecarContextValue {
  open: boolean
  content: SidecarContent | null
  setOpen: (open: boolean) => void
  openSidecar: (content: SidecarContent) => void
  closeSidecar: () => void
  /** Open with `content`, or close when it is already open. */
  toggleSidecar: (content: SidecarContent) => void
}

const SidecarContext = React.createContext<SidecarContextValue | null>(null)

export function SidecarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  // The content outlives the close, so the card can animate out showing it.
  const [content, setContent] = React.useState<SidecarContent | null>(null)
  const navState = useNavigationState()
  const pageKey = JSON.stringify(navState)

  React.useEffect(() => {
    setOpen(false)
  }, [pageKey])

  const value = React.useMemo<SidecarContextValue>(() => ({
    open,
    content,
    setOpen,
    openSidecar: (next) => { setContent(next); setOpen(true) },
    closeSidecar: () => setOpen(false),
    toggleSidecar: (next) => {
      if (open) { setOpen(false); return }
      setContent(next)
      setOpen(true)
    },
  }), [open, content])

  return (
    <SidecarContext.Provider value={value}>
      {children}
    </SidecarContext.Provider>
  )
}

/** The sidecar itself: the `aside` of the shell's `PageFrame`. */
export function SidecarHost() {
  const { t } = useTranslation()
  const { open, content, setOpen } = useSidecar()
  return (
    <Sidecar
      open={open}
      onOpenChange={setOpen}
      title={content?.title}
      actions={content?.actions}
      closeLabel={t('common.close')}
      surface={false} // A/B: true wraps the docked sidecar in a card (undecided)
    >
      {content?.content}
    </Sidecar>
  )
}

export function useSidecar(): SidecarContextValue {
  const context = React.useContext(SidecarContext)
  if (!context) throw new Error('useSidecar must be used within SidecarProvider')
  return context
}
