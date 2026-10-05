/**
 * The shell's floating card (the right-hand card beside the page card): one slot,
 * closed by default. A page opens it with its own content and title and closes it
 * again:
 *
 * ```tsx
 * const { openCard, closeCard } = useFloatingCard()
 * openCard({ title: 'Session info', content: <SessionInfo … /> })
 * ```
 *
 * It closes when the page changes, so it never shows another page's details.
 */

import * as React from 'react'
import { FloatingCard } from '@workspace/ui/components/floating-card'
import { useTranslation } from 'react-i18next'
import { useNavigationState } from '@/contexts/navigation-context'

export interface FloatingCardContent {
  title: React.ReactNode
  content: React.ReactNode
  /** Buttons before Close in the card's header. */
  actions?: React.ReactNode
}

interface FloatingCardContextValue {
  open: boolean
  openCard: (content: FloatingCardContent) => void
  closeCard: () => void
  /** Open with `content`, or close when it is already open. */
  toggleCard: (content: FloatingCardContent) => void
}

const FloatingCardContext = React.createContext<FloatingCardContextValue | null>(null)

export function FloatingCardProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  // The content outlives the close, so the card can animate out showing it.
  const [content, setContent] = React.useState<FloatingCardContent | null>(null)
  const navState = useNavigationState()
  const pageKey = JSON.stringify(navState)

  React.useEffect(() => {
    setOpen(false)
  }, [pageKey])

  const value = React.useMemo<FloatingCardContextValue>(() => ({
    open,
    openCard: (next) => { setContent(next); setOpen(true) },
    closeCard: () => setOpen(false),
    toggleCard: (next) => {
      if (open) { setOpen(false); return }
      setContent(next)
      setOpen(true)
    },
  }), [open])

  return (
    <FloatingCardContext.Provider value={value}>
      {children}
      <FloatingCardHost open={open} content={content} onOpenChange={setOpen} />
    </FloatingCardContext.Provider>
  )
}

function FloatingCardHost({ open, content, onOpenChange }: { open: boolean; content: FloatingCardContent | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <FloatingCard
      open={open}
      onOpenChange={onOpenChange}
      title={content?.title}
      actions={content?.actions}
      closeLabel={t('common.close')}
    >
      {content?.content}
    </FloatingCard>
  )
}

export function useFloatingCard(): FloatingCardContextValue {
  const context = React.useContext(FloatingCardContext)
  if (!context) throw new Error('useFloatingCard must be used within FloatingCardProvider')
  return context
}
