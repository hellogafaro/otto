/**
 * One library item as a gallery tile (Library, a project's Documents and Files tabs): a folder, a file (its
 * type glyph and extension, "PDF") or a document, the title under it. Its menu (right-click and the hover ⋯)
 * is one list: Open, Rename, Move, Copy link, then Remove (from a project) or Delete apart. An action left out is not listed.
 */

import { File, FileText, Folder, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@workspace/ui/components/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { GalleryItem } from '@workspace/ui/components/gallery'
import type { LibraryItem } from '../../../shared/types'
import { getDisplayTitle, getExtension } from './library-items'

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

function ItemMenuItems({ kind, onOpen, actions }: { kind: 'context' | 'dropdown'; onOpen?: () => void; actions: LibraryItemActions }) {
  const { t } = useTranslation()
  const Item = kind === 'context' ? ContextMenuItem : DropdownMenuItem
  const Separator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <>
      {onOpen && <Item onClick={onOpen}>{t('common.open')}</Item>}
      {actions.onRename && <Item shortcut="R" onClick={actions.onRename}>{t('common.rename')}</Item>}
      {actions.onMove && <Item shortcut="M" onClick={actions.onMove}>{t('library.move')}</Item>}
      {actions.onCopyLink && <Item shortcut="C" onClick={actions.onCopyLink}>{t('library.copyLink')}</Item>}
      {actions.remove && (
        <>
          <Separator />
          <Item onClick={actions.remove.onClick}>{actions.remove.label}</Item>
        </>
      )}
      {actions.onDelete && (
        <>
          <Separator />
          <Item variant="destructive" shortcut="⌫" onClick={actions.onDelete}>{t('common.delete')}</Item>
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
  item: Pick<LibraryItem, 'type' | 'title'>
  onOpen?: () => void
  /** The item's menu; none for a pending item. */
  actions?: LibraryItemActions
  current?: boolean
  /** Pending (an upload in flight) or unavailable. */
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const Icon = libraryItemIcon(item.type)
  return (
    <GalleryItem
      title={getDisplayTitle(item)}
      icon={<Icon />}
      media={<Icon />}
      label={item.type === 'file' ? getExtension(item.title) || undefined : undefined}
      current={current}
      disabled={disabled}
      onClick={onOpen}
      menu={actions && (
        <ContextMenuContent>
          <ItemMenuItems kind="context" onOpen={onOpen} actions={actions} />
        </ContextMenuContent>
      )}
      actions={actions && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <ItemMenuItems kind="dropdown" onOpen={onOpen} actions={actions} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  )
}
