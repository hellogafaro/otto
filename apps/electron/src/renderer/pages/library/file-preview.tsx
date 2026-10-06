/**
 * A file's preview, the centerpiece of its page, read-only: images, video and audio in the browser's players,
 * PDFs in its viewer, HTML in a sandboxed frame with no scripts, markdown and text through the markdown
 * renderer. Over 8 MiB or a type with no preview: "No preview" and Download.
 */

import * as React from 'react'
import { Download, FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@workspace/ui/components/empty'
import { PageScroll } from '@workspace/ui/components/page-frame'
import { Spinner } from '@workspace/ui/components/spinner'
import { Markdown } from '@otto/ui'
import type { LibraryItem } from '../../../shared/types'
import { contentToBytes, contentToText, getPreviewKind, toCodeBlock } from './library-items'

/** No network, no scripts, no forms: the page shows as it is (v1's policy). */
const HTML_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">`

type Loaded = { url: string; text?: string }

export function FilePreview({ item, onDownload }: { item: LibraryItem; onDownload: () => void }) {
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
    window.electronAPI.readLibraryItem(item.id).then(
      ({ content }) => {
        if (!live) return
        const bytes = contentToBytes(content)
        url = URL.createObjectURL(new Blob([bytes], { type: item.mime ?? 'application/octet-stream' }))
        const isText = kind === 'html' || kind === 'markdown' || kind === 'text'
        setLoaded({ url, text: isText ? contentToText(content) : undefined })
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [item.id, item.updatedAt, item.mime, kind, attempt])

  if (kind === 'none' || failed) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
          <EmptyTitle>{failed ? t('library.previewFailed') : t('library.noPreview')}</EmptyTitle>
          <EmptyDescription>{failed ? t('library.previewFailedDescription') : t('library.noPreviewDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {failed
            ? <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</Button>
            : <Button onClick={onDownload}><Download />{t('library.download')}</Button>}
        </EmptyContent>
      </Empty>
    )
  }

  if (!loaded) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Spinner /></div>
  }

  if (kind === 'markdown' || kind === 'text') {
    return (
      <PageScroll className="px-5 py-5">
        <Markdown mode="full" onUrlClick={(url) => window.electronAPI.openUrl(url)}>
          {kind === 'markdown' ? loaded.text ?? '' : toCodeBlock(loaded.text ?? '')}
        </Markdown>
      </PageScroll>
    )
  }

  if (kind === 'html') {
    return <iframe title={item.title} sandbox="" referrerPolicy="no-referrer" srcDoc={`${HTML_POLICY}${loaded.text ?? ''}`} className="size-full flex-1 border-0" />
  }

  if (kind === 'pdf') {
    return <iframe title={item.title} src={loaded.url} className="size-full flex-1 border-0" />
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-5">
      {kind === 'image' && <img src={loaded.url} alt={item.title} className="max-h-full max-w-full rounded-md object-contain" />}
      {kind === 'video' && <video src={loaded.url} controls className="max-h-full max-w-full rounded-md" />}
      {kind === 'audio' && <audio src={loaded.url} controls className="w-full max-w-md" />}
    </div>
  )
}
