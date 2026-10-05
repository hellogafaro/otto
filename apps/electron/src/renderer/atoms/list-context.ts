/**
 * The Chats list the open chat was opened from: its items in the order the sidebar shows
 * them, so Previous / Next can step through it. The Chats list publishes its session
 * ids (as filtered, grouped and sorted there). Lists with a fixed order (the settings
 * pages, `SETTINGS_NAV_ORDER`) need no atom: `listNav` reads them directly.
 */

import { atom } from 'jotai'

export const sessionListOrderAtom = atom<string[]>([])
