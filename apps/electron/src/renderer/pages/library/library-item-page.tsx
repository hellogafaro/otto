/**
 * A library item's page (`/{ws}/library/{itemId}`): a file's preview or a document's editor as the centerpiece,
 * under the title row. A file's title row: Download, Details, More (Rename, Move, Copy link, Delete); a
 * document's title is edited in place and its More holds Download instead of Rename. Details is the sidecar
 * (closed by default): Folder, Created by, Created, Size, Type. An id the server does not have is not found; a
 * folder's id opens the folder; an item deleted while open goes back to the Library.
 */

import * as React from 'react'
import { Calendar, Download, Folder, HardDrive, PanelRight, Shapes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuItem, DropdownMenuSeparator } from '@workspace/ui/components/dropdown-menu'
import { PageCenterpiece } from '@workspace/ui/components/page'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { toast } from '@workspace/ui/components/sonner'
import { Spinner } from '@workspace/ui/components/spinner'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { useSidecar } from '@/context/sidecar-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useLibrary } from '@/hooks/use-library'
import { useParentView } from '@/hooks/use-parent-view'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { routes } from '@/lib/navigate'
import type { LibraryItem } from '../../../shared/types'
import { DocumentEditor } from './document-editor'
import { FilePreview } from './file-preview'
import { libraryErrorMessage, useLibraryItemDialogs } from './item-dialogs'
import { contentToText, downloadLibraryItem, formatSize, getDisplayTitle, getExtension, getFolderPath } from './library-items'

/** The item's facts, live from the library (the sidecar keeps showing them while the item changes). */
function LibraryDetails({ itemId }: { itemId: string }) {
  const { t, i18n } = useTranslation()
  const { items } = useLibrary()
  const { nameOf } = useWorkspaceMembers()
  const item = items.find((entry) => entry.id === itemId)
  if (!item) return null
  const path = [t('library.title'), ...getFolderPath(items, item.folderId).map((folder) => folder.title)].join(' / ')
  const type = item.type === 'document' ? t('library.typeDocument') : getExtension(item.title) || item.mime || ''
  return (
    <PropertySection title={t('library.properties')}>
      <PropertyRow readOnly icon={<Folder />} label={t('library.folder')} value={path} />
      <PropertyRow
        readOnly
        icon={<ActorAvatar actor={item.createdBy} name={nameOf(item.createdBy)} />}
        label={t('library.createdBy')}
        value={nameOf(item.createdBy)}
      />
      <PropertyRow
        readOnly
        icon={<Calendar />}
        label={t('library.created')}
        value={new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(item.createdAt)}
      />
      {item.size !== null && <PropertyRow readOnly icon={<HardDrive />} label={t('library.size')} value={formatSize(item.size, i18n.language)} />}
      {type && <PropertyRow readOnly icon={<Shapes />} label={t('common.type')} value={type} />}
    </PropertySection>
  )
}

function useDownload() {
  const { t } = useTranslation()
  return (item: LibraryItem) => downloadLibraryItem(item).catch(() => toast.error(libraryErrorMessage(t, 'unknown')))
}

/** A document's content, read once and again after a conflict (the editor remounts on the new snapshot). */
function DocumentPage({ itemId, actions, menu }: { itemId: string; actions: React.ReactNode; menu: React.ReactNode }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = React.useState<{ item: LibraryItem; text: string; version: number } | null>(null)

  const load = React.useCallback(() => {
    window.electronAPI.readLibraryItem(itemId).then(
      ({ item, content }) => setSnapshot((current) => ({ item, text: contentToText(content), version: (current?.version ?? 0) + 1 })),
      () => toast.error(t('library.failed'), { id: `library-read-${itemId}` }),
    )
  }, [itemId, t])

  React.useEffect(load, [load])

  if (!snapshot) return <LoadingPage />
  return <DocumentEditor key={snapshot.version} item={snapshot.item} content={snapshot.text} actions={actions} menu={menu} onConflict={load} />
}

function LoadingPage({ title }: { title?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-8">
      <PageHeader title={title ?? ''} />
      <PageCenterpiece className="items-center justify-center text-muted-foreground"><Spinner /></PageCenterpiece>
    </div>
  )
}

export function LibraryItemPage({ itemId }: { itemId: string }) {
  const { t } = useTranslation()
  const { items, loaded, refresh } = useLibrary()
  const { navigate, showNotFound } = useNavigation()
  const parent = useParentView()
  const { open: sidecarOpen, toggleSidecar } = useSidecar()
  const download = useDownload()
  const item = items.find((entry) => entry.id === itemId)
  const seen = React.useRef(false)
  if (item) seen.current = true

  const backToLibrary = () => (parent ? parent.onBack() : navigate(routes.view.library()))
  // Deleting the open item drops it from the list; the effect below then goes back to the Library.
  const dialogs = useLibraryItemDialogs()

  React.useEffect(() => {
    if (!loaded) return
    if (item?.type === 'folder') navigate(routes.view.library({ folder: item.id }), { replace: true })
    if (item) return
    // The list can lag behind (an item made a moment ago): the server decides whether it exists.
    let live = true
    window.electronAPI.getLibraryItem(itemId).then(
      (found) => {
        if (!live) return
        if (found) void refresh()
        else if (seen.current) backToLibrary()
        else showNotFound()
      },
      () => live && showNotFound(),
    )
    return () => { live = false }
  }, [loaded, item?.type, itemId]) // eslint-disable-line react-hooks/exhaustive-deps -- once the list knows the item

  if (!item || item.type === 'folder') return <LoadingPage />

  const details = (
    <HeaderIconButton
      icon={<PanelRight />}
      tooltip={t('library.details')}
      aria-pressed={sidecarOpen}
      onClick={() => toggleSidecar({ title: t('library.details'), content: <LibraryDetails itemId={item.id} /> })}
    />
  )
  const menu = (
    <>
      {item.type === 'document'
        ? <DropdownMenuItem onClick={() => download(item)}>{t('library.download')}</DropdownMenuItem>
        : <DropdownMenuItem shortcut="R" onClick={() => dialogs.rename(item)}>{t('common.rename')}</DropdownMenuItem>}
      <DropdownMenuItem shortcut="M" onClick={() => dialogs.move(item)}>{t('library.move')}</DropdownMenuItem>
      <DropdownMenuItem shortcut="C" onClick={() => dialogs.copyLink(item)}>{t('library.copyLink')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" shortcut="⌫" onClick={() => dialogs.remove(item)}>{t('common.delete')}</DropdownMenuItem>
    </>
  )

  if (item.type === 'document') {
    return (
      <>
        <DocumentPage itemId={item.id} actions={details} menu={menu} />
        {dialogs.dialogs}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-8">
      <PageHeader
        title={getDisplayTitle(item)}
        actions={<><HeaderIconButton icon={<Download />} tooltip={t('library.download')} onClick={() => download(item)} />{details}</>}
        menu={menu}
      />
      <PageCenterpiece>
        <FilePreview item={item} onDownload={() => download(item)} />
      </PageCenterpiece>
      {dialogs.dialogs}
    </div>
  )
}
