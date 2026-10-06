/**
 * Sources (`/{ws}/settings/sources`): the workspace's sources as a gallery, like the Library without tabs. The
 * title row: Filter (Type: MCP, API, Local; `?type=`), Search (the palette on Sources) and "+" (Add source: the
 * add-source popover, which asks an agent to set it up, for the filtered type when one is set). A tile is the
 * source's own icon, its name and its type; it opens the source (no menu: the source's page has its More actions),
 * whose Back returns here and whose Previous / Next step through this grid. No sources
 * at all: the stock empty page alone (no title row), with the same Add source.
 */

import { DatabaseZap, Shapes } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField } from '@workspace/ui/components/filters'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { sourcesAtom } from '@/atoms/sources'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { EditPopover, getEditConfig } from '@/components/ui/edit-popover'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { CreateButton } from '@/components/ui/create-button'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { useActiveWorkspace } from '@/context/app-shell-context'
import { isSourcesNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { routes } from '@/lib/navigate'
import { getVisibleSources } from '@/lib/skill-source-lists'
import type { SourceFilter } from '../../shared/types'

type SourceType = SourceFilter['sourceType']

const SOURCE_TYPES: SourceType[] = ['mcp', 'api', 'local']

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  mcp: 'sourcesList.typeMcp',
  api: 'sourcesList.typeApi',
  local: 'sourcesList.typeLocal',
}

export function SourcesPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:sources', placeholder: t('composer.placeholder.start') })
  const sources = useAtomValue(sourcesAtom)
  const navState = useNavigationState()
  const { navigate } = useNavigation()
  const workspace = useActiveWorkspace()
  const filter = isSourcesNavigation(navState) ? navState.filter : undefined
  const type = filter?.sourceType
  const setType = (next: SourceType | undefined) => navigate(routes.view.sources({ type: next }))

  /** Add source: the add-source popover on `trigger` (for the filtered type), which starts a chat that sets it up. */
  const addSource = (trigger: React.ReactNode) =>
    workspace ? <EditPopover trigger={trigger} {...getEditConfig(type ? `add-source-${type}` : 'add-source', workspace.rootPath)} /> : null

  // No sources at all: the stock empty page, its button Add source.
  if (sources?.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<DatabaseZap />} title={t('sourcesList.noSourcesConfigured')} description={t('sourcesList.emptyDescription')}>
          {addSource(<Button>{t('sourcesList.addSource')}</Button>)}
        </EntityListEmptyScreen>
      </div>
    )
  }

  const fields: FilterField[] = [{
    key: 'type',
    label: t('common.type'),
    icon: <Shapes />,
    options: SOURCE_TYPES.map((value) => ({ value, label: t(SOURCE_TYPE_LABELS[value]) })),
  }]
  const values = { type: type ? [type] : [] }
  // One type at a time (the route holds one): the last one picked.
  const changeFilter = (_key: string, next: string[]) => setType(next[next.length - 1] as SourceType | undefined)
  const visible = sources ? getVisibleSources(sources, filter) : []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.sources')}
        actions={(
          <>
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('sourcesList.filter')} />
            <CommandPaletteButton category="sources" />
            {addSource(<CreateButton label={t('sourcesList.addSource')} />)}
          </>
        )}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <FilterBar
            fields={fields}
            values={values}
            onChange={changeFilter}
            isLabel={t('library.is')}
            isAnyOfLabel={t('library.isAnyOf')}
            removeLabel={(field) => `${t('common.remove')} ${field}`}
          />
          {!sources ? (
            <Gallery columns={4}>
              {Array.from({ length: 8 }, (_, index) => <GalleryItemSkeleton key={index} />)}
            </Gallery>
          ) : visible.length === 0 ? (
            <NoResults title={t('library.noResults')} description={t('library.noResultsDescription')}>
              <Button variant="outline" onClick={() => setType(undefined)}>{t('library.clearFilters')}</Button>
            </NoResults>
          ) : (
            <Gallery columns={4}>
              {visible.map((source) => (
                <GalleryItem
                  key={source.config.slug}
                  title={source.config.name || source.config.slug}
                  icon={<SourceAvatar source={source} size="xs" chromeless />}
                  media={<SourceAvatar source={source} size="sm" chromeless />}
                  label={t(SOURCE_TYPE_LABELS[source.config.type as SourceType] ?? 'common.source')}
                  onClick={() => navigate(routes.view.sources({ sourceSlug: source.config.slug, type }))}
                />
              ))}
            </Gallery>
          )}
        </div>
      </PageColumn>
    </div>
  )
}
