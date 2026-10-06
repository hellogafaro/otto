/**
 * Skills (`/{ws}/settings/skills`): the workspace's skills as a gallery, like the Library without tabs. The title
 * row: Filter (Scope: Global, Workspace, Project; `?scope=`), Search (the palette on Skills) and "+" (Add skill:
 * the add-skill popover, which asks an agent to write it). A tile is the skill's own icon, its name and its scope;
 * it opens the skill, whose Back returns here and whose Previous / Next step through this grid. No skills at all:
 * the stock empty page with the same Add skill.
 */

import { Layers, Plus, Zap } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField } from '@workspace/ui/components/filters'
import { Gallery, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { skillsAtom } from '@/atoms/skills'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { EditPopover, getEditConfig } from '@/components/ui/edit-popover'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { useActiveWorkspace } from '@/context/app-shell-context'
import { isSkillsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { routes, routeUrl } from '@/lib/navigate'
import { getVisibleSkills } from '@/lib/skill-source-lists'
import { SKILL_SCOPES, type SkillScope, type SkillsSearch } from '../../shared/section-search'
import type { LoadedSkill } from '../../shared/types'
import { SettingsGalleryTile, useConfirmDelete } from './settings-gallery'

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  global: 'skillsList.scopeGlobal',
  workspace: 'skillsList.scopeWorkspace',
  project: 'skillsList.scopeProject',
}

/** Delete a workspace skill (global and project skills are not this workspace's to delete), after asking. */
export function useDeleteSkill(onDeleted?: () => void) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const { dialog, confirmDelete } = useConfirmDelete()
  const deleteSkill = (skill: LoadedSkill) =>
    confirmDelete(t('skillsList.deleteSkill'), async () => {
      if (!workspace) throw new Error('no workspace')
      await window.electronAPI.deleteSkill(workspace.id, skill.slug)
      toast.success(t('skillInfo.deletedSkill', { name: skill.metadata.name }))
      onDeleted?.()
    })
  return { dialog, deleteSkill }
}

export function SkillsPage() {
  const { t } = useTranslation()
  const skills = useAtomValue(skillsAtom)
  const navState = useNavigationState()
  const { navigate } = useNavigation()
  const workspace = useActiveWorkspace()
  const { dialog, deleteSkill } = useDeleteSkill()
  const search: SkillsSearch = isSkillsNavigation(navState) ? navState.search : {}
  const setScope = (scope: SkillScope | undefined) => navigate(routes.view.skills({ scope }))

  /** Add skill: the add-skill popover on `trigger` (it starts a chat that writes the skill). */
  const addSkill = (trigger: React.ReactNode) =>
    workspace ? <EditPopover trigger={trigger} {...getEditConfig('add-skill', workspace.rootPath)} /> : null

  // No skills at all: the stock empty page, its button Add skill.
  if (skills?.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Zap />} title={t('skillsList.noSkillsConfigured')} description={t('skillsList.emptyDescription')}>
          {addSkill(<Button>{t('skillsList.addSkill')}</Button>)}
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
            {addSkill(<HeaderIconButton icon={<Plus />} tooltip={t('skillsList.addSkill')} />)}
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
              {visible.map((skill) => {
                const route = routes.view.skills({ skillSlug: skill.slug, ...search })
                return (
                  <SettingsGalleryTile
                    key={skill.slug}
                    title={skill.metadata.name || skill.slug}
                    icon={<SkillAvatar skill={skill} size="xs" chromeless workspaceId={workspace?.id} />}
                    media={<SkillAvatar skill={skill} size="sm" chromeless workspaceId={workspace?.id} />}
                    label={t(SKILL_SCOPE_LABELS[skill.source])}
                    actions={{
                      onOpen: () => navigate(route),
                      onCopyLink: async () => {
                        await navigator.clipboard.writeText(routeUrl(routes.view.skills({ skillSlug: skill.slug })))
                        toast.success(t('toast.linkCopied'))
                      },
                      onDelete: skill.source === 'workspace' ? () => deleteSkill(skill) : undefined,
                    }}
                  />
                )
              })}
            </Gallery>
          )}
        </div>
      </PageColumn>
      {dialog}
    </div>
  )
}
