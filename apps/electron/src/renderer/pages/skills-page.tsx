/**
 * Skills (`/{ws}/settings/skills`): the workspace's skills as a gallery, like the Library without tabs. The title
 * row: Filter (Scope: Global, Workspace, Project; `?scope=`), Search (the palette on Skills) and "+" (Add skill:
 * prefills the composer, which asks an agent to write it). A tile is the skill's own icon, its name and its scope;
 * it opens the skill (no menu: the skill's page has its More actions), whose Back returns here and whose Previous /
 * Next step through this grid. No skills at all: the stock empty page alone (no
 * title row), with the same Add skill.
 */

import { Layers, Shapes } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField } from '@workspace/ui/components/filters'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { skillsAtom } from '@/atoms/skills'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { useComposer } from '@/components/composer/composer-provider'
import { useActiveWorkspace } from '@/context/app-shell-context'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { CreateButton } from '@/components/ui/create-button'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { isSkillsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { routes } from '@/lib/navigate'
import { getVisibleSkills } from '@/lib/skill-source-lists'
import { SKILL_SCOPES, type SkillScope, type SkillsSearch } from '../../shared/section-search'

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  global: 'skillsList.scopeGlobal',
  workspace: 'skillsList.scopeWorkspace',
  project: 'skillsList.scopeProject',
}

export function SkillsPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:skills', placeholder: t('composer.placeholder.start') })
  const skills = useAtomValue(skillsAtom)
  const navState = useNavigationState()
  const { navigate } = useNavigation()
  const workspace = useActiveWorkspace()
  const composer = useComposer()
  const search: SkillsSearch = isSkillsNavigation(navState) ? navState.search : {}
  const setScope = (scope: SkillScope | undefined) => navigate(routes.view.skills({ scope }))

  /** Add skill: prefills the composer; Enter starts the chat that writes the skill. */
  const addSkill = () => composer.prefill(t('agentEdit.addSkill') + ' ')

  // No skills at all: the stock empty page, its button Add skill.
  if (skills?.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Shapes />} title={t('skillsList.noSkillsConfigured')} description={t('skillsList.emptyDescription')}>
          <Button onClick={addSkill}>{t('skillsList.addSkill')}</Button>
        </EntityListEmptyScreen>
      </div>
    )
  }

  const fields: FilterField[] = [{
    key: 'scope',
    label: t('skillsList.scope'),
    icon: <Layers />,
    options: SKILL_SCOPES.map((scope) => ({ value: scope, label: t(SKILL_SCOPE_LABELS[scope]) })),
  }]
  const values = { scope: search.scope ? [search.scope] : [] }
  // One scope at a time (the route holds one): the last one picked.
  const changeFilter = (_key: string, next: string[]) => setScope(next[next.length - 1] as SkillScope | undefined)
  const visible = skills ? getVisibleSkills(skills, search) : []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.skills')}
        actions={(
          <>
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('skillsList.filter')} />
            <CommandPaletteButton category="skills" />
            <CreateButton label={t('skillsList.addSkill')} onClick={addSkill} />
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
          {!skills ? (
            <Gallery columns={4}>
              {Array.from({ length: 8 }, (_, index) => <GalleryItemSkeleton key={index} />)}
            </Gallery>
          ) : visible.length === 0 ? (
            <NoResults title={t('library.noResults')} description={t('library.noResultsDescription')}>
              <Button variant="outline" onClick={() => setScope(undefined)}>{t('library.clearFilters')}</Button>
            </NoResults>
          ) : (
            <Gallery columns={4}>
              {visible.map((skill) => (
                <GalleryItem
                  key={skill.slug}
                  title={skill.metadata.name || skill.slug}
                  icon={<SkillAvatar skill={skill} size="xs" chromeless workspaceId={workspace?.id} />}
                  media={<SkillAvatar skill={skill} size="sm" chromeless workspaceId={workspace?.id} />}
                  label={t(SKILL_SCOPE_LABELS[skill.source])}
                  onClick={() => navigate(routes.view.skills({ skillSlug: skill.slug, ...search }))}
                />
              ))}
            </Gallery>
          )}
        </div>
      </PageColumn>
    </div>
  )
}
