/**
 * A file's fullscreen preview, read-only: images, video and audio in the browser's players,
 * PDFs in its viewer, HTML in a sandboxed frame with no scripts, markdown and text through the markdown
 * renderer. Over 8 MiB or a type with no preview: "No preview" and Download.
 */

import * as React from 'react'
import { Download, Ellipsis, File, FileQuestion, List, Share2, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@workspace/ui/components/empty'
import { Kbd } from '@workspace/ui/components/kbd'
import { PageCard } from '@workspace/ui/components/page'
import { PageScroll } from '@workspace/ui/components/page-frame'
import { Sidecar } from '@workspace/ui/components/sidecar'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Markdown } from '@otto/ui'
import { useOptionalSidecar } from '@/context/sidecar-context'
import type { LibraryItem } from '../../../shared/types'
import { MAX_PREVIEW_BYTES, contentToBytes, contentToText, getExtension, getPreviewKind, toCodeBlock } from './library-items'

/** No network, no scripts, no forms: the page shows as it is (v1's policy). */
const HTML_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">`

type Loaded = { item: LibraryItem; url: string; text?: string }

export function FilePreview({ item, onDownload, onCopyLink, onDelete, onClose, details, dialogs, menu }: {
  item: LibraryItem
  onDownload: () => void
  onCopyLink: () => void
  onDelete: () => void
  onClose: () => void
  details: React.ReactNode
  dialogs: React.ReactNode
  menu: React.ReactNode
}) {
  const { t } = useTranslation()
  const sidecar = useOptionalSidecar()
  const popup = React.useRef<HTMLDivElement>(null)
  const detailsToggle = React.useRef<HTMLButtonElement>(null)
  const focusAfterChange = React.useRef<boolean | null>(null)
  const detailsId = React.useId()
  const [detailsClosed, setDetailsClosed] = React.useState(false)
  const hasDetails = React.Children.toArray(details).length > 0
  const detailsOpen = hasDetails && !(sidecar?.closed ?? detailsClosed)
  const openDetailsLabel = `${t('common.open')} ${t('library.details')}`
  const closeDetailsLabel = `${t('common.close')} ${t('library.details')}`
  const changeDetailsOpen = (open: boolean) => {
    focusAfterChange.current = open
    if (sidecar) sidecar.setOpen(open)
    else setDetailsClosed(!open)
  }
  React.useLayoutEffect(() => {
    if (focusAfterChange.current !== detailsOpen) return
    focusAfterChange.current = null
    if (detailsOpen) popup.current?.querySelector<HTMLElement>('[data-slot="sidecar-close"]')?.focus()
    else detailsToggle.current?.focus()
  }, [detailsOpen])
  const actions = [
    { label: t('library.download'), icon: Download, onClick: onDownload },
    { label: t('library.copyLink'), icon: Share2, onClick: onCopyLink },
    { label: t('common.delete'), icon: Trash2, onClick: onDelete },
    { label: t('common.close'), icon: X, onClick: onClose, shortcut: 'Esc' },
  ]

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent ref={popup} initialFocus={popup} showCloseButton={false} fullScreen>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
              <div className="flex min-w-0 items-center gap-2 px-1">
                <File className="size-4 shrink-0 text-muted-foreground" />
                <DialogTitle className="truncate">{item.title}</DialogTitle>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{getExtension(item.title)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />} />}>
                      <Ellipsis />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('common.moreActions')}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
                </DropdownMenu>
                {hasDetails && !detailsOpen && (
                  <Tooltip>
                    <TooltipTrigger render={<Button ref={detailsToggle} variant="ghost" size="icon" data-slot="sidecar-toggle" aria-label={openDetailsLabel} aria-expanded={false} aria-controls={detailsId} onClick={() => changeDetailsOpen(true)} />}>
                      <List aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{openDetailsLabel}</TooltipContent>
                  </Tooltip>
                )}
                {actions.map(({ label, icon: Icon, onClick, shortcut }) => (
                  <Tooltip key={label}>
                    <TooltipTrigger render={<Button variant="ghost" size="icon-compact" aria-label={label} onClick={onClick} />}>
                      <Icon />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{label}{shortcut && <Kbd>{shortcut}</Kbd>}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-5 sm:px-12">
              <FileContent key={`${item.id}:${item.updatedAt}:${item.mime}`} item={item} onDownload={onDownload} />
            </div>
          </div>
          {hasDetails && (
            <aside id={detailsId} aria-label={t('library.details')} className={`${detailsOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col border-t lg:w-70 lg:flex-none lg:border-t-0 lg:border-l`}>
              <Sidecar open={detailsOpen} onOpenChange={changeDetailsOpen} title={t('library.details')} closeLabel={closeDetailsLabel}>
                {details}
              </Sidecar>
            </aside>
          )}
        </div>
        {dialogs}
      </DialogContent>
    </Dialog>
  )
}

function FileContent({ item, onDownload }: { item: LibraryItem; onDownload: () => void }) {
  const { t } = useTranslation()
  const kind = getPreviewKind(item)
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (kind === 'none') return
    let live = true
    let url: string | undefined
    setLoaded(null)
    setFailed(false)
    window.electronAPI.readLibraryItem(item.id).then(({ item: snapshot, content }) => {
      if (!live) return
      const bytes = contentToBytes(content)
      if (snapshot.id !== item.id || snapshot.type !== 'file' || getPreviewKind(snapshot) !== kind || bytes.byteLength > MAX_PREVIEW_BYTES || (snapshot.size !== null && snapshot.size !== bytes.byteLength)) {
        setFailed(true)
        return
      }
      url = URL.createObjectURL(new Blob([bytes], { type: snapshot.mime ?? 'application/octet-stream' }))
      const isText = kind === 'html' || kind === 'markdown' || kind === 'text'
      setLoaded({ item: snapshot, url, text: isText ? contentToText(content) : undefined })
    }).catch(() => { if (live) setFailed(true) })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [item.id, item.updatedAt, item.mime, kind, attempt])

  if (kind === 'none' || failed) {
    return (
      <Empty>
        <EmptyHeader role={failed ? 'alert' : undefined}>
          <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
          <EmptyTitle>{failed ? t('library.previewFailed') : t('library.noPreview')}</EmptyTitle>
          <EmptyDescription>{failed ? t('library.previewFailedDescription') : t('library.noPreviewDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {failed && <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</Button>}
          <Button onClick={onDownload}><Download />{t('library.download')}</Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (!loaded) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Spinner aria-label={t('common.loading')} /></div>
  }

  if (kind === 'markdown' || kind === 'text') {
    return (
      <PageCard className="flex h-full w-full max-w-3xl flex-col">
        <PageScroll className="p-5 sm:p-8">
          <Markdown mode="full" className={kind === 'markdown' ? 'max-w-[37em]' : undefined} onUrlClick={(url) => window.electronAPI.openUrl(url)}>
            {kind === 'markdown' ? loaded.text ?? '' : toCodeBlock(loaded.text ?? '')}
          </Markdown>
        </PageScroll>
      </PageCard>
    )
  }

  if (kind === 'html') {
    return <PageCard className="size-full max-w-4xl"><iframe title={loaded.item.title} sandbox="" referrerPolicy="no-referrer" srcDoc={`${HTML_POLICY}${loaded.text ?? ''}`} className="size-full border-0" /></PageCard>
  }

  if (kind === 'pdf') {
    return <PageCard className="size-full max-w-4xl"><iframe title={loaded.item.title} src={loaded.url} className="size-full border-0" onError={() => setFailed(true)} /></PageCard>
  }

  return (
    <div className="flex size-full min-h-0 items-center justify-center">
      {kind === 'image' && <img src={loaded.url} alt={loaded.item.title} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-md object-contain" />}
      {kind === 'video' && <video src={loaded.url} controls onError={() => setFailed(true)} className="max-h-full max-w-full rounded-md" />}
      {kind === 'audio' && <audio src={loaded.url} controls onError={() => setFailed(true)} className="w-full max-w-md" />}
    </div>
  )
}
