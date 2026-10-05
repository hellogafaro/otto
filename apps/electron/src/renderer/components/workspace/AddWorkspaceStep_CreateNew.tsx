import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { slugify } from "@/lib/slugify"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings"
import { StepFormLayout, BackButton, ContinueButton } from "../onboarding/primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"

type LocationOption = 'default' | 'custom'

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default (~/.craft-agent/workspaces/) or Custom
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating
}: AddWorkspaceStep_CreateNewProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [locationOption, setLocationOption] = useState<LocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Get home directory on mount
  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : null
  const finalPath = locationOption === 'default'
    ? (defaultBasePath && slug ? `${defaultBasePath}/${slug}` : null)
    : customPath && slug
      ? `${customPath}/${slug}`
      : null

  // Validate slug uniqueness when name changes
  useEffect(() => {
    if (!slug) {
      setError(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
      } finally {
        setIsValidating(false)
      }
    }

    // Debounce validation
    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug])

  const handleFolderSelected = useCallback((path: string) => {
    setCustomPath(path)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error) return
    await onCreate(finalPath, name.trim())
  }, [name, finalPath, error, onCreate])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating

  return (
    <StepFormLayout
      title={t("workspace.createWorkspace")}
      description={t("workspace.createWorkspaceDesc")}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isCreating}>{t("common.back")}</BackButton>
          <ContinueButton onClick={handleCreate} disabled={!canCreate} loading={isCreating}>
            {t("common.create")}
          </ContinueButton>
        </>
      }
    >
      <div className="space-y-5">
        {/* Workspace name */}
        <div className="space-y-3">
          <SettingsCard>
            <SettingsRow label={<Label htmlFor="workspace-name">{t("workspace.nameLabel")}</Label>}>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspace.myWorkspace")}
                disabled={isCreating}
                aria-invalid={!!error || undefined}
                autoFocus
                className="w-60"
              />
            </SettingsRow>
          </SettingsCard>
          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
        </div>

        {/* Location selection */}
        <SettingsSection title={t("workspace.locationLabel")}>
          <SettingsCard>
            {/* Default location option */}
            <AddWorkspace_RadioOption
              name="location"
              checked={locationOption === 'default'}
              onChange={() => setLocationOption('default')}
              disabled={isCreating}
              title={t("workspace.defaultLocation")}
              subtitle={t("workspace.underDefaultFolder")}
            />

            {/* Custom location option */}
            <AddWorkspace_RadioOption
              name="location"
              checked={locationOption === 'custom'}
              onChange={() => setLocationOption('custom')}
              disabled={isCreating}
              title={t("workspace.chooseLocation")}
              subtitle={customPath || t("workspace.pickLocation")}
              action={locationOption === 'custom' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    pickDirectory()
                  }}
                  disabled={isCreating}
                >
                  {t("common.browse")}
                </Button>
              ) : undefined}
            />
          </SettingsCard>
        </SettingsSection>
      </div>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </StepFormLayout>
  )
}
