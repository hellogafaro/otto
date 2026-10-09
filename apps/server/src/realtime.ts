import { getMessages } from "@otto/chats";
import { getDocument } from "@otto/documents";
import { getRunActivity, getRuns } from "@otto/runs";
import { DomainError } from "@otto/shared";

import { getTask } from "@otto/tasks";
import { getCursor, inWorkspace } from "@otto/workspaces";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import type { ApiOptions } from "./http";

const subscription = z.object({
  workspaceId: z.uuid(),
  chatId: z.uuid(),
  after: z.coerce.number().int().nonnegative().default(0),
  taskId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  runId: z.uuid().optional(),
});
export interface RealtimeData {
  headers: Headers;
  userId: string;
  subscription: z.infer<typeof subscription>;
  cursor: number;
  timer?: ReturnType<typeof setInterval>;
  pumping: boolean;
}
/** Durable polling is the initial wake-up mechanism. LISTEN/NOTIFY selection is still deferred. */
export function createRealtime(options: ApiOptions) {
  const sockets = new Set<ServerWebSocket<RealtimeData>>();
  async function pump(ws: ServerWebSocket<RealtimeData>) {
    if (ws.data.pumping) return;
    ws.data.pumping = true;
    try {
      const session = await options.auth.api.getSession({
        headers: ws.data.headers,
      });
      if (!session || session.user.id !== ws.data.userId) {
        ws.close(4401, "Authentication expired");
        return;
      }
      const request = ws.data.subscription;
      await inWorkspace(
        options.db,
        request.workspaceId,
        { userId: session.user.id },
        async (c) => {
          const messages = await getMessages(c, request.chatId, request.after);
          const { items: runs } = await getRuns(c, {
            chatId: request.chatId,
            cursor: request.after,
          });
          const activity = request.runId
            ? await getRunActivity(c, request.runId, request.after)
            : [];
          const workspaceCursor = await getCursor(c);
          // Even an idle connection is reauthorized above. A gap explicitly re-fetches open current-record views.
          if (ws.data.cursor === workspaceCursor) return;
          let cursor = Math.min(
            activity.length === 100
              ? (activity.at(-1)?.cursor ?? workspaceCursor)
              : workspaceCursor,
            messages.length === 100
              ? (messages.at(-1)?.cursor ?? workspaceCursor)
              : workspaceCursor,
            runs.length === 100
              ? (runs.at(-1)?.cursor ?? workspaceCursor)
              : workspaceCursor,
          );
          const views = {
            task: request.taskId ? await getTask(c, request.taskId) : undefined,
            document: request.documentId
              ? await getDocument(c, request.documentId)
              : undefined,
          };
          const encoder = new TextEncoder();
          let frameBytes = encoder.encode(JSON.stringify(views)).length + 1024;
          const records = [...messages, ...runs, ...activity]
            .filter((row) => row.cursor <= cursor)
            .sort((a, b) => a.cursor - b.cursor);
          for (const row of records) {
            const size = encoder.encode(JSON.stringify(row)).length + 1;
            if (frameBytes + size > 1024 * 1024) {
              cursor = row.cursor - 1;
              break;
            }
            frameBytes += size;
          }
          const payload = JSON.stringify({
            type: "snapshot",
            cursor,
            messages: messages.filter((m) => m.cursor <= cursor),
            runs: runs.filter((r) => r.cursor <= cursor),
            activity: activity.filter((r) => r.cursor <= cursor),
            views,
            refreshCurrentViews: true,
          });
          if (
            encoder.encode(payload).length > 1024 * 1024 ||
            ws.getBufferedAmount() > 1024 * 1024
          ) {
            ws.close(4408, "Reconnect for catch-up");
            return;
          }
          // Send while holding the workspace read lock so removal cannot commit between authorization and enqueue.
          if (ws.send(payload) === 0) {
            ws.close(4408, "Slow consumer");
            return;
          }
          request.after = cursor;
          ws.data.cursor = cursor;
        },
        false,
      );
    } catch (error) {
      if (error instanceof DomainError) ws.close(4403, "Access changed");
      else ws.close(1011, "Stream failed");
    } finally {
      ws.data.pumping = false;
    }
  }
  return {
    async prepare(request: Request): Promise<RealtimeData | Response> {
      if (request.headers.get("origin") !== options.origin)
        return new Response(null, { status: 403 });
      const session = await options.auth.api.getSession({
        headers: request.headers,
      });
      if (!session) return new Response(null, { status: 401 });
      if (
        sockets.size >= 500 ||
        [...sockets].filter((ws) => ws.data.userId === session.user.id)
          .length >= 4
      )
        return new Response(null, { status: 429 });
      const parsed = subscription.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) return new Response(null, { status: 400 });
      try {
        await inWorkspace(
          options.db,
          parsed.data.workspaceId,
          { userId: session.user.id },
          (c) => getMessages(c, parsed.data.chatId, parsed.data.after),
          false,
        );
      } catch (error) {
        if (error instanceof DomainError)
          return new Response(null, { status: 403 });
        throw error;
      }
      return {
        headers: request.headers,
        userId: session.user.id,
        subscription: parsed.data,
        cursor: -1,
        pumping: false,
      };
    },
    websocket: {
      maxPayloadLength: 4096,
      idleTimeout: 60,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(ws: ServerWebSocket<RealtimeData>) {
        if (
          sockets.size >= 500 ||
          [...sockets].filter(
            (current) => current.data.userId === ws.data.userId,
          ).length >= 4
        ) {
          ws.close(4408, "Connection limit");
          return;
        }
        sockets.add(ws);
        void pump(ws);
        ws.data.timer = setInterval(() => void pump(ws), 1000);
      },
      message(ws: ServerWebSocket<RealtimeData>) {
        ws.close(4400, "Subscribe through the authenticated URL");
      },
      close(ws: ServerWebSocket<RealtimeData>) {
        clearInterval(ws.data.timer);
        sockets.delete(ws);
      },
    },
    close() {
      for (const ws of sockets) ws.close(1001, "Server stopping");
    },
  };
}
