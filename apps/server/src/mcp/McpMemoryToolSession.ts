import type { ThreadId } from "@otto/contracts";

import type { OttoMemoryToolHandler } from "../memory/BotMemoryToolHandlers.ts";

const handlersByThread = new Map<string, OttoMemoryToolHandler>();

export function setMcpMemoryToolSession(threadId: ThreadId, handler: OttoMemoryToolHandler): void {
  handlersByThread.set(String(threadId), handler);
}

export function readMcpMemoryToolSession(threadId: ThreadId): OttoMemoryToolHandler | undefined {
  return handlersByThread.get(String(threadId));
}

export function clearMcpMemoryToolSession(threadId: ThreadId): void {
  handlersByThread.delete(String(threadId));
}

export function clearAllMcpMemoryToolSessions(): void {
  handlersByThread.clear();
}
