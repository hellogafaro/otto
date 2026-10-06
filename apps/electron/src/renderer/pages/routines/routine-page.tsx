/**
 * RoutinePage - one routine, a blocks page: its name in the title row, what starts it in words as the lead line, then
 * Actions (what it does: each prompt, script or webhook, read-only; Edit asks an agent to change it) and Run history
 * (its last runs, newest first: when, Running / Ran / Failed / Skipped, the error, and the chat a run started, which the
 * row opens). The title row's Details opens the sidecar (closed by default): Trigger, Timezone, Actions, Labels and
 * Status (Active, Paused or Failing). More actions: Run now, Pause / Resume, Delete (asked first; then back to Routines).
 * An id the workspace does not have shows the not-found page once the list has loaded.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleCheck, CircleDot, CircleMinus, CircleX, Globe, Loader, PanelRight, Shapes, Tag } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { PageCard, PageColumn, PageSection } from '@workspace/ui/components/page'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { flattenLabels, parseLabelEntry } from '@otto/shared/labels'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { SettingsRow } from '@/components/settings/settings-row'
import { AgentEditButton } from '@/components/ui/agent-edit-button'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import type { RoutineRun } from '../../../shared/types'
import { useAppShellContext } from '@/context/app-shell-context'
import { useSidecar } from '@/context/sidecar-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useParentView } from '@/hooks/use-parent-view'
import { useRoutines } from '@/hooks/use-routines'
import { actionTypes, describeTrigger, eventName, routineState, routineType, type Routine, type RoutineAction } from './routine-items'
import { ACTION_TYPES, ROUTINE_TYPE_ICONS, RoutineMenuItems, useRoutineActions, type RoutinesApi } from './routine-row'

/** The routine's Details in the sidecar: it reads the routine itself, so it stays current while open. */
function RoutineDetails({ routineId }: { routineId: string }) {
  const { t } = useTranslation()
  const api = useRoutines()
  const { labels = [] } = useAppShellContext()
  const routine = api.routines.find((item) => item.id === routineId)
  if (!routine) return null
  const TypeIcon = ROUTINE_TYPE_ICONS[routineType(routine)]
  const flat = flattenLabels(labels)
  const labelNames = [...new Set(routine.config.actions.flatMap((action) => (action.type === 'prompt' ? action.labels ?? [] : [])))].map((entry) => {
    const id = parseLabelEntry(entry).id
    return flat.find((label) => label.id === id)?.name ?? id
  })
  return (
    <PropertySection title={t('routines.properties')}>
      <PropertyRow
        readOnly
        icon={<TypeIcon />}
        label={t('routines.trigger')}
        value={routine.config.schedule ? <span className="truncate font-mono text-xs">{routine.config.schedule.cron}</span> : routine.config.event ? eventName(routine.config.event, t) : t('routines.type_event')}
      />
      {routine.config.type === 'schedule' && (
        <PropertyRow readOnly icon={<Globe />} label={t('routines.timezone')} value={routine.config.schedule?.timezone} placeholder={t('routines.localTime')} />
      )}
      <PropertyRow
        readOnly
        icon={<Shapes />}
        label={t('routines.actions')}
        value={actionTypes(routine).map((type) => t(ACTION_TYPES[type].labelKey)).join(', ')}
      />
      <PropertyRow readOnly icon={<Tag />} label={t('routines.labels')} value={labelNames.join(', ')} placeholder={t('routines.noLabels')} />
      <PropertyRow readOnly icon={<CircleDot />} label={t('routines.status')} value={t(`routines.state_${routineState(routine)}`)} />
    </PropertySection>
  )
}

