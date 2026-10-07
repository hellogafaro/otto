/**
 * The links of a task or project (its `resources`: web links, library items, chats) as sidecar property rows:
 * one row per link that opens it (a web link in the browser, an item or chat in the app) with Remove on hover.
 * `NewLink` is the section's create "+" (the section's `action`; up to `MAX_RESOURCES`): no form, it prefills the
 * floating composer ("Add a link to {token}: ") and an agent adds the link (`otto tasks|projects update`).
 * Generic: the caller saves `onChange` (Remove). Put them in a `PropertySection` or a `PageSection`. Library and chat refs
 * are not looked up (they may dangle).
 */

import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Library, Link, MessageSquare, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { PropertyRow } from '@workspace/ui/components/property-list'
import { MAX_RESOURCES } from '@otto/shared/projects/limits'
import { CreateButton } from '@/components/ui/create-button'
import { routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/navigation-context'
import { useComposer } from '@/components/composer/composer-provider'
import type { Resource } from '../../../shared/types'

const ICONS = { url: Link, library: Library, chat: MessageSquare } as const

type ResourceListProps = { resources: Resource[]; onChange: (next: Resource[]) => void }

/** The links section's create "+" (New link) on `entity` (`task:<id>`, `project:<id>`): prefills the composer; hidden at `MAX_RESOURCES`. */
export function NewLink({ entity, resources, size }: { entity: string; resources: Resource[]; size?: 'icon-xs' }) {
  const { t } = useTranslation()
  const composer = useComposer()
  if (resources.length >= MAX_RESOURCES) return null
  return <CreateButton size={size} label={t('resources.new')} onClick={() => composer.prefill(`${t('agentEdit.addLink', { token: entity })} `)} />
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
