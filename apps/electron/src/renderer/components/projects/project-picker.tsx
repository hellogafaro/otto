/**
 * `ProjectPicker`: one project of the workspace in the shared searchable `Picker` (the active projects, and the
 * current one when it is archived, so it stays checked). Any element opens it: a sidecar `PropertyRow`, a form field.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Box } from 'lucide-react'
import { Picker } from '@workspace/ui/components/picker'
import { useProjects } from '@/hooks/use-projects'

export function ProjectPicker({ value, onValueChange, trigger, open, onOpenChange, className }: {
  /** The chosen project's id; '' or null for none. */
  value: string | null
  onValueChange: (projectId: string) => void
  trigger: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const { t } = useTranslation()
  const { projects } = useProjects()
  const choosable = projects.filter((p) => p.status === 'active' || p.id === value)
  const titles = new Map(choosable.map((p) => [p.id, p.title]))
  return (
    <Picker
      items={choosable.map((p) => p.id)}
      value={value || null}
      onValueChange={onValueChange}
      itemLabel={(id) => titles.get(id) ?? ''}
      itemIcon={() => <Box />}
      trigger={trigger}
      search={t('pickers.searchProjects')}
      empty={t('pickers.noProjects')}
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    />
  )
}
