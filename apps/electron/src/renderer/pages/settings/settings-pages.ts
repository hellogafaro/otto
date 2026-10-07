/**
 * Settings Page Components Registry
 *
 * Maps settings subpage IDs to their React components.
 * TypeScript enforces that all pages defined in settings-registry have a component here.
 *
 * To add a new settings page:
 * 1. Add to SETTINGS_PAGES in shared/settings-registry.ts
 * 2. Create the page component (e.g., NewSettingsPage.tsx)
 * 3. Add to SETTINGS_PAGE_COMPONENTS below
 * 4. Add icon to SETTINGS_ICONS in components/icons/settings-icons.tsx
 */

import type { ComponentType } from 'react'
import type { SettingsSubpage } from '../../../shared/settings-registry'

import AppSettingsPage from './app-settings-page'
import AiSettingsPage from './ai-settings-page'
import AppearanceSettingsPage from './appearance-settings-page'
import InputSettingsPage from './input-settings-page'
import WorkspaceSettingsPage from './workspace-settings-page'
import MembersSettingsPage from './members-settings-page'
import PermissionsSettingsPage from './permissions-settings-page'
import LabelsSettingsPage from './labels-settings-page'
import StatusesSettingsPage from './statuses-settings-page'
import MessagingSettingsPage from './messaging-settings-page'
import ShortcutsPage from './shortcuts-page'
import PreferencesPage from './preferences-page'

/**
 * Map of settings subpage IDs to their page components.
 * TypeScript will error if a page from SETTINGS_PAGES is missing here.
 */
export const SETTINGS_PAGE_COMPONENTS: Record<SettingsSubpage, ComponentType> = {
  app: AppSettingsPage,
  ai: AiSettingsPage,
  appearance: AppearanceSettingsPage,
  input: InputSettingsPage,
  workspace: WorkspaceSettingsPage,
  members: MembersSettingsPage,
  permissions: PermissionsSettingsPage,
  labels: LabelsSettingsPage,
  statuses: StatusesSettingsPage,
  messaging: MessagingSettingsPage,
  shortcuts: ShortcutsPage,
  preferences: PreferencesPage,
}

/**
 * Get the component for a settings subpage
 */
export function getSettingsPageComponent(subpage: SettingsSubpage): ComponentType {
  return SETTINGS_PAGE_COMPONENTS[subpage]
}
