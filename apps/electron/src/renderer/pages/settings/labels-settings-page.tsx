/**
 * LabelsSettingsPage
 *
 * Displays workspace label configuration in two data tables:
 * 1. Label Hierarchy - tree table with expand/collapse showing all labels
 * 2. Auto-Apply Rules - flat table showing all regex rules across labels
 *
 * Each section has an Edit button that prefills the composer for AI-assisted editing
 * (the agent uses the labels_edit tool; labels live in the database).
 *
 * Data is loaded via the useLabels hook which reloads on live changes.
 */

import { SettingsPage } from '@/components/settings/settings-page'
import { useTranslation } from 'react-i18next'
import { AgentEditButton } from '@/components/ui/agent-edit-button'
import { Spinner } from '@otto/ui'
import { useAppShellContext } from '@/context/app-shell-context'
import { useLabels } from '@/hooks/use-labels'
import {
  LabelsDataTable,
  AutoRulesDataTable,
} from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'labels',
}

export default function LabelsSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { labels, isLoading } = useLabels(activeWorkspaceId)

  return (
    <SettingsPage subpage="labels">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="text-lg text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* About Section */}
                  <SettingsSection title={t("settings.labels.aboutLabels")}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>
                          {t("settings.labels.aboutText1")}
                        </p>
                        <p>
                          {t("settings.labels.aboutText2")}
                        </p>
                        <p>
                          {t("settings.labels.aboutText3")}
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Label Hierarchy Section */}
                  <SettingsSection
                    title={t("settings.labels.labelHierarchy")}
                    description={t("settings.labels.labelHierarchyDesc")}
                    action={<AgentEditButton prompt={t("agentEdit.labels")} />}
                  >
                    <SettingsCard className="p-0">
                      {labels.length > 0 ? (
                        <LabelsDataTable
                          data={labels}
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={t("settings.labels.labelHierarchy")}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t("settings.labels.noLabels")}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t("settings.labels.noLabelsDesc")}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Auto-Apply Rules Section */}
                  <SettingsSection
                    title={t("settings.labels.autoApplyRules")}
                    description={t("settings.labels.autoApplyRulesDesc")}
                    action={<AgentEditButton prompt={t("agentEdit.autoRules")} />}
                  >
                    <SettingsCard className="p-0">
                      <AutoRulesDataTable
                        data={labels}
                        maxHeight={350}
                        fullscreen
                        fullscreenTitle={t("settings.labels.autoApplyRules")}
                      />
                    </SettingsCard>
                  </SettingsSection>
                </>
              )}
    </SettingsPage>
  )
}
