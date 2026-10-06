/**
 * The links of a task or project (its `resources`: web links, library items, chats) as sidecar property rows:
 * one row per link that opens it (a web link in the browser, an item or chat in the app) with Remove on hover.
 * `NewLink` is the section's create "+" (the section's `action`; up to `MAX_RESOURCES`) opening `ResourceDialog`.
 * Generic: the caller saves `onChange`. Put them in a `PropertySection` or a `PageSection`. Library and chat refs
 * are not looked up (they may dangle).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Library, Link, MessageSquare, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PropertyRow } from '@workspace/ui/components/property-list'
import { MAX_RESOURCES } from '@otto/shared/projects/limits'
import { CreateButton } from '@/components/ui/create-button'
import { routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/navigation-context'
import type { Resource } from '../../../shared/types'
import { ResourceDialog } from './resource-dialog'

const ICONS = { url: Link, library: Library, chat: MessageSquare } as const

type ResourceListProps = { resources: Resource[]; onChange: (next: Resource[]) => void }

/** The links section's create "+": New link, hidden at `MAX_RESOURCES`. */
export function NewLink({ resources, onChange, size }: ResourceListProps & { size?: 'icon-xs' }) {
  const { t } = useTranslation()
  const [adding, setAdding] = React.useState(false)
  if (resources.length >= MAX_RESOURCES) return null
  return (
    <>
      <CreateButton size={size} label={t('resources.new')} onClick={() => setAdding(true)} />
      <ResourceDialog open={adding} onOpenChange={setAdding} onAdd={(resource) => onChange([...resources, resource])} />
    </>
  )
}

export function ResourceList({ resources, onChange }: ResourceListProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()

  const open = (resource: Resource) => {
    if (resource.type === 'url') void window.electronAPI.openUrl(resource.ref)
    else if (resource.type === 'library') void navigate(routes.view.library({ itemId: resource.ref }))
    else void navigate(routes.view.allSessions(resource.ref))
  }

  return (
    <>
      {resources.map((resource, index) => {
        const Icon = ICONS[resource.type]
        return (
          <PropertyRow
            key={`${resource.type}:${resource.ref}:${index}`}
            icon={<Icon />}
            value={resource.type === 'url'
              ? <><span className="truncate">{resource.title}</span><ArrowUpRight className="text-muted-foreground" /></>
              : resource.title}
            onClick={() => open(resource)}
            actions={(
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('resources.remove')}
                onClick={() => onChange(resources.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            )}
          />
        )
      })}
    </>
  )
}
