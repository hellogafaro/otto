import * as NodeCrypto from "node:crypto";

import {
  BotId,
  type OttoMessageReactionResult,
  CommandId,
  ThreadId,
  type OttoToolInputSchemas,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThread,
  isGroupBotMember,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";

export interface OttoChannelRuntimeOptions {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  readonly readThread?: (threadId: ThreadId) => Promise<OrchestrationThread | undefined>;
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Promise<{ readonly sequence: number } | void>;
  readonly now?: () => string;
  readonly supportsReactions?: (thread: OrchestrationThread) => boolean;
}

export function createOttoChannelRuntime(options: OttoChannelRuntimeOptions) {
  const now = options.now ?? (() => DateTime.formatIso(DateTime.nowUnsafe()));

  const react = async (
    threadId: ThreadId,
    botId: BotId,
    input: (typeof OttoToolInputSchemas.ReactToMessage)["Type"],
    toolCallId: string,
  ): Promise<OttoMessageReactionResult> => {
    const snapshot = await options.readSnapshot();

    const thread = options.readThread
      ? await options.readThread(threadId)
      : snapshot.threads.find((entry) => entry.id === threadId);

    const message = thread?.messages.find((entry) => entry.id === input.messageId);

    if (!thread || !message) throw new Error("The target message is not visible to this bot.");

    const isVisible =
      thread.botId === botId ||
      (thread.groupId != null &&
        snapshot.groups
          .find((group) => group.id === thread.groupId)
          ?.members.some((member) => isGroupBotMember(member) && member.botId === botId));

    if (!isVisible) throw new Error("The target message is not visible to this bot.");

    if (options.supportsReactions?.(thread) === false) {
      return {
        status: "unsupported",
        messageId: input.messageId,
        reason: "channel-does-not-support-reactions",
      };
    }

    const present = (message.reactions ?? []).some(
      (reaction) => reaction.botId === botId && reaction.emoji === input.emoji,
    );

    const nextPresent = input.action === "add";

    if (present === nextPresent) return { status: "applied", ...input, changed: false };

    const commandKey = NodeCrypto.createHash("sha256")
      .update(`${threadId}\u0000${botId}\u0000${toolCallId}\u0000${snapshot.snapshotSequence}`)
      .digest("hex");

    await options.dispatch({
      type: "thread.message.reaction.set",
      commandId: CommandId.make(`reaction:${commandKey}`),
      threadId: thread.id,
      messageId: input.messageId,
      botId,
      emoji: input.emoji,
      present: nextPresent,
      updatedAt: now(),
    });

    return { status: "applied", ...input, changed: true };
  };

  return { react };
}

export type OttoChannelRuntime = ReturnType<typeof createOttoChannelRuntime>;
