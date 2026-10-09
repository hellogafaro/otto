/**
 * SkillInfoPage
 *
 * A skill's page, read like a document: its name once in the title row, its description once as the lead line
 * under it, then its instructions (SKILL.md's body, the Library's read-only markdown) and its details (location,
 * required sources, always-allowed tools), each a section of the page column. Its actions are the title row's
 * More actions (Copy link, Show in the file manager, Delete); editing asks an agent through each section's
 * Edit button, which prefills the composer.
 */

import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { useEffect, useState } from 'react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@workspace/ui/components/dropdown-menu'
import { toast } from '@workspace/ui/components/sonner'
import { AgentEditButton } from '@/components/ui/agent-edit-button'
import { Markdown } from '@/components/markdown'
import { useActiveWorkspace } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { useParentView } from '@/hooks/use-parent-view'
import { routes, routeUrl } from '@/lib/navigate'
import { getFileManagerName } from '@/lib/platform'
import { Info_Page, Info_Section, Info_Table } from '@/components/info'
import type { LoadedSkill } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
}

/** The skill's folder from its skills directory on (`skills/{slug}`), else the whole path. */
function formatPath(path: string) {
  const skillsIndex = path.indexOf('/skills/')
  return skillsIndex === -1 ? path : path.slice(skillsIndex + 1)
}

/** SKILL.md's body without a leading `# {name}`: the title row already shows the name (each fact once). */
function withoutTitle(content: string, name: string) {
  const [first = '', ...rest] = content.trimStart().split('\n')
  return first.trim().toLowerCase() === `# ${name.trim()}`.toLowerCase() ? rest.join('\n').trimStart() : content
}

export default function SkillInfoPage({ skillSlug, workspaceId }: SkillInfoPageProps) {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:skills', placeholder: t('composer.placeholder.start') })
  const { showNotFound } = useNavigation()
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  // Deleted: back to the grid it was opened from
  const parent = useParentView()
  const { dialog: deleteDialog, confirmDelete } = useConfirmDelete()

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)
        } else if (workspaceId) {
          // The URL names a skill nobody has: the app shows its not-found page
          showNotFound()
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : t('skillInfo.failedToLoad'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((changedWorkspaceId, skills) => {
      if (changedWorkspaceId !== workspaceId) return
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug, showNotFound])

  const showInFolder = async (path: string) => {
    try {
      await window.electronAPI.showInFolder(path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), { description: message })
    }
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(routeUrl(routes.view.skills({ skillSlug })))
    toast.success(t('toast.linkCopied'))
  }

  const deleteSkill = (target: LoadedSkill) =>
    confirmDelete(t('skillsList.deleteSkill'), async () => {
      await window.electronAPI.deleteSkill(workspaceId, target.slug)
      toast.success(t('skillInfo.deletedSkill', { name: target.metadata.name }))
      parent?.onBack()
    })

  const menu = skill && (
    <>
      <DropdownMenuItem shortcut="C" onClick={copyLink}>{t('library.copyLink')}</DropdownMenuItem>
      {canRevealLocally && (
        <DropdownMenuItem onClick={() => showInFolder(skill.path)}>
          {t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" shortcut="⌫" onClick={() => deleteSkill(skill)}>{t('common.delete')}</DropdownMenuItem>
    </>
  )

  // Both edits prefill the composer with a sentence naming the skill.
  const editButton = (key: 'skillInstructions' | 'skillMetadata', name: string) => <AgentEditButton prompt={t(`agentEdit.${key}`, { name })} />

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? t('skillInfo.notFound') : undefined}
    >
      <Info_Page.Header title={skill?.metadata.name || skillSlug} description={skill?.metadata.description} menu={menu} />

      {skill && (
        <Info_Page.Content>
          <Info_Section title={t('skillInfo.instructions')} actions={editButton('skillInstructions', skill.metadata.name)}>
            <div className="p-4">
              <Markdown mode="full" className="max-w-[37em]" onUrlClick={(url) => window.electronAPI.openUrl(url)}>
                {withoutTitle(skill.content, skill.metadata.name) || t('skillInfo.noInstructions')}
              </Markdown>
            </div>
          </Info_Section>

          <Info_Section title={t('skillInfo.metadata')} actions={editButton('skillMetadata', skill.metadata.name)}>
            <Info_Table>
              <Info_Table.Row label={t('common.location')} value={formatPath(skill.path)} />
              {!!skill.metadata.requiredSources?.length && (
                <Info_Table.Row label={t('skillInfo.requiredSources')} value={skill.metadata.requiredSources.join(', ')} />
              )}
              {!!skill.metadata.alwaysAllow?.length && (
                <Info_Table.Row label={t('skillInfo.alwaysAllowed')} value={skill.metadata.alwaysAllow.join(', ')} />
              )}
            </Info_Table>
          </Info_Section>
        </Info_Page.Content>
      )}
      {deleteDialog}
    </Info_Page>
  )
}
