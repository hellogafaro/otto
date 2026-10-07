/**
 * The shell's sidecar (an item's details, floating right of the page frame's column; a card only when it
 * overlays): one slot, closed by default. A page that has details renders them anywhere in its tree:
 *
 * ```tsx
 * <SidecarDetails title={t('tasks.details')}><TaskDetails taskId={task.id} /></SidecarDetails>
 * ```
 *
 * which draws the floating toggle (`SidecarToggle`, in the frame's trailing slot; never in the title row) and
 * portals the details into the sidecar, mounted from the first open. It closes when the page goes away, so it
 * never shows another page's details.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { usePageFrame } from '@workspace/ui/components/page-frame'
import { Sidecar, SidecarToggle } from '@workspace/ui/components/sidecar'
import { useTranslation } from 'react-i18next'

interface SidecarContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  title: string
  setTitle: (title: string) => void
  /** The sidecar's body, where `SidecarDetails` portals its content. */
  body: HTMLElement | null
  setBody: (element: HTMLElement | null) => void
}

const SidecarContext = React.createContext<SidecarContextValue | null>(null)

export function SidecarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState<HTMLElement | null>(null)
  const value = React.useMemo(() => ({ open, setOpen, title, setTitle, body, setBody }), [open, title, body])
  return <SidecarContext.Provider value={value}>{children}</SidecarContext.Provider>
}

/** The sidecar itself: the `aside` of the shell's `PageFrame`. */
export function SidecarHost() {
  const { t } = useTranslation()
  const { open, setOpen, title, setBody } = useSidecar()
  return (
    <Sidecar open={open} onOpenChange={setOpen} title={title} closeLabel={t('common.close')}>
      <div ref={setBody} className="contents" />
    </Sidecar>
  )
}

/** A page's details: the floating toggle and, once opened, `children` in the sidecar. */
export function SidecarDetails({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const { open, setOpen, setTitle, body } = useSidecar()
  const frame = usePageFrame()
  const [opened, setOpened] = React.useState(false)
  if (open && !opened) setOpened(true)

  React.useEffect(() => setTitle(title), [title, setTitle])
  React.useEffect(() => () => setOpen(false), [setOpen])

  return (
    <>
      {frame?.trailing && createPortal(
        <SidecarToggle open={open} onOpenChange={setOpen} label={title} closeLabel={t('common.close')} />,
        frame.trailing,
      )}
      {opened && body && createPortal(children, body)}
    </>
  )
}

export function useSidecar(): SidecarContextValue {
  const context = React.useContext(SidecarContext)
  if (!context) throw new Error('useSidecar must be used within SidecarProvider')
  return context
}
