import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/use-local-storage";

/**
 * Otto: Whether the chat details panel is open: one preference for every chat, DM or group.
 * The panel toggles it; the chat header reads it to keep its actions clear of the open toggle.
 */
export function useChatDetailsOpen() {
  return useLocalStorage("otto:chat-details-open", false, Schema.Boolean);
}
