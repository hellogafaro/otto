/**
 * The links of a task or project (its `resources`: web links, library items, chats) as sidecar property rows:
 * one row per link that opens it (a web link in the browser, an item or chat in the app) with Remove on hover,
 * then "New link" (up to `MAX_RESOURCES`) opening `ResourceDialog`. Generic: the caller saves `onChange`.
 * Put it in a `PropertySection`. Library and chat refs are not looked up (they may dangle).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Library, Link, MessageSquare, Plus, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PropertyRow } from '@workspace/ui/components/property-list'
import { MAX_RESOURCES } from '@otto/shared/projects/limits'
import { routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/navigation-context'
import type { Resource } from '../../../shared/types'
import { ResourceDialog } from './resource-dialog'

const ICONS = { url: Link, library: Library, chat: MessageSquare } as const

export function ResourceList({ resources, onChange }: { resources: Resource[]; onChange: (next: Resource[]) => void }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [adding, setAdding] = React.useState(false)

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
      {resources.length < MAX_RESOURCES && (
        <PropertyRow icon={<Plus />} label={t('resources.new')} onClick={() => setAdding(true)} />
      )}
      <ResourceDialog open={adding} onOpenChange={setAdding} onAdd={(resource) => onChange([...resources, resource])} />
    </>
  )
}
