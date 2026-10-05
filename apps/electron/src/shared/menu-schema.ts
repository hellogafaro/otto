/**
 * Shared Menu Schema
 *
 * Defines the native (macOS) application menu sections consumed by the main
 * process (`main/menu.ts`, which transforms them to Electron
 * MenuItemConstructorOptions) and the settings page list consumed by
 * `SettingsNavigator`.
 *
 * NOTE: All labels are i18n keys (e.g., "menu.edit"), NOT resolved strings.
 * Consumers must call i18n.t(item.labelKey) at build time.
 */

import { FEATURE_FLAGS } from '@otto/shared/feature-flags'
import { SETTINGS_PAGES, type SettingsSubpage } from './settings-registry'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Menu item that sends `ipcChannel` to the focused renderer window. */
export interface MenuItemAction {
  type: 'action'
  labelKey: string              // i18n key
  shortcut: string              // Electron accelerator: 'CmdOrCtrl+N'
  ipcChannel: string
}

/** Menu item handled by an Electron built-in role ('undo', 'copy', ...). */
export interface MenuItemRole {
  type: 'role'
  role: string
}

export interface MenuItemSeparator {
  type: 'separator'
}

export type MenuItem = MenuItemAction | MenuItemRole | MenuItemSeparator

export interface MenuSection {
  labelKey: string              // i18n key
  items: MenuItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const EDIT_MENU: MenuSection = {
  labelKey: 'menu.edit',
  items: [
    { type: 'role', role: 'undo' },
    { type: 'role', role: 'redo' },
    { type: 'separator' },
    { type: 'role', role: 'cut' },
    { type: 'role', role: 'copy' },
    { type: 'role', role: 'paste' },
    { type: 'separator' },
    { type: 'role', role: 'selectAll' },
  ],
}

export const VIEW_MENU: MenuSection = {
  labelKey: 'menu.view',
  items: [
    { type: 'role', role: 'zoomIn' },
    { type: 'role', role: 'zoomOut' },
    { type: 'role', role: 'resetZoom' },
  ],
}

export const WINDOW_MENU: MenuSection = {
  labelKey: 'menu.window',
  items: [
    { type: 'role', role: 'minimize' },
    { type: 'role', role: 'zoom' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings pages
// ─────────────────────────────────────────────────────────────────────────────

/** A settings page entry for SettingsNavigator (sidebar panel). */
export interface SettingsMenuItem {
  id: SettingsSubpage
  labelKey: string    // i18n key - resolve with t() at render time
}

/**
 * All settings pages - derived from settings-registry (single source of truth)
 * Order is determined by SETTINGS_PAGES in settings-registry.ts
 */
export const SETTINGS_ITEMS: SettingsMenuItem[] = SETTINGS_PAGES
  .filter(page => page.id !== 'server' || FEATURE_FLAGS.embeddedServer)
  .map(page => ({ id: page.id, labelKey: page.labelKey }))
