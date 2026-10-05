/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback } from 'react'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Auto-update state (Check Now / Update Ready only shown in Electron, not WebUI)
  const isElectron = window.electronAPI.getRuntimeEnvironment() === 'electron'
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [notificationsOn, keepAwakeOn] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <SettingsPageHeader subpage="app" />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Notifications */}
              <SettingsSection title={t("settings.notifications.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.notifications.desktopNotifications")}
                    description={t("settings.notifications.desktopNotificationsDesc")}
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title={t("settings.power.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.power.keepScreenAwake")}
                    description={t("settings.power.keepScreenAwakeDesc")}
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title={t("settings.about.title")}>
                <SettingsCard>
                  <SettingsRow label={t("settings.about.version")}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {updateChecker.updateInfo?.currentVersion ?? <Spinner />}
                      </span>
                      {isElectron && updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Spinner className="w-3 h-3" />
                          <span>{t("settings.about.downloading", { version: updateChecker.updateInfo.latestVersion, percent: updateChecker.downloadProgress })}</span>
                        </div>
                      )}
                    </div>
                  </SettingsRow>
                  {isElectron && (
                    <SettingsRow label={t("settings.about.checkForUpdates")}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCheckForUpdates}
                        disabled={isCheckingForUpdates}
                      >
                        {isCheckingForUpdates ? (
                          <Spinner />
                        ) : (
                          t("settings.about.checkNow")
                        )}
                      </Button>
                    </SettingsRow>
                  )}
                  {isElectron && updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                    <SettingsRow label={t("settings.about.updateReady")}>
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        {t("settings.about.restartToUpdate", { version: updateChecker.updateInfo.latestVersion })}
                      </Button>
                    </SettingsRow>
                  )}
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
