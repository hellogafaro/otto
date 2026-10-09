/**
 * Delete a skill or a source from its page, after asking (the stock destructive dialog).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'

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
