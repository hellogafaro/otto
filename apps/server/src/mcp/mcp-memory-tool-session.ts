import type { ThreadId } from "@otto/contracts";

import type { MemoryToolHandler } from "../memory/memory-update-tool.ts";

const handlersByThread = new Map<string, MemoryToolHandler>();

export function setMcpMemoryToolSession(threadId: ThreadId, handler: MemoryToolHandler): void {
  handlersByThread.set(String(threadId), handler);
}

export function readMcpMemoryToolSession(threadId: ThreadId): MemoryToolHandler | undefined {
  return handlersByThread.get(String(threadId));
}

export function clearMcpMemoryToolSession(threadId: ThreadId): void {
  handlersByThread.delete(String(threadId));
}

export function clearAllMcpMemoryToolSessions(): void {
  handlersByThread.clear();
}