/** One action, read-only: its kind (and a webhook's method) over the prompt, the URL or the script. */
function ActionBlock({ action }: { action: RoutineAction }) {
  const { t } = useTranslation()
  const { icon: Icon, labelKey } = ACTION_TYPES[action.type]
  return (
    <div className="space-y-1.5 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&>svg]:size-3.5">
        <Icon />
        {t(labelKey)}
        {action.type === 'webhook' && ` · ${action.method ?? 'POST'}`}
      </p>
      {action.type === 'prompt' ? (
        <p className="text-sm whitespace-pre-wrap">{action.prompt}</p>
      ) : (
        <p className="font-mono text-xs break-all">
          {action.type === 'webhook' ? action.url : [action.runtime ?? 'bun', action.script, ...(action.args ?? [])].join(' ')}
        </p>
      )}
    </div>
  )
}

const RUN_STATES = {
  running: { icon: Loader, className: 'animate-spin text-muted-foreground', labelKey: 'routines.running' },
  ok: { icon: CircleCheck, className: 'text-success', labelKey: 'routines.ran' },
  error: { icon: CircleX, className: 'text-destructive', labelKey: 'common.failed' },
  skipped: { icon: CircleMinus, className: 'text-muted-foreground', labelKey: 'routines.skipped' },
} as const

/** One run: when, its error or why it was skipped, and Running / Ran / Failed / Skipped; a run that started a chat opens it. */
function RunRow({ run }: { run: RoutineRun }) {
  const { t, i18n } = useTranslation()
  const { navigateToSession } = useNavigation()
  const state = RUN_STATES[run.status]
  return (
    <SettingsRow
      list
      label={new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(run.startedAt)}
      description={run.error ?? undefined}
      onClick={run.chatId ? () => navigateToSession(run.chatId!) : undefined}
    >
      <Badge variant="outline">
        <state.icon className={state.className} />
        {t(state.labelKey)}
      </Badge>
      {run.chatId && <ChevronRight className="size-3.5 text-muted-foreground" />}
    </SettingsRow>
  )
}

function RoutineView({ routine, api }: { routine: Routine; api: RoutinesApi }) {
  const { t, i18n } = useTranslation()
  const { open, toggleSidecar } = useSidecar()
  const parent = useParentView()
  const actions = useRoutineActions(api, { onDeleted: () => parent?.onBack() })
  const details = () => toggleSidecar({ title: t('routines.details'), content: <RoutineDetails routineId={routine.id} /> })

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={routine.title}
        description={describeTrigger(routine, t, i18n.language)}
        actions={<HeaderIconButton icon={<PanelRight />} tooltip={t('routines.details')} aria-pressed={open} onClick={details} />}
        menu={<RoutineMenuItems routine={routine} actions={actions} />}
      />
      <PageColumn className="min-h-full">
        <PageSection
          title={t('routines.actions')}
          // Editing prefills the composer with a sentence naming this routine.
          action={<AgentEditButton prompt={t('agentEdit.routineActions', { name: routine.title })} />}
        >
          <PageCard>
            {routine.config.actions.map((action, index) => <ActionBlock key={index} action={action} />)}
          </PageCard>
        </PageSection>
        <PageSection title={t('routines.runHistory')}>
          <PageCard>
            {routine.runs.length === 0 ? (
              <SettingsRow label={<span className="font-normal text-muted-foreground">{t('routines.noRuns')}</span>} />
            ) : routine.runs.map((run) => <RunRow key={run.id} run={run} />)}
          </PageCard>
        </PageSection>
      </PageColumn>
      {actions.dialog}
    </div>
  )
}

export function RoutinePage({ routineId }: { routineId: string }) {
  const { t } = useTranslation()
  // A routine has no entity token (`ENTITY_TOKEN` has no routine type): a chat started here is not led by one.
  useComposerContext({ key: `routine:${routineId}`, placeholder: t('composer.placeholder.routine') })
  const { showNotFound } = useNavigation()
  const api = useRoutines()
  const routine = api.routines.find((item) => item.id === routineId)

  React.useEffect(() => {
    if (api.loaded && !routine) showNotFound()
  }, [api.loaded, routine, showNotFound])

  if (!routine) return <div className="flex h-full flex-col"><PageHeader title="" /></div>
  return <RoutineView key={routine.id} routine={routine} api={api} />
}
