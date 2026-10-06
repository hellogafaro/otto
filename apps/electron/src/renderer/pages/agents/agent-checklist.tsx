/**
 * The Skills and Sources sections of an agent's page: which ones it may use, as a checklist in a card. "All" comes
 * first (an agent's `[]`: everything, including what is added later); each row toggles as a whole (its label holds
 * the checkbox). The last allowed row and "All" while on cannot be turned off: an empty list would mean all.
 */

import type { ReactNode } from 'react'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { cn } from '@/lib/utils'
import { isAllowed, toggleAllowed } from './agent-fields'

export interface ChecklistItem {
  key: string
  label: string
  icon: ReactNode
}

function Row({ checked, readOnly, disabled, onCheck, icon, label }: {
  checked: boolean
  readOnly: boolean
  disabled: boolean
  onCheck: () => void
  icon?: ReactNode
  label: string
}) {
  const inert = readOnly || disabled
  return (
    <label className={cn('flex items-center gap-3 px-4 py-3 text-sm font-medium', !inert && 'cursor-pointer hover:bg-foreground/5')}>
      <Checkbox checked={checked} readOnly={readOnly} disabled={disabled} onCheckedChange={() => !inert && onCheck()} />
      {icon && <span className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}

export function AgentChecklist({ title, description, allLabel, emptyLabel, items, selected, disabled, onChange }: {
  title: string
  /** "Can use 3 of 8 skills."; none when there is nothing to pick. */
  description?: string
  allLabel: string
  emptyLabel: string
  items: ChecklistItem[]
  selected: string[]
  disabled: boolean
  onChange: (next: string[]) => void
}) {
  const keys = items.map((item) => item.key)
  const all = selected.length === 0
  const allowed = keys.filter((key) => isAllowed(selected, key))
  return (
    <SettingsSection title={title} description={items.length > 0 ? description : undefined}>
      <SettingsCard>
        {items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <>
            <Row checked={all} readOnly={all} disabled={disabled} onCheck={() => onChange([])} label={allLabel} />
            {items.map((item) => {
              const checked = isAllowed(selected, item.key)
              return (
                <Row
                  key={item.key}
                  checked={checked}
                  readOnly={checked && allowed.length === 1}
                  disabled={disabled}
                  onCheck={() => onChange(toggleAllowed(selected, keys, item.key))}
                  icon={item.icon}
                  label={item.label}
                />
              )
            })}
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
