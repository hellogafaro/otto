import { useTranslation } from "react-i18next"
import { FolderPlus, FolderOpen, Cloud, ChevronRight } from "lucide-react"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout } from "../onboarding/primitives"

interface AddWorkspaceStep_ChoiceProps {
  onCreateNew: () => void
  onOpenFolder: () => void
  onConnectRemote: () => void
}

/**
 * AddWorkspaceStep_Choice - Initial step to choose creation method
 *
 * Three options:
 * 1. Create new workspace - Creates a fresh workspace folder
 * 2. Open folder as workspace - Use an existing folder
 * 3. Connect to a remote server
 */
export function AddWorkspaceStep_Choice({
  onCreateNew,
  onOpenFolder,
  onConnectRemote,
}: AddWorkspaceStep_ChoiceProps) {
  const { t } = useTranslation()
  return (
    <StepFormLayout
      title={t("workspace.addWorkspace")}
      description={t("workspace.addWorkspaceDesc")}
    >
      <SettingsCard>
        <SettingsRow
          icon={<FolderPlus />}
          label={t("workspace.createNew")}
          description={t("workspace.createNewDesc")}
          onClick={onCreateNew}
        >
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </SettingsRow>
        <SettingsRow
          icon={<FolderOpen />}
          label={t("workspace.openFolder")}
          description={t("workspace.openFolderDesc")}
          onClick={onOpenFolder}
        >
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </SettingsRow>
        <SettingsRow
          icon={<Cloud />}
          label={t("workspace.connectRemote")}
          description={t("workspace.connectRemoteDesc")}
          onClick={onConnectRemote}
        >
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </SettingsRow>
      </SettingsCard>
    </StepFormLayout>
  )
}
