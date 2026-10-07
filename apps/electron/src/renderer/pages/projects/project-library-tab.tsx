/**
 * A project's Documents or Files tab: the project's `library` links of that kind as a 4-column gallery of
 * `LibraryTile`s (Open, Copy link, Remove from project). A link whose item is gone is a muted "Unavailable" tile
 * whose only action is Remove. Empty: the inline `Empty`, no action. `AddFromLibrary` is the tab's header
 * button: a searchable list of the library's items of that kind not linked yet; picking one links it.
 */

import { File, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Picker } from '@workspace/ui/components/picker'
import { ContextMenuContent, ContextMenuItem } from '@workspace/ui/components/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { toast } from '@workspace/ui/components/sonner'
import { MAX_RESOURCES } from '@otto/shared/projects/limits'
import { CreateButton } from '@/components/ui/create-button'
import { useNavigation } from '@/contexts/navigation-context'
import { useLibrary } from '@/hooks/use-library'
import { routes } from '@/lib/navigate'
import type { Resource } from '../../../shared/types'
import { libraryItemUrl } from '../library/item-dialogs'
import { getDisplayTitle } from '../library/library-items'
import { LibraryTile } from '../library/library-tile'
import { getLibraryCandidates, getProjectLibrary, type ProjectLibraryKind } from './project-items'

/** A link whose item is gone: muted, captioned "Unavailable", and Remove as its only action. */
function UnavailableTile({ resource, kind, onRemove }: { resource: Resource; kind: ProjectLibraryKind; onRemove: () => void }) {
  const { t } = useTranslation()
  const Icon = kind === 'document' ? FileText : File
  const remove = t('projects.removeFromProject')
  return (
    <GalleryItem
      title={resource.title}
      icon={<Icon />}
      media={<Icon />}
      label={t('projects.unavailable')}
      muted
      menu={<ContextMenuContent><ContextMenuItem onClick={onRemove}>{remove}</ContextMenuItem></ContextMenuContent>}
    />
  )
}

export function ProjectLibraryTab({ kind, resources, onResources }: {
  kind: ProjectLibraryKind
  resources: Resource[]
  /** Save the project's new links (applied at once with the "Saved" toast). */
  onResources: (next: Resource[]) => void
}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { items, loaded } = useLibrary()
  const entries = getProjectLibrary(resources, items, kind)
  const removeAt = (index: number) => onResources(resources.filter((_, i) => i !== index))

  if (!loaded) {
    return <Gallery columns={4}>{[0, 1, 2, 3].map((i) => <GalleryItemSkeleton key={i} />)}</Gallery>
  }
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t(kind === 'document' ? 'projects.noDocuments' : 'projects.noFiles')}</EmptyTitle>
          <EmptyDescription>{t(kind === 'document' ? 'projects.noDocumentsDescription' : 'projects.noFilesDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Gallery columns={4}>
      {entries.map(({ index, resource, item }) => item ? (
        <LibraryTile
          key={`${index}:${resource.ref}`}
          item={item}
          onOpen={() => navigate(routes.view.library({ itemId: item.id }))}
          actions={{
            onCopyLink: async () => {
              await navigator.clipboard.writeText(libraryItemUrl(item.id))
              toast.success(t('toast.linkCopied'))
            },
            remove: { label: t('projects.removeFromProject'), onClick: () => removeAt(index) },
          }}
        />
      ) : (
        <UnavailableTile key={`${index}:${resource.ref}`} resource={resource} kind={kind} onRemove={() => removeAt(index)} />
      ))}
    </Gallery>
  )
}

/** The tab's "Add from library": a 28px ghost button opening a searchable list; a pick links the item. */
export function AddFromLibrary({ kind, resources, onResources }: {
  kind: ProjectLibraryKind
  resources: Resource[]
  onResources: (next: Resource[]) => void
}) {
  const { t } = useTranslation()
  const { items } = useLibrary()
  const candidates = getLibraryCandidates(items, resources, kind)
  const byId = new Map(candidates.map((item) => [item.id, item]))
  const titleOf = (id: string) => { const item = byId.get(id); return item ? getDisplayTitle(item) : '' }
  const Icon = kind === 'document' ? FileText : File

  return (
    <Picker
      items={candidates.map((item) => item.id)}
      value={null}
      onValueChange={(id) => {
        const item = byId.get(id)
        if (item) onResources([...resources, { type: 'library', ref: item.id, title: item.title }])
      }}
      itemLabel={titleOf}
      itemIcon={() => <Icon />}
      disabled={resources.length >= MAX_RESOURCES}
      trigger={<CreateButton label={t('projects.addFromLibrary')} />}
      search={t(kind === 'document' ? 'pickers.searchDocuments' : 'pickers.searchFiles')}
      empty={t(candidates.length > 0
        ? kind === 'document' ? 'pickers.noDocuments' : 'pickers.noFiles'
        : kind === 'document' ? 'projects.allDocumentsAdded' : 'projects.allFilesAdded')}
      align="end"
      className="w-64"
    />
  )
}
