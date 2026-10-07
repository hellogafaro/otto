/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import { SettingsPage } from '@/components/settings/settings-page'
import { useTranslation } from 'react-i18next'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { actionsByCategory, JUMP_ACTION_IDS, useActionLabel, type ActionId } from '@/actions'
import { Kbd } from '@/components/ui/kbd'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'shortcuts',
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

// Component-specific shortcuts that aren't in the centralized registry
function useComponentSpecificSections(): ShortcutSection[] {
  const { t } = useTranslation()
  return [
    {
      title: t('shortcuts.listNavigation'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('shortcuts.navigateItems') },
        { keys: ['Home'], description: t('shortcuts.goToFirst') },
        { keys: ['End'], description: t('shortcuts.goToLast') },
      ],
    },
    {
      title: t('shortcuts.sessionList'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.focusChatInput') },
        { keys: ['Right-click'], description: t('shortcuts.openContextMenu') },
        { keys: [isMac ? '⌥' : 'Alt', 'Click'], description: t('shortcuts.addFilterExcluded') },
      ],
    },
    {
      title: t('shortcuts.chatInput'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.newLine') },
        { keys: ['Esc'], description: t('shortcuts.closeDialogBlur') },
      ],
    },
  ]
}

/**
 * Renders a shortcut row for an action from the registry
 */
// Map action IDs to i18n keys for translated labels
const ACTION_LABEL_KEYS: Partial<Record<ActionId, string>> = {
  'app.newChat': 'shortcuts.action.newChat',
  'app.commandPalette': 'shortcuts.action.commandPalette',
  'app.settings': 'shortcuts.action.settings',
  'app.toggleTheme': 'shortcuts.action.toggleTheme',
  'app.keyboardShortcuts': 'shortcuts.action.keyboardShortcuts',
  'app.quit': 'shortcuts.action.quit',
  'nav.home': 'shortcuts.action.openHome',
  'nav.jumpTo1': 'shortcuts.action.jumpTo',
  'nav.nextZone': 'shortcuts.action.focusNextZone',
  'nav.goBack': 'shortcuts.action.goBack',
  'nav.goForward': 'shortcuts.action.goForward',
  'nav.goBackAlt': 'shortcuts.action.goBack',
  'nav.goForwardAlt': 'shortcuts.action.goForward',
  'navigator.selectAll': 'shortcuts.action.selectAll',
  'navigator.clearSelection': 'shortcuts.action.clearSelection',
  'chat.stopProcessing': 'shortcuts.action.stopProcessing',
  'chat.cyclePermissionMode': 'shortcuts.action.cyclePermissionMode',
  'chat.nextSearchMatch': 'shortcuts.action.nextSearchMatch',
  'chat.prevSearchMatch': 'shortcuts.action.prevSearchMatch',
  'composer.focus': 'shortcuts.action.focusComposer',
  'task.changeStatus': 'tasks.changeStatus',
  'task.changeDueDate': 'tasks.changeDueDate',
  'task.changeProject': 'tasks.changeProject',
}

const JUMP_REST = new Set<string>(JUMP_ACTION_IDS.slice(1))

function ActionShortcutRow({ actionId }: { actionId: ActionId }) {
  const { t } = useTranslation()
  const { label, hotkey } = useActionLabel(actionId)

  if (!hotkey) return null

  // Split hotkey into individual keys for display
  // Mac: symbols are concatenated (⌘⇧N) - need smart splitting
  // Windows: separated by + (Ctrl+Shift+N) - split on +
  const keys = isMac
    ? hotkey.match(/[⌘⇧⌥←→]|Tab|Esc|./g) || []
    : hotkey.split('+')
  // The nine jump keys are one row: the modifier and 1–9.
  if (actionId === 'nav.jumpTo1') keys[keys.length - 1] = '1–9'

  return (
    <SettingsRow label={ACTION_LABEL_KEYS[actionId] ? t(ACTION_LABEL_KEYS[actionId]!) : label}>
      <div className="flex items-center gap-1">
        {keys.map((key, keyIndex) => (
          <Kbd key={keyIndex}>{key}</Kbd>
        ))}
      </div>
    </SettingsRow>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()
  const componentSpecificSections = useComponentSpecificSections()
  return (
    <SettingsPage subpage="shortcuts">{/* Registry-driven sections */}
            {Object.entries(actionsByCategory).map(([category, actions]) => (
              <SettingsSection key={category} title={t(`shortcuts.category.${category.toLowerCase()}`)}>
                <SettingsCard>
                  {actions.filter(action => !JUMP_REST.has(action.id)).map(action => (
                    <ActionShortcutRow key={action.id} actionId={action.id as ActionId} />
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}

            {/* Component-specific sections */}
            {componentSpecificSections.map((section) => (
              <SettingsSection key={section.title} title={section.title}>
                <SettingsCard>
                  {section.shortcuts.map((shortcut, index) => (
                    <SettingsRow key={index} label={shortcut.description}>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex}>{key}</Kbd>
                        ))}
                      </div>
                    </SettingsRow>
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}
    </SettingsPage>
  )
}
