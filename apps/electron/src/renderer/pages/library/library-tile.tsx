/**
 * One library item as a gallery tile (Library, a project's Documents and Files tabs): a folder, a file (its
 * type glyph and extension, "PDF") or a document, the title under it. Its menu (right-click, a long press on touch)
 * is one list: Open, Rename, Move, Copy link, then Remove (from a project) or Delete apart. An action left out is not listed.
 */

import * as React from 'react'
import { File, FileText, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@workspace/ui/components/context-menu'
import { GalleryItem } from '@workspace/ui/components/gallery'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { libraryImageUrl } from '@/lib/library-image'
import type { LibraryItem } from '../../../shared/types'
import { getDisplayTitle, getExtension, getPreviewKind } from './library-items'

export interface LibraryItemActions {
  onRename?: () => void
  onMove?: () => void
  onCopyLink?: () => void
  /** Unlink it from where it is shown (a project's tab), with that place's label ("Remove from project"). */
  remove?: { label: string; onClick: () => void }
  onDelete?: () => void
}

export function libraryItemIcon(type: LibraryItem['type']) {
  return type === 'folder' ? Folder : type === 'document' ? FileText : File
}

type TileItem = Pick<LibraryItem, 'type' | 'title'> & Partial<Pick<LibraryItem, 'id' | 'mime' | 'size' | 'updatedAt'>>

/** A file's picture in its tile: read once it is near the viewport (lazy), the skeleton until it shows, nothing on failure (the type tile stays). */
function useThumbnail(item: TileItem) {
  const enabled = item.type === 'file' && !!item.id && getPreviewKind({ title: item.title, mime: item.mime ?? null, size: item.size ?? null }) === 'image'
  const ref = React.useRef<HTMLSpanElement>(null)
  const [near, setNear] = React.useState(false)
  const [src, setSrc] = React.useState<string>()
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading')
  React.useEffect(() => {
    const node = ref.current
    if (!enabled || !node) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && (setNear(true), observer.disconnect()), { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])
  React.useEffect(() => {
    if (!enabled || !near) return
    let live = true
    setSrc(undefined)
    setState('loading')
    libraryImageUrl(item.id!, item.updatedAt).then((url) => live && setSrc(url), () => live && setState('failed'))
    return () => {
      live = false
    }
  }, [enabled, near, item.id, item.updatedAt])
  if (!enabled || state === 'failed') return undefined
  return (
    <span ref={ref} className="relative block size-full">
      <Skeleton className="absolute inset-0 rounded-none" />
      {src && <img src={src} alt="" onLoad={() => setState('ready')} onError={() => setState('failed')} className="absolute inset-0 size-full object-cover" />}
    </span>
  )
}

function ItemMenuItems({ onOpen, actions }: { onOpen?: () => void; actions: LibraryItemActions }) {
  const { t } = useTranslation()
  return (
    <>
      {onOpen && <ContextMenuItem onClick={onOpen}>{t('common.open')}</ContextMenuItem>}
      {actions.onRename && <ContextMenuItem shortcut="R" onClick={actions.onRename}>{t('common.rename')}</ContextMenuItem>}
      {actions.onMove && <ContextMenuItem shortcut="M" onClick={actions.onMove}>{t('library.move')}</ContextMenuItem>}
      {actions.onCopyLink && <ContextMenuItem shortcut="C" onClick={actions.onCopyLink}>{t('library.copyLink')}</ContextMenuItem>}
      {actions.remove && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={actions.remove.onClick}>{actions.remove.label}</ContextMenuItem>
        </>
      )}
      {actions.onDelete && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" shortcut="⌫" onClick={actions.onDelete}>{t('common.delete')}</ContextMenuItem>
        </>
      )}
    </>
  )
}

export function LibraryTile({
  item,
  onOpen,
  actions,
  current,
  disabled,
}: {
  item: TileItem
  onOpen?: () => void
  /** The item's menu; none for a pending item. */
  actions?: LibraryItemActions
  current?: boolean
  /** Pending (an upload in flight) or unavailable. */
  disabled?: boolean
}) {
  const Icon = libraryItemIcon(item.type)
  const cover = useThumbnail(item)
  return (
    <GalleryItem
      data-library-item-id={item.id}
      title={getDisplayTitle(item)}
      icon={<Icon />}
      media={<Icon />}
      cover={cover}
      label={item.type === 'file' ? getExtension(item.title) || undefined : undefined}
      current={current}
      disabled={disabled}
      onClick={onOpen}
      menu={actions && (
        <ContextMenuContent>
          <ItemMenuItems onOpen={onOpen} actions={actions} />
        </ContextMenuContent>
      )}
    />
  )
}
