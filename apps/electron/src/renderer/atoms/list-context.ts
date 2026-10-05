/**
 * The list the open page was opened from: its items in the order the sidebar shows
 * them, so Previous / Next can step through it. The Chats list publishes its
 * session ids (as filtered, grouped and sorted there); a later list (tasks) publishes
 * the same way.
 */

import { atom } from 'jotai'

export const sessionListOrderAtom = atom<string[]>([])
