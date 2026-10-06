/**
 * What a library item's menu does, shared by the Library grid and an item's page: Rename (a dialog), Move (the
 * folder picker), Copy link (the item's app URL) and Delete (asks first; a folder only when empty). Each says it
 * is done with one toast. Render `dialogs` once in the page.
 */

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { toast } from '@workspace/ui/components/sonner'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { useLibrary } from '@/hooks/use-library'
import { routes } from '@/lib/navigate'
import { routeStringToLocation, stringifySearch, workspaceSlugFromPathname } from '../../router/location'
import type { LibraryItem } from '../../../shared/types'
import { getDisplayTitle, toStoredTitle } from './library-items'
import { MoveDialog } from './move-dialog'

/** The toast for a failed library mutation, by its error code. */
export function libraryErrorMessage(t: (key: string) => string, code: string): string {
  if (code === 'not_empty') return t('library.notEmpty')
  if (code === 'conflict') return t('common.changedElsewhere')
  return t('library.failed')
}

/** The item's app URL, as the address bar shows it. */
export function libraryItemUrl(itemId: string): string {
  const slug = workspaceSlugFromPathname(window.location.pathname) ?? ''
  const location = routeStringToLocation(routes.view.library({ itemId }), slug)
  return location ? `${window.location.origin}${location.pathname}${stringifySearch(location.search)}` : window.location.href
}

export function useLibraryItemDialogs() {
  const { t } = useTranslation()
  const { items, updateLibraryItem, deleteLibraryItem } = useLibrary()
  const [renaming, setRenaming] = React.useState<{ item: LibraryItem; name: string } | null>(null)
  const [moving, setMoving] = React.useState<LibraryItem | null>(null)
  const [deleting, setDeleting] = React.useState<LibraryItem | null>(null)
  const [deletePending, setDeletePending] = React.useState(false)
  const [deleteFailed, setDeleteFailed] = React.useState(false)

  const submitRename = async () => {
    if (!renaming) return
    const { item, name } = renaming
    setRenaming(null)
    const title = toStoredTitle(item, name)
    if (title === item.title) return
    const result = await updateLibraryItem(item.id, { title })
    if (!result.ok) toast.error(libraryErrorMessage(t, result.code))
  }

  const move = async (item: LibraryItem, folderId: string | null) => {
    const result = await updateLibraryItem(item.id, { folderId })
    if (!result.ok) toast.error(libraryErrorMessage(t, result.code))
    return result.ok
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    const result = await deleteLibraryItem(deleting.id)
    setDeletePending(false)
    if (result.ok) {
      toast.success(t('library.deleted', { title: getDisplayTitle(deleting) }))
      setDeleting(null)
    } else if (result.code === 'not_empty') {
      toast.error(t('library.notEmpty'))
      setDeleting(null)
    } else {
      setDeleteFailed(true)
    }
  }

  const deleteTitle = deleting?.type === 'folder' ? 'library.deleteFolder' : deleting?.type === 'document' ? 'library.deleteDocument' : 'library.deleteFile'

  const dialogs = (
    <>
      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => { if (!open) setRenaming(null) }}
        title={t('common.rename')}
        value={renaming?.name ?? ''}
        onValueChange={(name) => setRenaming((current) => (current ? { ...current, name } : current))}
        onSubmit={submitRename}
        placeholder={t('library.titlePlaceholder')}
      />
      <MoveDialog item={moving} items={items} onOpenChange={(open) => { if (!open) setMoving(null) }} onMove={move} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deletePending) setDeleting(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t(deleteTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{deleteFailed ? t('library.deleteFailed') : t('library.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deletePending} onClick={confirmDelete}>
              {deletePending && <Spinner />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return {
    dialogs,
    rename: (item: LibraryItem) => setRenaming({ item, name: getDisplayTitle(item) }),
    move: (item: LibraryItem) => setMoving(item),
    remove: (item: LibraryItem) => {
      setDeleteFailed(false)
      setDeleting(item)
    },
    copyLink: async (item: LibraryItem) => {
      await navigator.clipboard.writeText(libraryItemUrl(item.id))
      toast.success(t('library.linkCopied'))
    },
  }
}
