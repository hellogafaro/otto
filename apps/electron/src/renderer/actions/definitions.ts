import type { ActionDefinition } from './types'

/**
 * ⌘1–⌘9: the Nth item of the sidebar's pinned and recent list. In the browser ⌘/Ctrl+digit
 * switches the browser's own tabs, so there it is Option/Alt+digit.
 */
function jumpTo(n: number) {
  return {
    id: `nav.jumpTo${n}`,
    label: `Open Item ${n}`,
    description: `Open pinned or recent item ${n}`,
    defaultHotkey: `mod+${n}`,
    webHotkey: `alt+${n}`,
    category: 'Navigation',
    when: '!menuOpen',  // not under a dialog, sheet or menu
  } as const
}

export const actions = {
  // ═══════════════════════════════════════════
  // General
  // ═══════════════════════════════════════════
  'app.newChat': {
    id: 'app.newChat',
    label: 'New Chat',
    description: 'Create a new chat session',
    defaultHotkey: 'mod+n',
    category: 'General',
  },
  'app.commandPalette': {
    id: 'app.commandPalette',
    label: 'Search',
    description: 'Open or close the command palette',
    defaultHotkey: 'mod+k',
    category: 'General',
  },
  'app.settings': {
    id: 'app.settings',
    label: 'Settings',
    description: 'Open application settings',
    defaultHotkey: 'mod+,',
    category: 'General',
  },
  'app.toggleTheme': {
    id: 'app.toggleTheme',
    label: 'Toggle Theme',
    description: 'Switch between light and dark mode',
    defaultHotkey: 'mod+shift+a',
    category: 'General',
  },
  'app.keyboardShortcuts': {
    id: 'app.keyboardShortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Show keyboard shortcuts reference',
    defaultHotkey: 'mod+/',
    category: 'General',
  },
  'app.quit': {
    id: 'app.quit',
    label: 'Quit',
    description: 'Quit the application',
    defaultHotkey: 'mod+q',
    category: 'General',
  },

  // ═══════════════════════════════════════════
  // Navigation
  // ═══════════════════════════════════════════
  'nav.jumpTo1': jumpTo(1),
  'nav.jumpTo2': jumpTo(2),
  'nav.jumpTo3': jumpTo(3),
  'nav.jumpTo4': jumpTo(4),
  'nav.jumpTo5': jumpTo(5),
  'nav.jumpTo6': jumpTo(6),
  'nav.jumpTo7': jumpTo(7),
  'nav.jumpTo8': jumpTo(8),
  'nav.jumpTo9': jumpTo(9),
  'nav.home': {
    id: 'nav.home',
    label: 'Open Home',
    description: 'Open Home: what needs you',
    defaultHotkey: 'mod+i',
    // In the browser ⌘/Ctrl+I is the browser's (page info, mail the page).
    webHotkey: 'alt+i',
    category: 'Navigation',
  },
  'nav.nextZone': {
    id: 'nav.nextZone',
    label: 'Focus Next Zone',
    defaultHotkey: 'tab',
    category: 'Navigation',
    when: '!inputFocus',  // Tab should work normally in text inputs
  },
  'nav.goBack': {
    id: 'nav.goBack',
    label: 'Go Back',
    description: 'Navigate to previous session',
    defaultHotkey: 'mod+[',
    category: 'Navigation',
  },
  'nav.goForward': {
    id: 'nav.goForward',
    label: 'Go Forward',
    description: 'Navigate to next session',
    defaultHotkey: 'mod+]',
    category: 'Navigation',
  },
  'nav.goBackAlt': {
    id: 'nav.goBackAlt',
    label: 'Go Back',
    description: 'Navigate to previous session (arrow key)',
    defaultHotkey: 'mod+left',
    category: 'Navigation',
    when: '!inputFocus',  // CMD+Left = cursor to line start in text inputs
  },
  'nav.goForwardAlt': {
    id: 'nav.goForwardAlt',
    label: 'Go Forward',
    description: 'Navigate to next session (arrow key)',
    defaultHotkey: 'mod+right',
    category: 'Navigation',
    when: '!inputFocus',  // CMD+Right = cursor to line end in text inputs
  },

  // ═══════════════════════════════════════════
  // Navigator (scoped — active entity list in middle panel)
  // ═══════════════════════════════════════════
  'navigator.selectAll': {
    id: 'navigator.selectAll',
    label: 'Select All',
    defaultHotkey: 'mod+a',
    category: 'Navigator',
    scope: 'navigator',
    when: 'navigatorFocus',  // CMD+A = select all text when in input
  },
  'navigator.clearSelection': {
    id: 'navigator.clearSelection',
    label: 'Clear Selection',
    defaultHotkey: 'escape',
    category: 'Navigator',
    scope: 'navigator',
    when: 'navigatorFocus',
  },

  // A task's Details: S opens the Status menu, D the due date, P the project (the page binds them while the Details are open).
  'task.changeStatus': {
    id: 'task.changeStatus',
    label: 'Change Task Status',
    defaultHotkey: 's',
    category: 'General',
    when: '!inputFocus && !menuOpen',
  },
  'task.changeDueDate': {
    id: 'task.changeDueDate',
    label: 'Change Task Due Date',
    defaultHotkey: 'd',
    category: 'General',
    when: '!inputFocus && !menuOpen',
  },
  'task.changeProject': {
    id: 'task.changeProject',
    label: 'Change Task Project',
    defaultHotkey: 'p',
    category: 'General',
    when: '!inputFocus && !menuOpen',
  },

  // ═══════════════════════════════════════════
  // Chat
  // ═══════════════════════════════════════════
  'chat.stopProcessing': {
    id: 'chat.stopProcessing',
    label: 'Stop Processing',
    description: 'Cancel the current agent task (double-press)',
    defaultHotkey: 'escape',
    category: 'Chat',
    scope: 'chat',
    when: '!hasSelection',  // Let browser clear selection first; overlays handled by hasOpenOverlay() in enabled callback
  },
  'chat.cyclePermissionMode': {
    id: 'chat.cyclePermissionMode',
    label: 'Cycle Permission Mode',
    description: 'Switch between Explore, Ask, and Execute modes',
    defaultHotkey: 'shift+tab',
    category: 'Chat',
  },
  'chat.nextSearchMatch': {
    id: 'chat.nextSearchMatch',
    label: 'Next Search Match',
    defaultHotkey: 'mod+g',
    category: 'Chat',
  },
  'chat.prevSearchMatch': {
    id: 'chat.prevSearchMatch',
    label: 'Previous Search Match',
    defaultHotkey: 'mod+shift+g',
    category: 'Chat',
  },
  // The shell composer (every page; the full one on the chat, the new chat and Home).
  'composer.focus': {
    id: 'composer.focus',
    label: 'Focus Composer',
    defaultHotkey: 'mod+j',
    category: 'Chat',
  },

} as const satisfies Record<string, ActionDefinition>

/** The hotkey an action has here: the browser's own when it defines one, else the default. */
export function hotkeyFor(action: ActionDefinition, webui: boolean): string | null {
  return webui && action.webHotkey ? action.webHotkey : action.defaultHotkey
}

// Type-safe action IDs
export type ActionId = keyof typeof actions

/** `nav.jumpTo1` … `nav.jumpTo9`: the action for jump number n is at index n - 1. */
export const JUMP_ACTION_IDS = (Object.keys(actions) as ActionId[]).filter(id => id.startsWith('nav.jumpTo'))

// Get all actions as array (for shortcuts page)
export const actionList = Object.values(actions)

// Get actions by category (for organized display)
export const actionsByCategory = actionList.reduce((acc, action) => {
  if (!acc[action.category]) acc[action.category] = []
  acc[action.category].push(action)
  return acc
}, {} as Record<string, ActionDefinition[]>)
