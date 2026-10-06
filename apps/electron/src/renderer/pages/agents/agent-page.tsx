/**
 * An agent's page (`/{ws}/settings/agents/{id}`): one roomy column, no tabs, everything saved as you go (one draft,
 * 600 ms after the last change, on blur at once; one "Agent saved" toast; no Save button). The title row is its name
 * (with "Default" on the workspace's default agent) and More actions (Copy link, Delete). Sections: Profile (name,
 * avatar: generated from the id, or an image uploaded to the library), Instructions (the card is the field), Model
 * (provider, model and thinking over your own connections), Skills and Sources (checklists, `[]` = all) and Computer
 * (a placeholder until agent computers exist). Only its creator and workspace owners change it (the server guards it
 * too); everyone else reads it. The last agent cannot be deleted.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Monitor } from 'lucide-react'
import { MAX_INSTRUCTIONS, MAX_TITLE } from '@otto/shared/agents/types'
import { THINKING_LEVELS } from '@otto/shared/agent/thinking-levels'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@workspace/ui/components/dropdown-menu'
import { toast } from '@workspace/ui/components/sonner'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Info_Page } from '@/components/info'
import { AgentAvatar, avatarLibraryId } from '@/components/people/agent-avatar'
import { SettingsCard, SettingsMenuSelectRow, SettingsRow, SettingsSection } from '@/components/settings'
import { Input } from '@/components/ui/input'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { useActiveWorkspace, useAppShellContext } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useAgents } from '@/hooks/use-agents'
import { useAutosave } from '@/hooks/use-autosave'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { useParentView } from '@/hooks/use-parent-view'
import { useWorkspaceMemberList, useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { routes, routeUrl } from '@/lib/navigate'
import { getVisibleSkills, getVisibleSources } from '@/lib/skill-source-lists'
import { readFileAsBase64 } from '../library/library-items'
import type { Agent } from '../../../shared/types'
import { AgentChecklist } from './agent-checklist'
import {
  allowedCount,
  modelChoices,
  providerChoices,
  providerLabel,
  skillKey,
  sourceKey,
  toDraft,
  toPatch,
  type AgentDraft,
} from './agent-fields'

/** BB's autosave wait for an agent (DESIGN.md, Agents). */
const AGENT_AUTOSAVE_MS = 600
/** An avatar is a small picture; larger uploads are refused before they reach the library. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export function AgentPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:agents', placeholder: t('composer.placeholder.start') })
  const agentsApi = useAgents()
  const { showNotFound } = useNavigation()
  const agent = agentsApi.agents.find((entry) => entry.id === agentId)
  const leaving = React.useRef(false)

  // The URL names an agent the workspace does not have: the app's not-found page (not after deleting it here).
  React.useEffect(() => {
    if (agentsApi.loaded && !agent && !leaving.current) showNotFound()
  }, [agentsApi.loaded, agent, showNotFound])

  if (!agent) {
    return (
      <Info_Page loading>
        <Info_Page.Header />
      </Info_Page>
    )
  }
  return <AgentView agent={agent} agentsApi={agentsApi} onLeave={() => { leaving.current = true }} />
}

function AgentView({ agent, agentsApi, onLeave }: { agent: Agent; agentsApi: ReturnType<typeof useAgents>; onLeave: () => void }) {
  const { t } = useTranslation()
  const { updateAgent, deleteAgent, refresh, agents } = agentsApi
  const { llmConnections } = useAppShellContext()
  const workspace = useActiveWorkspace()
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const parent = useParentView()
  const { dialog: deleteDialog, confirmDelete } = useConfirmDelete()

  // Its creator and the workspace's owners change it; everyone else reads it.
  const { me } = useWorkspaceMembers()
  const { items: memberRows } = useWorkspaceMemberList()
  const isOwner = memberRows.some((row) => row.actor === me && row.role === 'owner')
  const canEdit = agent.createdBy === me || isOwner

  // One save loop for the whole page, each save carrying the newest `updatedAt` known.
  const version = React.useRef(agent.updatedAt)
  version.current = Math.max(version.current, agent.updatedAt)
  const latest = React.useRef(agent)
  latest.current = agent
  const save = async (next: AgentDraft) => {
    const patch = toPatch(latest.current, next)
    if (!patch) return
    const result = await updateAgent(agent.id, { ...patch, expectedUpdatedAt: version.current })
    if (!result.ok) throw Object.assign(new Error(t('agents.saveFailed')), { code: result.code })
    version.current = Math.max(version.current, result.value.updatedAt)
  }
  const { value: draft, change, flush } = useAutosave<AgentDraft>(toDraft(agent), save, {
    message: t('agents.saved'),
    ms: AGENT_AUTOSAVE_MS,
    onConflict: () => void refresh(),
  })
  const latestDraft = React.useRef(draft)
  latestDraft.current = draft
  const update = (patch: Partial<AgentDraft>) => {
    latestDraft.current = { ...latestDraft.current, ...patch }
    change(latestDraft.current)
  }

  // Avatar: an image uploaded to the library (its root), referenced as `library:<id>`
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)
  const uploadAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) return void toast.error(t('agents.avatarNotImage'))
    if (file.size > MAX_AVATAR_BYTES) return void toast.error(t('agents.avatarTooLarge'))
    setUploading(true)
    try {
      const data = await readFileAsBase64(file)
      const item = await window.electronAPI.createLibraryItem({ title: file.name, mime: file.type, content: { encoding: 'base64', data } })
      update({ avatar: `library:${item.id}` })
    } catch {
      toast.error(t('agents.avatarUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  // Model: the provider of the person's connections that pays, then a model of it (none: its default)
  const providers = providerChoices(draft.provider, llmConnections)
  const models = modelChoices(draft.provider, llmConnections)
  if (draft.model && !models.some((model) => model.value === draft.model)) models.unshift({ value: draft.model, label: draft.model })
  const provider = providerLabel(draft.provider, llmConnections)
  const hasConnection = llmConnections.some((connection) => connection.type === draft.provider)

  const skillItems = (skills ? getVisibleSkills(skills) : []).map((skill) => ({
    key: skillKey(skill),
    label: skill.metadata.name || skill.slug,
    icon: <SkillAvatar skill={skill} size="xs" chromeless workspaceId={workspace?.id} />,
  }))
  const sourceItems = (sources ? getVisibleSources(sources, undefined) : []).map((source) => ({
    key: sourceKey(source),
    label: source.config.name || source.config.slug,
    icon: <SourceAvatar source={source} size="xs" chromeless />,
  }))
  const canUse = (selected: string[], items: { key: string }[], all: string, some: string) =>
    selected.length === 0
      ? t(all)
      : t(some, { allowed: allowedCount(selected, items.map((item) => item.key)), count: items.length })

  const copyLink = async () => {
    await navigator.clipboard.writeText(routeUrl(routes.view.agents(agent.id)))
    toast.success(t('toast.linkCopied'))
  }
  const remove = () =>
    confirmDelete(t('agents.deleteTitle'), async () => {
      const result = await deleteAgent(agent.id)
      if (!result.ok) throw new Error(result.code)
      onLeave()
      toast.success(t('agents.deleted', { name: agent.title }))
      parent?.onBack()
    })
  const canDelete = canEdit && agents.length > 1
  const menu = (
    <>
      <DropdownMenuItem shortcut="C" onClick={copyLink}>{t('library.copyLink')}</DropdownMenuItem>
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" shortcut="⌫" onClick={remove}>{t('common.delete')}</DropdownMenuItem>
        </>
      )}
    </>
  )

  return (
    <Info_Page>
      <Info_Page.Header
        title={agent.title}
        badge={agent.isDefault ? <Badge variant="outline" className="ml-1">{t('agents.default')}</Badge> : undefined}
        description={canEdit ? undefined : t('agents.readOnly')}
        menu={menu}
      />
      <Info_Page.Content>
        <SettingsSection title={t('agents.profile')}>
          <SettingsCard>
            <SettingsRow label={t('agents.name')}>
              <Input
                aria-label={t('agents.name')}
                value={draft.title}
                maxLength={MAX_TITLE}
                readOnly={!canEdit}
                onChange={(event) => update({ title: event.target.value })}
                onBlur={() => {
                  if (!latestDraft.current.title.trim()) update({ title: latest.current.title })
                  flush()
                }}
                className="w-[200px]"
              />
            </SettingsRow>
            <SettingsRow
              icon={<AgentAvatar agent={{ id: agent.id, avatar: draft.avatar }} />}
              label={t('agents.avatar')}
              description={avatarLibraryId(draft.avatar) ? t('agents.avatarUploaded') : t('agents.avatarGenerated')}
            >
              {canEdit && (
                <>
                  {avatarLibraryId(draft.avatar) && (
                    <Button variant="ghost" size="compact" onClick={() => update({ avatar: '' })}>{t('agents.avatarUseGenerated')}</Button>
                  )}
                  <Button variant="outline" size="compact" loading={uploading} onClick={() => fileInput.current?.click()}>
                    {t('agents.avatarUpload')}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void uploadAvatar(file)
                    }}
                  />
                </>
              )}
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('agents.instructions')} description={t('agents.instructionsDescription')}>
          <SettingsCard>
            <textarea
              aria-label={t('agents.instructions')}
              value={draft.instructions}
              maxLength={MAX_INSTRUCTIONS}
              readOnly={!canEdit}
              placeholder={t('agents.instructionsPlaceholder')}
              onChange={(event) => update({ instructions: event.target.value })}
              onBlur={flush}
              className="block min-h-40 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none field-sizing-content placeholder:text-muted-foreground"
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('agents.model')}>
          <SettingsCard>
            <SettingsMenuSelectRow
              label={t('agents.provider')}
              value={draft.provider}
              options={providers}
              disabled={!canEdit}
              onValueChange={(next) => next !== draft.provider && update({ provider: next, model: null })}
            />
            <SettingsMenuSelectRow
              label={t('agents.model')}
              value={draft.model ?? ''}
              options={[{ value: '', label: t('agents.defaultModel') }, ...models]}
              disabled={!canEdit}
              onValueChange={(next) => update({ model: next || null })}
            />
            <SettingsMenuSelectRow
              label={t('agents.thinking')}
              value={draft.thinkingLevel}
              options={THINKING_LEVELS.map((level) => ({ value: level.id, label: t(level.nameKey) }))}
              disabled={!canEdit}
              onValueChange={(next) => update({ thinkingLevel: next as AgentDraft['thinkingLevel'] })}
            />
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {t(hasConnection ? 'agents.runsOn' : 'agents.runsOnNone', { provider })}
            </p>
          </SettingsCard>
        </SettingsSection>

        <AgentChecklist
          title={t('agents.skills')}
          description={canUse(draft.skills, skillItems, 'agents.canUseAllSkills', 'agents.canUseSomeSkills')}
          allLabel={t('agents.allSkills')}
          emptyLabel={t('agents.noSkills')}
          items={skillItems}
          selected={draft.skills}
          disabled={!canEdit}
          onChange={(next) => update({ skills: next })}
        />
        <AgentChecklist
          title={t('agents.sources')}
          description={canUse(draft.sources, sourceItems, 'agents.canUseAllSources', 'agents.canUseSomeSources')}
          allLabel={t('agents.allSources')}
          emptyLabel={t('agents.noSources')}
          items={sourceItems}
          selected={draft.sources}
          disabled={!canEdit}
          onChange={(next) => update({ sources: next })}
        />

        <SettingsSection title={t('agents.computer')}>
          <SettingsCard>
            <SettingsRow icon={<Monitor />} label={t('agents.computerNotSetUp')} />
          </SettingsCard>
        </SettingsSection>
      </Info_Page.Content>
      {deleteDialog}
    </Info_Page>
  )
}
