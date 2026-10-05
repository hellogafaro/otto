/**
 * WorkspacePicker — shown when a thin client connects without a workspace ID.
 * Lists remote server workspaces and allows selection or creation.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Spinner } from '@otto/ui'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { StepFormLayout, ContinueButton } from '../onboarding/primitives'
import type { WorkspaceInfo } from '../../../shared/types'
import { AddWorkspacePage } from './primitives'

interface WorkspacePickerProps {
  onSelectWorkspace: (workspaceId: string) => void
}

export function WorkspacePicker({ onSelectWorkspace }: WorkspacePickerProps) {
  const { t } = useTranslation()
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // Load workspaces from server
  useEffect(() => {
    window.electronAPI.getServerWorkspaces()
      .then(ws => {
        setWorkspaces(ws)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load workspaces')
        setLoading(false)
      })
  }, [])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const ws = await window.electronAPI.createServerWorkspace(newName.trim())
      onSelectWorkspace(ws.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setCreating(false)
    }
  }, [newName, onSelectWorkspace])

  if (loading) {
    return (
      <AddWorkspacePage className="h-dvh">
        <Spinner />
      </AddWorkspacePage>
    )
  }

  return (
    <AddWorkspacePage className="h-dvh">
      <StepFormLayout
        title={t("workspace.selectWorkspace")}
        description={t("workspace.selectWorkspaceDesc")}
        actions={
          <ContinueButton
            variant={workspaces.length > 0 ? 'secondary' : 'default'}
            onClick={handleCreate}
            disabled={!newName.trim()}
            loading={creating}
          >
            {t("workspace.createWorkspace")}
          </ContinueButton>
        }
      >
        <div className="space-y-3">
          {workspaces.length > 0 && (
            <SettingsCard>
              {workspaces.map(ws => (
                <SettingsRow
                  key={ws.id}
                  icon={
                    <WorkspaceAvatar workspaceId={ws.id} workspaceName={ws.name} fallbackClassName="text-sm" />
                  }
                  label={ws.name}
                  description={ws.slug}
                  onClick={() => onSelectWorkspace(ws.id)}
                >
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </SettingsRow>
              ))}
            </SettingsCard>
          )}

          <SettingsCard>
            <SettingsRow label={<Label htmlFor="new-workspace-name">{t("workspace.nameLabel")}</Label>}>
              <Input
                id="new-workspace-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder={t("workspace.newWorkspaceName")}
                className="w-60"
              />
            </SettingsRow>
          </SettingsCard>

          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
        </div>
      </StepFormLayout>
    </AddWorkspacePage>
  )
}
