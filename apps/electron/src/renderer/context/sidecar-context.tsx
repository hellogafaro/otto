/**
 * The shell's right details pane: one slot, open by default only while a page registers its details.
 * An explicit close stays in the URL across navigation and reload. A page renders its details anywhere in its tree:
 *
 * ```tsx
 * <SidecarDetails title={t('tasks.details')}><TaskDetails taskId={task.id} /></SidecarDetails>
 * ```
 *
 * which draws the opener only while closed and portals the details into the sidecar, mounted from the first open.
 * The pane disappears when the page goes away, so it
 * never shows another page's details.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { usePageFrame } from '@workspace/ui/components/page-frame'
import { Sidecar, SidecarToggle } from '@workspace/ui/components/sidecar'
import { useTranslation } from 'react-i18next'
import { useNavigate, useRouterState } from '@tanstack/react-router'

interface SidecarContextValue {
  readonly closed: boolean
  open: boolean
  setOpen: (open: boolean) => void
  setAvailable: (available: boolean) => void
  title: string
  setTitle: (title: string) => void
  /** The sidecar's body, where `SidecarDetails` portals its content. */
  body: HTMLElement | null
  setBody: (element: HTMLElement | null) => void
}

const SidecarContext = React.createContext<SidecarContextValue | null>(null)

export function SidecarProvider({ children }: { children: React.ReactNode }) {
  const [available, setAvailable] = React.useState(false)
  const closed = useRouterState({ select: (state) => state.location.search.details === 'closed' })
  const navigate = useNavigate()
  const open = available && !closed
  const setOpen = React.useCallback((next: boolean) => {
    if (next === !closed) return
    void navigate({ to: '.', search: (previous) => ({ ...previous, details: next ? undefined : 'closed' as const }), replace: true, resetScroll: false })
  }, [closed, navigate])
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState<HTMLElement | null>(null)
  const value = React.useMemo(() => ({ closed, open, setOpen, setAvailable, title, setTitle, body, setBody }), [closed, open, setOpen, title, body])
  return <SidecarContext.Provider value={value}>{children}</SidecarContext.Provider>
}

/** The sidecar itself: the `aside` of the shell's `PageFrame`. */
export function SidecarHost() {
  const { t } = useTranslation()
  const { open, setOpen, title, setBody } = useSidecar()
  return (
    <Sidecar open={open} onOpenChange={setOpen} title={title} closeLabel={`${t('common.close')} ${title}`}>
      <div ref={setBody} className="contents" />
    </Sidecar>
  )
}

/** A page's details: register the pane, its closed-state opener and its portaled content. */
export function SidecarDetails({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const { open, setOpen, setAvailable, setTitle, body } = useSidecar()
  const frame = usePageFrame()
  const [opened, setOpened] = React.useState(false)
  if (open && !opened) setOpened(true)

  React.useLayoutEffect(() => {
    setTitle(title)
    setAvailable(true)
    return () => setAvailable(false)
  }, [setAvailable, setTitle, title])

  return (
    <>
      {frame?.trailing && createPortal(
        <SidecarToggle open={open} onOpenChange={setOpen} label={`${t('common.open')} ${title}`} />,
        frame.trailing,
      )}
      {opened && body && createPortal(children, body)}
    </>
  )
}

export function useOptionalSidecar(): SidecarContextValue | null {
  return React.useContext(SidecarContext)
}

export function useSidecar(): SidecarContextValue {
  const context = useOptionalSidecar()
  if (!context) throw new Error('useSidecar must be used within SidecarProvider')
  return context
}
