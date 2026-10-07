/**
 * `AssigneePicker`: pick several people and agents of the workspace (`useWorkspaceMembers().members`) in the shared
 * searchable `Picker` (multiple), opened by `trigger` (a sidecar `PropertyRow`, a form field).
 * Actors already chosen that are no longer members stay listed so they can be removed.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Picker } from '@workspace/ui/components/picker'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ActorAvatar } from './actor-avatar'

export function AssigneePicker({ value, onChange, trigger, className }: {
  value: string[]
  onChange: (next: string[]) => void
  /** The element that opens the list (rendered by the combobox's trigger). */
  trigger: React.ReactElement
  className?: string
}) {
  const { t } = useTranslation()
  const { members, nameOf } = useWorkspaceMembers()
  const items = React.useMemo(() => [...new Set([...members.map((m) => m.actor), ...value])], [members, value])
  return (
    <Picker
      multiple
      items={items}
      value={value}
      onValueChange={onChange}
      itemLabel={nameOf}
      itemIcon={(actor) => <ActorAvatar actor={actor} name={nameOf(actor)} />}
      trigger={trigger}
      search={t('pickers.searchPeople')}
      empty={t('pickers.noPeople')}
      className={className}
    />
  )
}
