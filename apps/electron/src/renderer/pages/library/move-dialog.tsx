/**
 * Move a library item: pick its new folder (or the Library's root) from the folder tree. Folders it cannot go
 * into (itself, its own tree, deeper than eight levels) are disabled; its current folder is preselected.
 */

import * as React from 'react'
import { Folder, Library } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import type { LibraryItem } from '../../../shared/types'
import { canMoveInto, getDisplayTitle, getFolderRows } from './library-items'

export function MoveDialog({
  item,
  items,
  onOpenChange,
  onMove,
}: {
  /** The item to move; null closes the dialog. */
  item: LibraryItem | null
  items: LibraryItem[]
  onOpenChange: (open: boolean) => void
  /** Moves it; resolves true when done (the dialog closes). */
  onMove: (item: LibraryItem, parentId: string | null) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [target, setTarget] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const rows = React.useMemo(() => getFolderRows(items), [items])

  React.useEffect(() => {
    if (item) setTarget(item.parentId ?? null)
  }, [item])

  const submit = async () => {
    if (!item) return
    setPending(true)
    const done = await onMove(item, target)
    setPending(false)
    if (done) onOpenChange(false)
  }

  const row = (id: string | null, title: string, depth: number, icon: React.ReactNode) => (
    <Button
      key={id ?? 'root'}
      variant="ghost"
      size="compact"
      className="w-full justify-start"
      style={{ paddingLeft: `${0.5 + (depth - 1) * 1.25}rem` }}
      aria-pressed={target === id}
      disabled={!item || !canMoveInto(items, item, id)}
      onClick={() => setTarget(id)}
    >
      {icon}
      <span className="truncate">{title}</span>
    </Button>
  )

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.moveTitle', { title: item ? getDisplayTitle(item) : '' })}</DialogTitle>
        </DialogHeader>
        <div className="no-scrollbar scroll-fade-y -mx-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {row(null, t('library.title'), 1, <Library />)}
          {rows.map(({ folder, depth }) => row(folder.id, folder.title, depth + 1, <Folder />))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button onClick={submit} loading={pending} disabled={!item || target === (item.parentId ?? null)}>
            {t('library.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
