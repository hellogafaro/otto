/**
 * `AssigneePicker`: pick several people and agents of the workspace (`useWorkspaceMembers().members`) as a
 * searchable multi `Combobox`. Two looks: with a `trigger` (a sidecar `PropertyRow`) the list and its search
 * open from it; without one it is a form field of chips with the search typed in it (the New task dialog).
 * Actors already chosen that are no longer members stay listed so they can be removed.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from '@workspace/ui/components/combobox'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ActorAvatar } from './actor-avatar'

export function AssigneePicker({
  value,
  onChange,
  trigger,
  id,
}: {
  value: string[]
  onChange: (next: string[]) => void
  /** The element that opens the list (rendered by the combobox's trigger); none draws the chips field. */
  trigger?: React.ReactElement
  /** The chips input's id, for a `FieldLabel`. */
  id?: string
}) {
  const { t } = useTranslation()
  const { members, nameOf } = useWorkspaceMembers()
  const anchor = useComboboxAnchor()
  const items = React.useMemo(() => [...new Set([...members.map((m) => m.actor), ...value])], [members, value])

  const list = (
    <>
      <ComboboxEmpty>{t('tasks.noMatches')}</ComboboxEmpty>
      <ComboboxList>
        {(actor: string) => (
          <ComboboxItem key={actor} value={actor}>
            <ActorAvatar actor={actor} name={nameOf(actor)} />
            <span className="truncate">{nameOf(actor)}</span>
          </ComboboxItem>
        )}
      </ComboboxList>
    </>
  )

  return (
    <Combobox
      multiple
      items={items}
      value={value}
      onValueChange={(next) => onChange(next as string[])}
      itemToStringLabel={nameOf}
    >
      {trigger ? (
        <>
          <ComboboxTrigger render={trigger} />
          <ComboboxContent className="w-60">
            <ComboboxSearch placeholder={t('tasks.searchPeople')} />
            {list}
          </ComboboxContent>
        </>
      ) : (
        <>
          <ComboboxChips ref={anchor}>
            <ComboboxValue>
              {(chosen: string[]) => (
                <>
                  {chosen.map((actor) => <ComboboxChip key={actor}>{nameOf(actor)}</ComboboxChip>)}
                  <ComboboxChipsInput id={id} placeholder={chosen.length ? undefined : t('tasks.noAssignees')} />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>{list}</ComboboxContent>
        </>
      )}
    </Combobox>
  )
}
