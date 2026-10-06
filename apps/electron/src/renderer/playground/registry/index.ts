import type { ComponentEntry, CategoryGroup, Category } from './types'
import { onboardingComponents } from './onboarding'
import { chatComponents } from './chat'
import { turnCardComponents, fullscreenOverlayComponents } from './turn-card'
import { turnCardModesComponents } from './turn-card-modes'
import { messagesComponents } from './messages'
import { markdownComponents } from './markdown'
import { iconComponents } from './icons'
import { oauthComponents } from './oauth'
import { toastsComponents } from './toasts'
import { composerComponents } from './composer'
import { sessionListComponents } from './session-list'
import { entityListComponents } from './entity-lists'
import { browserUiComponents } from './browser-ui'
import { shellComponents } from './shell'
import { pinsRecentsComponents } from './pins-recents'
import { commandPaletteComponents } from './command-palette'
import { customShadowsComponents } from './custom-shadows'
import { transportBannerComponents } from './transport-banner'
import { containerTransitionsComponents } from './container-transitions'
import { messagingComponents } from './messaging'
import { imageSupportComponents } from './image-support'
import { mobileWebUIComponents } from './mobile-webui'
import { statesComponents } from './states'
import { listTableComponents } from './list-table'
import { galleryPropertiesComponents } from './gallery-properties'

export * from './types'

export const componentRegistry: ComponentEntry[] = [
  ...mobileWebUIComponents,
  ...statesComponents,
  ...listTableComponents,
  ...galleryPropertiesComponents,
  ...onboardingComponents,
  ...chatComponents,
  ...turnCardComponents,
  ...turnCardModesComponents,
  ...fullscreenOverlayComponents,
  ...messagesComponents,
  ...composerComponents,
  ...toastsComponents,
  ...markdownComponents,
  ...iconComponents,
  ...oauthComponents,
  ...sessionListComponents,
  ...entityListComponents,
  ...browserUiComponents,
  ...shellComponents,
  ...pinsRecentsComponents,
  ...commandPaletteComponents,
  ...customShadowsComponents,
  ...transportBannerComponents,
  ...containerTransitionsComponents,
  ...messagingComponents,
  ...imageSupportComponents,
]

export function getCategories(): CategoryGroup[] {
  const categoryOrder: Category[] = ['Shell', 'Mobile WebUI', 'Onboarding', 'Agent Setup', 'Chat', 'Island', 'Browser', 'Custom Shadows', 'Session List', 'Entity Lists', 'Edit Popover', 'Turn Cards', 'TurnCard Modes', 'Fullscreen', 'Chat Messages', 'Chat Inputs', 'Toast Messages', 'Markdown', 'Icons', 'OAuth', 'Messaging']
  const categoryMap = new Map<Category, ComponentEntry[]>()

  for (const entry of componentRegistry) {
    const existing = categoryMap.get(entry.category) ?? []
    categoryMap.set(entry.category, [...existing, entry])
  }

  return categoryOrder
    .filter(name => categoryMap.has(name))
    .map(name => ({
      name,
      components: categoryMap.get(name)!,
    }))
}

export function getComponentById(id: string): ComponentEntry | undefined {
  return componentRegistry.find(c => c.id === id)
}
