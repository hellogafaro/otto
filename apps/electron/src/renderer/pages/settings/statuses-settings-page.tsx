/**
 * StatusesSettingsPage
 *
 * The workspace's statuses, read-only: icon, name and whether the status shows in the inbox (open) or the
 * archive (closed). Statuses live in the database; Edit prefills the composer and the agent changes them with
 * the `otto statuses` commands. Reloads on `domain:changed` (useStatuses).
 */

import { useTranslation } from 'react-i18next'
import { Badge } from '@workspace/ui/components/badge'
import { Spinner } from '@otto/ui'
import { SettingsPage } from '@/components/settings/settings-page'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import { AgentEditButton } from '@/components/ui/agent-edit-button'
import { useAppShellContext } from '@/context/app-shell-context'
import { useTheme } from '@/context/theme-context'
import { statusConfigToSessionStatus } from '@/config/session-status-config'
import { useStatuses } from '@/hooks/use-statuses'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'statuses',
}

export default function StatusesSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { isDark } = useTheme()
  const { statuses, isLoading } = useStatuses(activeWorkspaceId)

  return (
    <SettingsPage subpage="statuses">
      {isLoading || !activeWorkspaceId ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      ) : (
        <SettingsSection
          title={t('settings.statuses.statuses')}
          description={t('settings.statuses.statusesDesc')}
          action={<AgentEditButton prompt={t('agentEdit.statuses')} />}
        >
          <SettingsCard className="p-0">
            {statuses.map((status) => {
              const resolved = statusConfigToSessionStatus(status, activeWorkspaceId, isDark)
              return (
                <SettingsRow
                  key={status.id}
                  icon={<span style={resolved.iconColorable ? { color: resolved.resolvedColor } : undefined}>{resolved.icon}</span>}
                  label={status.label}
                >
                  <Badge variant="outline">
                    {t(`settings.statuses.${status.category}`)}
                  </Badge>
                </SettingsRow>
              )
            })}
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
