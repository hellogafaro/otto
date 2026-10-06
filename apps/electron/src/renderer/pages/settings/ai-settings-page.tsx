/**
 * AiSettingsPage: Settings -> AI. The connections the person can use, and the defaults over them.
 *
 * Connections: one list, the person's own first (a personal Claude subscription or key powers their agents and is
 * seen by nobody else), then the workspace's and the server's, each with whose it is. The "+" opens the setup (the
 * same full-screen flow as the first run): a Claude subscription, an Anthropic API key, ChatGPT, another provider's
 * key or a custom endpoint. A row's ⋯ sets the person's default, signs in again, changes the key, tests and deletes
 * (asked first); its editor saves as it is edited. Defaults: the person's default connection and the thinking level.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, AlertTriangle } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { toast } from '@workspace/ui/components/sonner'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import { CreateButton } from '@/components/ui/create-button'
import { Kbd } from '@/components/ui/kbd'
import { SettingsPage } from '@/components/settings/settings-page'
import { SettingsSection, SettingsCard, SettingsRow, SettingsMenuSelectRow } from '@/components/settings'
import { OnboardingWizard } from '@/components/onboarding'
import type { DeviceCodeProvider } from '@/components/onboarding/device-code-step'
import { useAppShellContext } from '@/context/app-shell-context'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { useWorkspaceMemberList } from '@/hooks/use-workspace-members'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@otto/shared/agent/thinking-levels'
import { CLAUDE_CODE_CONNECTION_TYPE } from '@config/llm-connections'
import type { CredentialHealthIssue, LlmConnectionWithStatus, ThinkingLevel, Workspace } from '../../../shared/types'
import { ChangeKeyDialog } from './change-key-dialog'
import { canEditConnection, connectionKindLabel, scopeLabel, sortConnections } from './connection-labels'
import { ConnectionRow } from './connection-row'
import { DecisionModelSection } from './decision-model-section'
import { WorkspaceOverrideCard } from './workspace-override-card'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

/** The accounts that sign in with a device code. */
const DEVICE_CODE_PROVIDERS: Record<string, DeviceCodeProvider> = { 'openai-codex': 'chatgpt', 'github-copilot': 'copilot' }

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
      return issue.message || t('settings.ai.credentialIssue')
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

/** What the setup overlay is doing: adding a connection, or signing one in again. */
type Setup = { reauth?: { slug: string; provider: DeviceCodeProvider } }

export default function AiSettingsPage() {
  const { t } = useTranslation()
  const { llmConnections, refreshLlmConnections, activeWorkspaceId } = useAppShellContext()
  const { items: members } = useWorkspaceMemberList()
  const isOwner = members.some((member) => member.me && member.role === 'owner')
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const { confirmDelete, dialog: deleteDialog } = useConfirmDelete()

  const [setup, setSetup] = useState<Setup | null>(null)
  const [changingKey, setChangingKey] = useState<LlmConnectionWithStatus | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

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

  const openSetup = useCallback((next: Setup) => {
    setSetup(next)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeSetup = useCallback(() => {
    setSetup(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  // Escape closes the setup
  useEffect(() => {
    if (!setup) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSetup()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setup, closeSetup])

  const existingSlugs = useMemo(() => new Set(llmConnections.map((connection) => connection.slug)), [llmConnections])
  const rows = useMemo(() => sortConnections(llmConnections), [llmConnections])
  const defaultConnection = llmConnections.find((connection) => connection.isDefault)

  const refresh = () => void refreshLlmConnections()

  const setDefault = async (slug: string) => {
    const result = await window.electronAPI.setDefaultLlmConnection(slug)
    if (result.success) {
      toast.success(t('common.saved'), { id: 'saved' })
      refresh()
    } else toast.error(result.error ?? t('connections.saveFailed'), { id: 'saved' })
  }

  const test = async (connection: LlmConnectionWithStatus) => {
    const result = await window.electronAPI.testLlmConnection(connection.slug)
    if (result.success) toast.success(t('connections.testPassed', { name: connection.name }))
    else toast.error(result.error || t('settings.ai.validationFailed'))
  }

  const remove = (connection: LlmConnectionWithStatus) =>
    confirmDelete(t('connections.deleteTitle', { name: connection.name }), async () => {
      const result = await window.electronAPI.deleteLlmConnection(connection.slug)
      if (!result.success) throw new Error(result.error)
      refresh()
      toast.success(t('connections.deleted', { name: connection.name }))
    })

  /** What fixes a connection that is signed out or whose key is wrong: signing in again, or a new key. */
  const reconnect = (connection: LlmConnectionWithStatus | undefined) => {
    const provider = connection ? DEVICE_CODE_PROVIDERS[connection.type] : undefined
    if (connection && provider) openSetup({ reauth: { slug: connection.slug, provider } })
    else if (connection && connection.authType !== 'cli_login' && connection.authType !== 'none') setChangingKey(connection)
    else openSetup({})
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
              value={defaultConnection?.slug ?? ''}
              onValueChange={(slug) => slug !== defaultConnection?.slug && void setDefault(slug)}
              options={rows.map((connection) => ({
                value: connection.slug,
                label: connection.name,
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

      <SettingsSection
        title={t('settings.ai.connections')}
        description={t('settings.ai.connectionsDesc')}
        action={<CreateButton label={t('connections.new')} onClick={() => openSetup({})} />}
      >
        <SettingsCard>
          {rows.length === 0 ? (
            <SettingsRow label={<span className="font-normal text-muted-foreground">{t('settings.ai.noConnections')}</span>} />
          ) : (
            rows.map((connection) => {
              const editable = canEditConnection(connection, isOwner)
              const provider = DEVICE_CODE_PROVIDERS[connection.type]
              return (
                <ConnectionRow
                  key={`${connection.scope}:${connection.slug}`}
                  connection={connection}
                  editable={editable}
                  onSaved={refresh}
                  actions={{
                    onSetDefault: connection.isDefault ? undefined : () => void setDefault(connection.slug),
                    onSignIn: editable && provider ? () => openSetup({ reauth: { slug: connection.slug, provider } }) : undefined,
                    onChangeKey: editable && hasKey(connection) ? () => setChangingKey(connection) : undefined,
                    onTest: () => void test(connection),
                    onDelete: editable ? () => remove(connection) : undefined,
                  }}
                />
              )
            })
          )}
        </SettingsCard>
      </SettingsSection>

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

      {setup && createPortal(
        <div role="dialog" aria-modal className="fixed inset-0 bg-background" style={{ zIndex: 'var(--z-fullscreen, 350)' }}>
          <OnboardingWizard
            existingSlugs={existingSlugs}
            canShare={isOwner}
            reauth={setup.reauth}
            onSaved={refresh}
            onFinish={() => { closeSetup(); setCredentialHealthIssues([]) }}
            onBack={closeSetup}
            className="h-full"
          />
          {/* Same close as the dialogs: a solid 32px icon button, 16px from the corner */}
          <div className="fixed top-4 right-4 [-webkit-app-region:no-drag]" style={{ zIndex: 'var(--z-fullscreen, 350)' }}>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="secondary" size="icon" onClick={closeSetup} aria-label={t('common.close')}>
                    <X />
                  </Button>
                )}
              />
              <TooltipContent side="bottom">
                {t('common.close')}
                <Kbd>Esc</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>,
        document.body,
      )}

      <ChangeKeyDialog connection={changingKey} onOpenChange={(open) => !open && setChangingKey(null)} onSaved={refresh} />
      {deleteDialog}
    </SettingsPage>
  )
}
