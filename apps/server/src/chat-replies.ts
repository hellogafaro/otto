import { createHash } from "node:crypto";
import { getAgent } from "@otto/agents";
import {
  createMessage,
  getChat,
  getMessageReplyAgentIds,
  type MessageInput,
} from "@otto/chats";
import { snapshotRunDocuments } from "@otto/library";
import { admitRun, prepareRunModel } from "@otto/runs";
import { DomainError } from "@otto/shared";
import { type Actor, type Context, inWorkspace } from "@otto/workspaces";
import type { ApiOptions } from "./http";

export async function createChatMessage(
  options: Pick<
    ApiOptions,
    "db" | "nativeStorage" | "boss" | "modelAuthorization"
  >,
  workspaceId: string,
  actor: Actor,
  chatId: string,
  input: MessageInput,
  authorize?: (c: Context) => Promise<void>,
) {
  const message = await createMessage(
    options.db,
    options.nativeStorage,
    workspaceId,
    actor,
    chatId,
    input,
    authorize,
  );
  if (actor.agentId) return { ...message, replyErrors: [] };
  const agentIds = await inWorkspace(
    options.db,
    workspaceId,
    actor,
    (c) => getMessageReplyAgentIds(c, chatId, message.id),
    false,
  );
  const replyErrors: {
    agentId: string;
    code: DomainError["code"];
    message: string;
  }[] = [];
  for (const agentId of agentIds) {
    try {
      const identity = createHash("sha256")
        .update(JSON.stringify(["otto.chat.reply", message.id, agentId]))
        .digest();
      identity[6] = ((identity[6] ?? 0) & 0x0f) | 0x80;
      identity[8] = ((identity[8] ?? 0) & 0x3f) | 0x80;
      const hex = identity.subarray(0, 16).toString("hex");
      const request = {
        chatId,
        agentId,
        requestId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        type: "prompt" as const,
        body: message.body,
        sessionMode: "auto" as const,
        messageIds: [message.id],
      };
      const check = async (c: Context) => {
        await getChat(c, chatId, true);
        await getAgent(c, agentId);
        await getChat(
          { ...c, actor: { userId: actor.userId, agentId } },
          chatId,
          true,
        );
      };
      await inWorkspace(options.db, workspaceId, actor, check, false);
      const authorization = await prepareRunModel(
        options.db,
        workspaceId,
        actor,
        request,
        options.modelAuthorization,
      );
      await inWorkspace(options.db, workspaceId, actor, async (c) => {
        await check(c);
        return admitRun(
          c,
          options.boss,
          request,
          authorization,
          options.nativeStorage,
          snapshotRunDocuments,
        );
      });
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "unavailable";
      const messages: Record<DomainError["code"], string> = {
        forbidden: "Agent reply is not permitted by current access.",
        not_found: "Agent reply is no longer available.",
        conflict: "Agent reply cannot start in the current state.",
        unavailable:
          "Agent reply is unavailable. Check its model account and retry.",
        invalid: "Agent reply request is invalid.",
      };
      replyErrors.push({ agentId, code, message: messages[code] });
    }
  }
  return { ...message, replyErrors };
}
