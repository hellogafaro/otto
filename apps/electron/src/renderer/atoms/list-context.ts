/**
 * The Chats list the open chat was opened from: its items in the order the sidebar shows
 * them, so Previous / Next can step through it. The Chats list publishes its session
 * ids (as filtered, grouped and sorted there). It is the only list with Previous / Next.
 */

import { atom } from 'jotai'

export const sessionListOrderAtom = atom<string[]>([])
