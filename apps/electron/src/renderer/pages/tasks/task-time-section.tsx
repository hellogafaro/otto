/**
 * A task's logged time in its sidecar: the entries ("Maria · 1h 30m · Oct 4", notes on hover), the total as the
 * section's count, "New time entry" (a dialog: minutes and notes) and Delete on your own entries. Entries are
 * read with `getTimesheets` when shown, on window focus and when the server says timesheets changed; adding and
 * deleting apply at once with the "Saved" toast.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { Plus, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@workspace/ui/components/hover-card'
import { Input } from '@workspace/ui/components/input'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { toast } from '@workspace/ui/components/sonner'
import { Spinner } from '@workspace/ui/components/spinner'
import { Textarea } from '@workspace/ui/components/textarea'
import { getDateLocale } from '@otto/shared/i18n'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { useAppShellContext } from '@/context/app-shell-context'
import { useRegisterModal } from '@/context/modal-context'
import { useLiveData } from '@/hooks/use-live-data'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { Timesheet } from '../../../shared/types'

const MINUTE = 60_000
/** The backend's cap per entry: 24 hours. */
export const MAX_ENTRY_MINUTES = 24 * 60
const MAX_NOTES = 4000

/** Whole hours and the minutes left (rounded to the minute). */
export function splitDuration(ms: number): { hours: number; minutes: number } {
  const total = Math.round(ms / MINUTE)
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/** Typed minutes as a whole number from 1 to 24 hours, or null. */
export function parseMinutes(text: string): number | null {
  const value = Number(text.trim())
  return Number.isInteger(value) && value >= 1 && value <= MAX_ENTRY_MINUTES ? value : null
}

function useDuration() {
  const { t } = useTranslation()
  return (ms: number) => {
    const { hours, minutes } = splitDuration(ms)
    const parts = [hours ? t('tasks.hoursShort', { hours }) : '', minutes || !hours ? t('tasks.minutesShort', { minutes }) : '']
    return parts.filter(Boolean).join(' ')
  }
}

function TimeEntryDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (minutes: number, notes: string) => Promise<boolean> }) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tasks.newTimeEntry')}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the fields start empty each time. */}
        <TimeEntryForm onAdd={async (minutes, notes) => { if (await onAdd(minutes, notes)) onOpenChange(false) }} />
      </DialogContent>
    </Dialog>
  )
}

function TimeEntryForm({ onAdd }: { onAdd: (minutes: number, notes: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [minutes, setMinutes] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  const value = parseMinutes(minutes)
  const invalid = touched && value === null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (value === null || pending) return
    setPending(true)
    await onAdd(value, notes.trim())
    setPending(false)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup className="gap-4">
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="time-minutes">{t('tasks.minutes')}</FieldLabel>
          <Input
            id="time-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ENTRY_MINUTES}
            autoFocus
            value={minutes}
            disabled={pending}
            aria-invalid={invalid || undefined}
            onChange={(e) => setMinutes(e.target.value)}
          />
          {invalid && <FieldError>{t('tasks.minutesInvalid')}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="time-notes">{t('tasks.notes')}</FieldLabel>
          <Textarea id="time-notes" value={notes} maxLength={MAX_NOTES} disabled={pending} placeholder={t('tasks.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" disabled={pending || invalid}>
          {pending && <Spinner data-icon="inline-start" />}
          {t('tasks.addTimeEntry')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function TaskTimeSection({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation()
  const { nameOf, me } = useWorkspaceMembers()
  const { activeWorkspaceId } = useAppShellContext()
  const duration = useDuration()
  const [entries, setEntries] = React.useState<Timesheet[]>([])
  const [adding, setAdding] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      setEntries(await window.electronAPI.getTimesheets(taskId))
    } catch (error) {
      console.error('[TaskTimeSection] load failed:', error)
    }
  }, [taskId])

  React.useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  const mutate = useLiveData('timesheets', activeWorkspaceId, load)

  const done = (ok: boolean) => {
    if (ok) toast.success(t('common.saved'), { id: 'saved' })
    else toast.error(t('tasks.errorUnknown'), { id: 'saved' })
    return ok
  }
  const add = async (minutes: number, notes: string) =>
    done((await mutate(() => window.electronAPI.createTimesheet({ taskId, time: minutes * MINUTE, notes }))).ok)
  const remove = async (id: string) => done((await mutate(() => window.electronAPI.deleteTimesheet(id))).ok)

  const total = entries.reduce((sum, entry) => sum + entry.time, 0)
  const locale = getDateLocale(i18n.language)

  return (
    <PropertySection title={t('tasks.time')} count={total ? duration(total) : undefined}>
      {entries.map((entry) => {
        const name = nameOf(entry.createdBy)
        const row = (
          <PropertyRow
            readOnly
            icon={<ActorAvatar actor={entry.createdBy} name={name} />}
            value={[name, duration(entry.time), format(entry.createdAt, 'MMM d', { locale })].join(' · ')}
            actions={entry.createdBy === me && (
              <Button variant="ghost" size="icon-xs" aria-label={t('tasks.deleteTimeEntry')} onClick={() => void remove(entry.id)}>
                <X />
              </Button>
            )}
          />
        )
        if (!entry.notes) return <React.Fragment key={entry.id}>{row}</React.Fragment>
        return (
          <HoverCard key={entry.id}>
            <HoverCardTrigger render={<div />}>{row}</HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="whitespace-pre-wrap">{entry.notes}</HoverCardContent>
          </HoverCard>
        )
      })}
      <PropertyRow icon={<Plus />} label={t('tasks.newTimeEntry')} onClick={() => setAdding(true)} />
      <TimeEntryDialog open={adding} onOpenChange={setAdding} onAdd={add} />
    </PropertySection>
  )
}
