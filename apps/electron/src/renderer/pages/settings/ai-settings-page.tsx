import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { toast } from '@workspace/ui/components/sonner'
import { CreateButton } from '@/components/ui/create-button'
import { SettingsPage } from '@/components/settings/settings-page'
import { SettingsSection, SettingsCard, SettingsRow, SettingsMenuSelectRow } from '@/components/settings'
import { useAppShellContext } from '@/context/app-shell-context'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { useWorkspaceMemberList } from '@/hooks/use-workspace-members'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@otto/shared/agent/thinking-levels'
import type { CredentialHealthIssue, LlmConnectionWithStatus, ThinkingLevel, Workspace } from '../../../shared/types'
import { ChangeKeyDialog } from './change-key-dialog'
import { canEditConnection, connectionKindLabel, groupConnections, scopeLabel, sortConnections } from './connection-labels'
import { ConnectionRow } from './connection-row'
import { DecisionModelSection } from './decision-model-section'
import { WorkspaceOverrideCard } from './workspace-override-card'
import { ProviderConnectionDialog } from './provider-connection-dialog'
import { connectionChoiceId, connectionSelector } from './provider-connection-form'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

/** Get user-friendly message for credential health issue */
function getHealthIssueMessage(issue: CredentialHealthIssue, t: (key: string) => string): string {
  switch (issue.type) {
    case 'file_corrupted':
      return t('settings.ai.credentialCorrupted')
    case 'decryption_failed':
      return t('settings.ai.credentialOtherMachine')
    case 'no_default_credentials':
      return t('settings.ai.credentialNotFound')
    default:
      return t('settings.ai.credentialIssue')
  }
}

function CredentialHealthBanner({ issues, onReauthenticate }: { issues: CredentialHealthIssue[]; onReauthenticate: () => void }) {
  const { t } = useTranslation()
  if (issues.length === 0) return null

  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">{t('settings.ai.credentialIssue')}</h4>
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-300/80">{getHealthIssueMessage(issues[0]!, t)}</p>
        </div>
        <Button variant="outline" size="compact" onClick={onReauthenticate} className="shrink-0 border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">
          {t('settings.ai.reAuthenticate')}
        </Button>
      </div>
    </div>
  )
}

