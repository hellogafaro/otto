/**
 * WorkspaceOverrideCard: Settings -> AI, one workspace's own connection, model and thinking level over the defaults.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from '@workspace/ui/components/sonner'
import { SettingsCard, SettingsRow, SettingsMenuSelectRow } from '@/components/settings'
import { useWorkspaceIcon } from '@/hooks/use-workspace-icon'
import { getModelShortName } from '@config/models'
import { THINKING_LEVELS } from '@otto/shared/agent/thinking-levels'
import type { LlmConnectionWithStatus, ThinkingLevel, WorkspaceSettings, Workspace } from '../../../shared/types'
import { connectionKindLabel, getModelOptionsForConnection, scopeLabel } from './connection-labels'
import { connectionChoiceId, connectionSelector } from './provider-connection-form'

interface WorkspaceOverrideCardProps {
  workspace: Workspace
  llmConnections: LlmConnectionWithStatus[]
  onSettingsChange: () => void
}

const WORKSPACE_SETTING_LABELS: Partial<Record<keyof WorkspaceSettings, string>> = {
  model: 'workspace model override',
  thinkingLevel: 'workspace thinking override',
}

export function WorkspaceOverrideCard({ workspace, llmConnections, onSettingsChange }: WorkspaceOverrideCardProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch workspace icon as data URL (file:// URLs don't work in renderer)
  const iconUrl = useWorkspaceIcon(workspace)

  // Load workspace settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      setIsLoading(true)
      try {
        const ws = await window.electronAPI.getWorkspaceSettings(workspace.id)
        setSettings(ws)
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [workspace.id])

  // Save workspace setting helper (optimistic update with rollback)
  const updateSetting = useCallback(async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    if (!window.electronAPI) return

    const previousValue = settings?.[key]

    // Optimistic UI update for immediate feedback
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)

    try {
      await window.electronAPI.updateWorkspaceSetting(workspace.id, key, value)
      onSettingsChange()
    } catch (error) {
      // Roll back only the changed key
      setSettings(prev => prev ? { ...prev, [key]: previousValue } : prev)

      const message = error instanceof Error ? error.message : 'Unknown error'
      const settingLabel = WORKSPACE_SETTING_LABELS[key] ?? String(key)
      console.error(`Failed to save ${String(key)}:`, error)
      toast.error(t("toast.failedToSaveSetting", { setting: settingLabel }), {
        description: message,
      })
    }
  }, [workspace.id, onSettingsChange, settings, t])

  const handleConnectionChange = useCallback(async (id: string) => {
    const connection = llmConnections.find((row) => connectionChoiceId(row) === id)
    if (id !== 'global' && !connection) return
    try {
      const result = await window.electronAPI.setWorkspaceDefaultLlmConnection(workspace.id, connection ? connectionSelector(connection) : null)
      if (!result.success) throw new Error(result.error)
      setSettings(await window.electronAPI.getWorkspaceSettings(workspace.id))
      onSettingsChange()
    } catch { toast.error(t('connections.saveFailed')) }
  }, [llmConnections, workspace.id, onSettingsChange, t])

  const handleModelChange = useCallback((model: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('model', model === 'global' ? undefined : model)
  }, [updateSetting])

  const handleThinkingChange = useCallback((level: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('thinkingLevel', level === 'global' ? undefined : level as ThinkingLevel)
  }, [updateSetting])

  // Determine if workspace has any overrides
  const hasOverrides = settings && (
    settings.defaultLlmConnectionId ||
    settings.defaultLlmConnection ||
    settings.model ||
    settings.thinkingLevel
  )

  // Get display values
  const currentModel = settings?.model || 'global'
  const currentThinking = settings?.thinkingLevel || 'global'

  // Derive workspace's effective connection (override or default)
  const workspaceEffectiveConnection = useMemo(() => {
    const connSlug = settings?.defaultLlmConnection
    return settings?.defaultLlmConnectionId ? llmConnections.find((row) => row.id === settings.defaultLlmConnectionId) : connSlug ? llmConnections.find(c => c.slug === connSlug && (c.scope === `workspace:${workspace.id}` || c.scope === 'install')) : llmConnections.find(c => c.isDefault)
  }, [settings?.defaultLlmConnectionId, settings?.defaultLlmConnection, llmConnections, workspace.id])
  const currentConnection = settings?.defaultLlmConnectionId ?? (settings?.defaultLlmConnection ? workspaceEffectiveConnection ? connectionChoiceId(workspaceEffectiveConnection) : '' : 'global')

  // Get summary text for collapsed state
  const getSummary = () => {
    if (!hasOverrides) return t("settings.ai.usingDefaults")
    const parts: string[] = []
    if (settings?.defaultLlmConnectionId || settings?.defaultLlmConnection) {
      const conn = workspaceEffectiveConnection
      parts.push(conn?.name ?? settings.defaultLlmConnection ?? settings.defaultLlmConnectionId ?? '')
    }
    if (settings?.model) {
      parts.push(getModelShortName(settings.model))
    }
    if (settings?.thinkingLevel) {
      const level = THINKING_LEVELS.find(l => l.id === settings.thinkingLevel)
      parts.push(level ? t(level.nameKey) : settings.thinkingLevel)
    }
    return parts.join(' · ')
  }

  return (
    <SettingsCard>
      <SettingsRow
        expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        icon={
          iconUrl ? (
            <img src={iconUrl} alt="" data-slot="avatar" className="object-cover" />
          ) : (
            <span data-slot="avatar" className="flex items-center justify-center text-sm font-medium text-muted-foreground">
              {workspace.name?.charAt(0)?.toUpperCase() || 'W'}
            </span>
          )
        }
        label={workspace.name}
        description={isLoading ? undefined : getSummary()}
      />

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-foreground/10">
              <SettingsMenuSelectRow
                label={t("settings.ai.connection")}
                description={t("settings.ai.connectionDesc")}
                value={currentConnection}
                onValueChange={handleConnectionChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...llmConnections.filter((conn) => conn.id && (conn.scope === `workspace:${workspace.id}` || conn.scope === 'install')).map((conn) => ({
                    value: connectionChoiceId(conn),
                    label: `${conn.name} · ${scopeLabel(conn.scope, t)}`,
                    description: connectionKindLabel(conn, t),
                  })),
                ]}
              />
              <SettingsMenuSelectRow
                label={t("settings.ai.model")}
                description={t("settings.ai.modelDesc")}
                value={currentModel}
                onValueChange={handleModelChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...getModelOptionsForConnection(workspaceEffectiveConnection).map(o => ({
                    ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description,
                  })),
                ]}
              />
              <SettingsMenuSelectRow
                label={t("settings.ai.thinking")}
                description={t("settings.ai.thinkingDesc")}
                value={currentThinking}
                onValueChange={handleThinkingChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({
                    value: id,
                    label: t(nameKey),
                    description: t(descriptionKey),
                  })),
                ]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsCard>
  )
}
