/**
 * One routine in the grouped list: a 44px `ListRow` that opens it (its state icon, its name, what starts it in muted
 * text, its kinds of action as outline badges, when it last ran) and its ⋯ menu. `RoutineMenuItems` is the same list
 * for the routine page's More actions; `useRoutineActions` runs them with their toasts and the delete dialog.
 */

import { useTranslation } from 'react-i18next'
import { Bot, CircleAlert, CirclePause, CirclePlay, Clock, Loader, MessageSquare, MoreHorizontal, Pause, Play, SquareArrowOutUpRight, SquareTerminal, Trash2, Webhook, Zap, type LucideIcon } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { ListRow } from '@workspace/ui/components/list-group'
import { toast } from '@workspace/ui/components/sonner'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import type { useRoutines } from '@/hooks/use-routines'
import { shortTimeAgo } from '@/utils/session'
import { actionTypes, describeTrigger, lastRun, routineState, type Routine, type RoutineAction, type RoutineState, type RoutineType } from './routine-items'

/** Each group's icon (also the Type filter's and the Trigger row's). */
export const ROUTINE_TYPE_ICONS: Record<RoutineType, LucideIcon> = { scheduled: Clock, event: Zap, agentic: Bot }

/** Each kind of action's icon and label. */
export const ACTION_TYPES: Record<RoutineAction['type'], { icon: LucideIcon; labelKey: string }> = {
  prompt: { icon: MessageSquare, labelKey: 'routines.actionPrompt' },
  script: { icon: SquareTerminal, labelKey: 'routines.actionScript' },
  webhook: { icon: Webhook, labelKey: 'routines.actionWebhook' },
}

const STATE_ICONS: Record<RoutineState, { icon: LucideIcon; className: string }> = {
  active: { icon: CirclePlay, className: 'text-success' },
  paused: { icon: CirclePause, className: 'text-muted-foreground' },
  failing: { icon: CircleAlert, className: 'text-destructive' },
}

/** Active (green play), paused (muted pause) or failing (its last run failed: red alert); a spinner while a run is going. */
export function RoutineStateIcon({ routine }: { routine: Routine }) {
  const { t } = useTranslation()
  if (routine.runs[0]?.status === 'running') return <Loader role="img" aria-label={t('routines.running')} className="animate-spin text-muted-foreground" />
  const state = routineState(routine)
  const { icon: Icon, className } = STATE_ICONS[state]
  return <Icon role="img" aria-label={t(`routines.state_${state}`)} className={className} />
}

export type RoutinesApi = ReturnType<typeof useRoutines>

/** Run now, Pause / Resume and Delete (asked first) with their toasts; render `dialog` once in the page. */
export function useRoutineActions(api: RoutinesApi, { onDeleted }: { onDeleted?: () => void } = {}) {
  const { t } = useTranslation()
  const { dialog, confirmDelete } = useConfirmDelete()
  return {
    dialog,
    run: async (routine: Routine) => {
      const result = await api.runRoutine(routine)
      if (result.ok) toast.success(t('routines.runStarted'))
      else toast.error(t('routines.runFailed'))
    },
    setPaused: async (routine: Routine, paused: boolean) => {
      const result = await (paused ? api.pauseRoutine(routine) : api.resumeRoutine(routine))
      if (result.ok) toast.success(t('common.saved'), { id: 'saved' })
      else toast.error(t('routines.saveFailed'), { id: 'saved' })
    },
    remove: (routine: Routine) => confirmDelete(t('routines.deleteTitle'), async () => {
      const result = await api.deleteRoutine(routine)
      if (!result.ok) throw new Error(result.code)
      toast.success(t('routines.deleted', { name: routine.title }))
      onDeleted?.()
    }),
  }
}

export type RoutineActions = ReturnType<typeof useRoutineActions>

/** Run now, Pause / Resume, then Delete apart: the row's ⋯ (after Open) and the page's More actions. */
export function RoutineMenuItems({ routine, actions }: { routine: Routine; actions: RoutineActions }) {
  const { t } = useTranslation()
  return (
    <>
      <DropdownMenuItem onClick={() => void actions.run(routine)}>
        <Play />
        {t('routines.runNow')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void actions.setPaused(routine, routine.pausedAt === null)}>
        {routine.pausedAt === null ? <Pause /> : <CirclePlay />}
        {routine.pausedAt === null ? t('routines.pause') : t('routines.resume')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" shortcut="⌫" onClick={() => actions.remove(routine)}>
        <Trash2 />
        {t('common.delete')}
      </DropdownMenuItem>
    </>
  )
}

export function RoutineRow({ routine, actions, onOpen }: { routine: Routine; actions: RoutineActions; onOpen: (routine: Routine) => void }) {
  const { t, i18n } = useTranslation()
  const ran = lastRun(routine)
  return (
    <ListRow
      data-routine-id={routine.id}
      media={<RoutineStateIcon routine={routine} />}
      title={routine.title}
      muted={routine.pausedAt !== null}
      // Hidden in a narrow column, like the badges: the name keeps the room.
      marks={<span className="truncate text-muted-foreground @max-md/panel:hidden">{describeTrigger(routine, t, i18n.language)}</span>}
      meta={actionTypes(routine).map((type) => {
        const { icon: Icon, labelKey } = ACTION_TYPES[type]
        return (
          <Badge key={type} variant="outline">
            <Icon />
            {t(labelKey)}
          </Badge>
        )
      })}
      end={ran ? shortTimeAgo(ran.startedAt) : t('common.never')}
      onClick={() => onOpen(routine)}
      actions={(
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onOpen(routine)}>
                <SquareArrowOutUpRight />
                {t('common.open')}
              </DropdownMenuItem>
              <RoutineMenuItems routine={routine} actions={actions} />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  )
}