export default function AiSettingsPage() {
  const { t } = useTranslation()
  const { llmConnections, refreshLlmConnections, activeWorkspaceId } = useAppShellContext()
  const { items: members } = useWorkspaceMemberList()
  const isOwner = members.some((member) => member.me && member.role === 'owner')
  const { confirmDelete, dialog: deleteDialog } = useConfirmDelete()

  const [setupScope, setSetupScope] = useState<'user' | 'workspace' | null>(null)
  const [changingKey, setChangingKey] = useState<LlmConnectionWithStatus | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

  useEffect(() => {
    setSetupScope(null)
    setChangingKey(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!isOwner && setupScope === 'workspace') setSetupScope(null)
    if (changingKey && !canEditConnection(changingKey, isOwner)) setChangingKey(null)
  }, [isOwner, setupScope, changingKey])

  useEffect(() => {
    const load = async () => {
      try {
        setWorkspaces(await window.electronAPI.getWorkspaces())
        setDefaultThinking(await window.electronAPI.getDefaultThinkingLevel())
        // Check credential health for potential issues (corruption, machine migration)
        const health = await window.electronAPI.getCredentialHealth()
        if (!health.healthy) setCredentialHealthIssues(health.issues)
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    void load()
  }, [activeWorkspaceId])

  const existingSlugs = useMemo(() => new Set(llmConnections.map((connection) => connection.slug)), [llmConnections])
  const rows = useMemo(() => sortConnections(llmConnections), [llmConnections])
  const groups = useMemo(() => groupConnections(llmConnections), [llmConnections])
  const defaultConnection = llmConnections.find((connection) => connection.isDefault)

  const refresh = () => void refreshLlmConnections()

  const setDefault = async (connection: LlmConnectionWithStatus) => {
    const result = await window.electronAPI.setDefaultLlmConnection(connectionSelector(connection))
    if (result.success) {
      toast.success(t('common.saved'), { id: 'saved' })
      refresh()
    } else toast.error(result.error ?? t('connections.saveFailed'), { id: 'saved' })
  }

  const remove = (connection: LlmConnectionWithStatus) =>
    confirmDelete(t('connections.deleteTitle', { name: connection.name }), async () => {
      const result = await window.electronAPI.deleteLlmConnection(connectionSelector(connection))
      if (!result.success) throw new Error(result.error)
      refresh()
      toast.success(t('connections.deleted', { name: connection.name }))
    })

  const reconnect = (connection: LlmConnectionWithStatus | undefined) => {
    if (connection && canEditConnection(connection, isOwner) && connection.runtimeSupported !== false && connection.authType === 'api_key') setChangingKey(connection)
    else setSetupScope('user')
  }

  const changeThinking = async (level: ThinkingLevel) => {
    const previous = defaultThinking
    setDefaultThinking(level)
    try {
      const result = await window.electronAPI.setDefaultThinkingLevel(level)
      if (!result.success) throw new Error(result.error)
      toast.success(t('common.saved'), { id: 'saved' })
    } catch (error) {
      console.error('Failed to set default thinking level:', error)
      setDefaultThinking(previous)
      toast.error(t('connections.saveFailed'), { id: 'saved' })
    }
  }

  const hasKey = (connection: LlmConnectionWithStatus) => connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token'

  return (
    <SettingsPage subpage="ai">
      <CredentialHealthBanner issues={credentialHealthIssues} onReauthenticate={() => { reconnect(defaultConnection); setCredentialHealthIssues([]) }} />

      {llmConnections.length > 0 && (
        <SettingsSection title={t('settings.ai.defaultSection')} description={t('settings.ai.defaultSectionDesc')}>
          <SettingsCard>
            <SettingsMenuSelectRow
              label={t('settings.ai.connection')}
              description={t('settings.ai.connectionDesc')}
              value={defaultConnection ? connectionChoiceId(defaultConnection) : ''}
              onValueChange={(id) => { const connection = rows.find((row) => connectionChoiceId(row) === id); if (connection && !connection.isDefault) void setDefault(connection) }}
              options={rows.filter((connection) => connection.id).map((connection) => ({
                value: connectionChoiceId(connection),
                label: `${connection.name} · ${scopeLabel(connection.scope, t)}`,
                description: `${connectionKindLabel(connection, t)} · ${scopeLabel(connection.scope, t)}`,
              }))}
            />
            <SettingsMenuSelectRow
              label={t('settings.ai.thinking')}
              description={t('settings.ai.thinkingDesc')}
              value={defaultThinking}
              onValueChange={(level) => void changeThinking(level as ThinkingLevel)}
              options={THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({ value: id, label: t(nameKey), description: t(descriptionKey) }))}
            />
          </SettingsCard>
        </SettingsSection>
      )}

      {(['user', 'shared'] as const).map((group) => (
      <SettingsSection
        key={group}
        title={group === 'user' ? t('settings.ai.yourConnections', { defaultValue: 'Your connections' }) : t('settings.ai.sharedConnections', { defaultValue: 'Workspace connections' })}
        action={group === 'user' || (isOwner && activeWorkspaceId) ? <CreateButton label={t('connections.new')} onClick={() => setSetupScope(group === 'user' ? 'user' : 'workspace')} /> : undefined}
      >
        <SettingsCard>
          {groups[group].length === 0 ? (
            <SettingsRow label={<span className="font-normal text-muted-foreground">{t('settings.ai.noConnections')}</span>} />
          ) : (
            groups[group].map((connection) => {
              const editable = !!connection.id && canEditConnection(connection, isOwner)
              return (
                <ConnectionRow
                  key={`${connection.scope}:${connection.slug}`}
                  connection={connection}
                  editable={editable && connection.runtimeSupported !== false}
                  onSaved={refresh}
                  actions={{
                    onSetDefault: !connection.id || connection.isDefault || connection.runtimeSupported === false ? undefined : () => void setDefault(connection),
                    onChangeKey: editable && hasKey(connection) && connection.runtimeSupported !== false ? () => setChangingKey(connection) : undefined,
                    onTest: !connection.id || connection.runtimeSupported === false ? undefined : () => window.electronAPI.testLlmConnection(connectionSelector(connection)),
                    onDelete: editable ? () => remove(connection) : undefined,
                  }}
                />
              )
            })
          )}
        </SettingsCard>
      </SettingsSection>
      ))}

      {workspaces.length > 0 && llmConnections.length > 0 && (
        <SettingsSection title={t('settings.ai.workspaceOverrides')} description={t('settings.ai.workspaceOverridesDesc')}>
          <div className="space-y-2">
            {workspaces.map((workspace) => (
              <WorkspaceOverrideCard key={workspace.id} workspace={workspace} llmConnections={llmConnections} onSettingsChange={refresh} />
            ))}
          </div>
        </SettingsSection>
      )}

      <DecisionModelSection llmConnections={llmConnections} />

      <ProviderConnectionDialog scope={setupScope} workspaceId={activeWorkspaceId ?? undefined} existingSlugs={existingSlugs} onClose={() => setSetupScope(null)} onSaved={() => { refresh(); setCredentialHealthIssues([]) }} />

      <ChangeKeyDialog connection={changingKey} onOpenChange={(open) => !open && setChangingKey(null)} onSaved={refresh} />
      {deleteDialog}
    </SettingsPage>
  )
}
