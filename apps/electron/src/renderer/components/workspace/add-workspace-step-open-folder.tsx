import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout, BackButton, ContinueButton } from "../onboarding/primitives"
import { useDirectoryPicker } from "@/hooks/use-directory-picker"
import { ServerDirectoryBrowser } from "@/components/server-directory-browser"

interface AddWorkspaceStep_OpenFolderProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_OpenFolder - Open an existing folder as workspace
 */
export function AddWorkspaceStep_OpenFolder({
  onBack,
  onCreate,
  isCreating
}: AddWorkspaceStep_OpenFolderProps) {
  const { t } = useTranslation()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')

  const handleFolderSelected = useCallback((path: string) => {
    setSelectedPath(path)
    // Extract folder name for workspace name
    const folderName = path.split(/[\\/]/).pop() || path
    setWorkspaceName(folderName)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleOpen = useCallback(async () => {
    if (!selectedPath || !workspaceName.trim()) return
    await onCreate(selectedPath, workspaceName.trim())
  }, [selectedPath, workspaceName, onCreate])

  const canOpen = selectedPath && workspaceName.trim()

  return (
    <StepFormLayout
      title={t("workspace.chooseExistingFolder")}
      description={t("workspace.chooseExistingFolderDesc")}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isCreating}>{t("common.back")}</BackButton>
          <ContinueButton
            onClick={handleOpen}
            disabled={!canOpen || isCreating}
            loading={isCreating}
          >
            {t("common.open")}
          </ContinueButton>
        </>
      }
    >
      <SettingsCard>
        {/* Browse folder row */}
        <SettingsRow
          label={
            selectedPath ? (
              <span className="block truncate">{selectedPath}</span>
            ) : (
              <span className="block truncate font-normal text-muted-foreground">{t("workspace.noFolderSelected")}</span>
            )
          }
          action={
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={pickDirectory}
              disabled={isCreating}
            >
              {t("common.browse")}
            </Button>
          }
        />

        {/* Workspace name input - shown after folder is selected */}
        {selectedPath && (
          <SettingsRow label={<Label htmlFor="workspace-name">{t("workspace.nameLabel")}</Label>}>
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder={t("workspace.myWorkspace")}
              disabled={isCreating}
              className="w-60"
            />
          </SettingsRow>
        )}
      </SettingsCard>

      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </StepFormLayout>
  )
}
