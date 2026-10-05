// Re-export everything for convenient imports
export { ActionRegistryProvider, useActionRegistry } from './registry'
export { useAction } from './use-action'
export { useHotkeyLabel, useActionLabel } from './use-hotkey-label'
export { actions, actionList, actionsByCategory, type ActionId } from './definitions'
export type { ActionDefinition, ActionHandler, ActionScope } from './types'
