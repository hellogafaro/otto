/**
 * RoutinesPage - the Routines index: the workspace's routines grouped by what starts them (Scheduled, Events, Agent
 * events; empty groups are not drawn) in the line-only `PageWrap`, the Chats and Tasks table. The header carries
 * Filter (Type, one at a time, `?type=`) and "+" (New routine: prefills the composer, where you describe it and an agent
 * writes it); there is no Search (the palette has no Routines category). Active filters show as chips above the list.
 *
 * Nothing at all: the section's empty state alone, its button the same prefill. A filter that keeps nothing:
 * `NoResults`. A row opens the routine, whose Back returns here and whose Previous / Next step through this list.
 */

import { useTranslation } from 'react-i18next'
import { Clock, Shapes } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField } from '@workspace/ui/components/filters'
import { ListGroup, ListRowSkeleton } from '@workspace/ui/components/list-group'
import { PageColumn, PageWrap } from '@workspace/ui/components/page'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { useComposer } from '@/components/composer/composer-provider'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { CreateButton } from '@/components/ui/create-button'
import { isAutomationsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useRoutines } from '@/hooks/use-routines'
import { routes } from '@/lib/navigate'
import { getVisibleRoutines, groupRoutines, ROUTINE_TYPES, type Routine, type RoutineType } from './routine-items'
import { ROUTINE_TYPE_ICONS, RoutineRow, useRoutineActions } from './routine-row'

export function RoutinesPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:routines' })
  const composer = useComposer()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const api = useRoutines()
  const { routines, loaded } = api
  const actions = useRoutineActions(api)
  const type = isAutomationsNavigation(navState) ? navState.filter?.automationType : undefined
  const setType = (next: RoutineType | undefined) => navigate(routes.view.automations({ type: next }))

  /** New routine: prefills the composer; Enter starts the chat that writes it. */
  const newRoutine = () => composer.prefill(t('agentEdit.addRoutine') + ' ')

  // No routines at all: only the empty state and its New routine.
  if (loaded && routines.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Clock />} title={t('sectionEmpty.routinesTitle')} description={t('sectionEmpty.routinesDescription')}>
          <Button onClick={newRoutine}>{t('sectionEmpty.newRoutine')}</Button>
        </EntityListEmptyScreen>
      </div>
    )
  }

  const counts = groupRoutines(routines)
  const fields: FilterField[] = [{
    key: 'type',
    label: t('common.type'),
    icon: <Shapes />,
    options: ROUTINE_TYPES.map((value) => {
      const Icon = ROUTINE_TYPE_ICONS[value]
      return { value, label: t(`routines.type_${value}`), icon: <Icon />, count: counts[value].length }
    }),
  }]
  const values = { type: type ? [type] : [] }
  // One type at a time (the route holds one): the last one picked.
  const changeFilter = (_key: string, next: string[]) => setType(next.at(-1) as RoutineType | undefined)
  const groups = groupRoutines(getVisibleRoutines(routines, type))
  const open = (routine: Routine) => navigate(routes.view.automations({ automationId: routine.id, type }))

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.routines')}
        actions={(
          <>
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('routines.filter')} />
            <CreateButton label={t('sectionEmpty.newRoutine')} onClick={newRoutine} />
          </>
        )}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <FilterBar
            fields={fields}
            values={values}
            onChange={changeFilter}
            isLabel={t('chatsIndex.is')}
            isAnyOfLabel={t('chatsIndex.isAnyOf')}
            removeLabel={(field) => `${t('common.remove')} ${field}`}
          />
          {!loaded ? (
            // Otto: the same padded wrapper as Chats and Tasks (DESIGN.md, PageWrap).
            <PageWrap aria-busy padded>
              <ul>{[0, 1, 2].map((i) => <ListRowSkeleton key={i} />)}</ul>
            </PageWrap>
          ) : type && groups[type].length === 0 ? (
            <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
              <Button variant="outline" onClick={() => setType(undefined)}>{t('chatsIndex.clearFilters')}</Button>
            </NoResults>
          ) : (
            // Otto: the same padded wrapper as Chats and Tasks (DESIGN.md, PageWrap).
            <PageWrap padded>
              {ROUTINE_TYPES.map((group) => {
                const Icon = ROUTINE_TYPE_ICONS[group]
                return (
                  <ListGroup key={group} icon={<Icon />} label={t(`routines.type_${group}`)} count={groups[group].length}>
                    {groups[group].map((routine) => <RoutineRow key={routine.id} routine={routine} actions={actions} onOpen={open} />)}
                  </ListGroup>
                )
              })}
            </PageWrap>
          )}
        </div>
      </PageColumn>
      {actions.dialog}
    </div>
  )
}
