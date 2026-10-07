/**
 * The Webhook section of a webhook routine's page: where it listens, in a settings card. The secret is the URL's last
 * segment and is shown once, when it is made (Rotate): until then the card shows the URL with the secret hidden. Copy
 * (shown with the secret) and Rotate (asked first: the old URL stops working at once). The URL is the page's own origin
 * plus the server's path.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PageCard, PageSection } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ROUTINE_WEBHOOK_PATH } from '@otto/shared/automations/routine-types'
import type { Routine } from './routine-items'
import type { RoutinesApi } from './routine-row'

const HIDDEN_SECRET = '••••••••••••'

export function RoutineWebhook({ routine, api }: { routine: Routine; api: RoutinesApi }) {
  const { t } = useTranslation()
  // The new URL, kept in this page only: gone when it is left, never read back from the server
  const [shown, setShown] = React.useState<string | null>(null)
  const [asking, setAsking] = React.useState(false)
  const [rotating, setRotating] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const origin = /^https?:/.test(window.location.origin) ? window.location.origin : ''

  const url = shown ? `${origin}${shown}` : `${origin}${ROUTINE_WEBHOOK_PATH}/${routine.id}/${HIDDEN_SECRET}`

  const rotate = async () => {
    setRotating(true)
    const result = await api.resetRoutineWebhook(routine)
    setRotating(false)
    setAsking(false)
    if (result.ok) {
      setShown(result.value.path)
      setCopied(false)
    } else toast.error(t('routines.webhookResetFailed'))
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t('toast.copied'))
    } catch {
      toast.error(t('toast.copyFailed'))
    }
  }

  return (
    <PageSection
      title={t('routines.webhook')}
      action={(
        <Button variant="outline" size="compact" onClick={() => setAsking(true)}>
          <RefreshCw />
          {t('routines.webhookReset')}
        </Button>
      )}
    >
      <PageCard>
        <div className="space-y-1.5 px-4 py-3">
          <p className="text-xs text-muted-foreground">{shown ? t('routines.webhookShownOnce') : t('routines.webhookHidden')}</p>
          <div className="flex items-start gap-2">
            <p data-testid="routine-webhook-url" className="min-w-0 flex-1 font-mono text-xs break-all">{url}</p>
            {shown && (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.copy')} onClick={() => void copy()} />}>
                  {copied ? <Check /> : <Copy />}
                </TooltipTrigger>
                <TooltipContent>{t('common.copy')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </PageCard>
      <AlertDialog open={asking} onOpenChange={(open) => { if (!open && !rotating) setAsking(false) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('routines.webhookResetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('routines.webhookResetDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" loading={rotating} onClick={() => void rotate()}>
              {t('routines.webhookReset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageSection>
  )
}
