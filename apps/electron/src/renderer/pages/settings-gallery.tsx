/**
 * What the Skills and Sources grids (in Settings) share, after the Library's: a tile (the item's own icon in the
 * icon tile, its title under it, an optional muted caption) whose menu (right-click and the hover ⋯) is Open,
 * Copy link, then Delete apart; and Delete's confirmation, which an item's page uses too.
 */

import * as React from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
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
import { Button } from '@workspace/ui/components/button'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@workspace/ui/components/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { GalleryItem } from '@workspace/ui/components/gallery'

interface TileActions {
  onOpen: () => void
  onCopyLink: () => void
  /** Left out where the item cannot be deleted here (a global or project skill). */
  onDelete?: () => void
}

function TileMenuItems({ kind, actions }: { kind: 'context' | 'dropdown'; actions: TileActions }) {
  const { t } = useTranslation()
  const Item = kind === 'context' ? ContextMenuItem : DropdownMenuItem
  const Separator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <>
      <Item onClick={actions.onOpen}>{t('common.open')}</Item>
      <Item shortcut="C" onClick={actions.onCopyLink}>{t('library.copyLink')}</Item>
      {actions.onDelete && (
        <>
          <Separator />
          <Item variant="destructive" shortcut="⌫" onClick={actions.onDelete}>{t('common.delete')}</Item>
        </>
      )}
    </>
  )
}

export function SettingsGalleryTile({ title, icon, media, label, actions }: {
  title: string
  /** The item's own icon (its avatar, chromeless): 14px before the title, 16px in the tile. */
  icon: React.ReactNode
  media: React.ReactNode
  /** The muted caption under the icon (a source's type, a skill's scope). */
  label?: string
  actions: TileActions
}) {
  const { t } = useTranslation()
  return (
    <GalleryItem
      title={title}
      icon={icon}
      media={media}
      label={label}
      onClick={actions.onOpen}
      menu={(
        <ContextMenuContent>
          <TileMenuItems kind="context" actions={actions} />
        </ContextMenuContent>
      )}
      actions={(
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <TileMenuItems kind="dropdown" actions={actions} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  )
}

/**
 * Delete, after asking: `confirm(title, run)` opens the stock destructive dialog; `run` deletes and throws on
 * failure, which keeps the dialog open with "Something went wrong". Render `dialog` once in the page.
 */
export function useConfirmDelete() {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState<{ title: string; run: () => Promise<void> } | null>(null)
  const [running, setRunning] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const confirm = async () => {
    if (!pending) return
    setRunning(true)
    try {
      await pending.run()
      setPending(null)
    } catch {
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open && !running) setPending(null) }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{failed ? t('library.deleteFailed') : t('library.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" loading={running} onClick={confirm}>
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return {
    dialog,
    confirmDelete: (title: string, run: () => Promise<void>) => {
      setFailed(false)
      setPending({ title, run })
    },
  }
}
