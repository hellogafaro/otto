/**
 * Settings Pages
 *
 * All pages that appear under the settings navigator.
 */

export { default as SettingsNavigator } from './settings-navigator'
export { default as AppSettingsPage, meta as AppSettingsMeta } from './app-settings-page'
export { default as AiSettingsPage, meta as AiSettingsMeta } from './ai-settings-page'
export { default as AppearanceSettingsPage, meta as AppearanceMeta } from './appearance-settings-page'
export { default as InputSettingsPage, meta as InputMeta } from './input-settings-page'
export { default as WorkspaceSettingsPage, meta as WorkspaceSettingsMeta } from './workspace-settings-page'
export { default as PermissionsSettingsPage, meta as PermissionsMeta } from './permissions-settings-page'
export { default as LabelsSettingsPage, meta as LabelsMeta } from './labels-settings-page'
export { default as ShortcutsPage, meta as ShortcutsMeta } from './shortcuts-page'
export { default as PreferencesPage, meta as PreferencesMeta } from './preferences-page'

// Re-export types
export type { DetailsPageMeta } from '@/lib/navigation-registry'
