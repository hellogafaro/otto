import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  ThreadId,
  type OttoToolInputSchemas,
  type OttoToolReceipt,
  type BotAlwaysAllowedTool,
  type BotId,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";

export interface OttoBotStateRuntimeOptions {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  /** Reads one bot without the whole read model, which readSnapshot falls back to. */
  readonly readBot?: (botId: BotId) => Promise<Pick<OrchestrationBot, "alwaysAllowed"> | undefined>;
  readonly dispatch: (command: OrchestrationCommand) => Promise<{ readonly sequence: number }>;
  readonly now?: () => string;
  readonly id?: () => string;
}

export function createOttoBotStateRuntime(options: OttoBotStateRuntimeOptions) {
  const now = options.now ?? (() => DateTime.formatIso(DateTime.nowUnsafe()));
  const id = options.id ?? (() => NodeCrypto.randomUUID());

  const updateProfile = async (
    threadId: ThreadId,
    botId: BotId,
    toolCallId: string,
    input: (typeof OttoToolInputSchemas.bot_update)["Type"],
  ): Promise<OttoToolReceipt> => {
    const snapshot = await options.readSnapshot();
    const bot = snapshot.bots.find((candidate) => candidate.id === botId);

    if (!bot || bot.archivedAt !== null) throw new Error("This bot is not available.");

    const createdAt = now();

    const result = await options.dispatch({
      type: "bot.update",
      commandId: CommandId.make(`bot-state:profile:${id()}`),
      botId,
      ...input,
    });

    return {
      receiptId: toolCallId,
      toolId: "bot_update",
      phase: "success",
      threadId,
      botId,
      summary: `Bot profile updated at event sequence ${result.sequence}.`,
      fatalToThread: false,
      billedBotId: botId,
      createdAt,
    };
  };

  /**
   * Saves a person's Always allow on the bot, so later turns and restarts keep it. The command
   * acts as that person, so only someone with the bot's owner authority can save it.
   */
  const allowAlways = async (botId: BotId, rule: BotAlwaysAllowedTool) => {
    await options.dispatch({
      type: "bot.update",
      commandId: CommandId.make(`bot-state:always-allow:${id()}`),
      botId,
      alwaysAllow: rule,
      by: { kind: "person", ...rule.createdBy },
    });
  };

  /** The bot's Always allow rules as saved now, so a removed rule stops applying at once. */
  const alwaysAllowed = async (botId: BotId) => {
    const bot = options.readBot
      ? await options.readBot(botId)
      : (await options.readSnapshot()).bots.find((candidate) => candidate.id === botId);

    return bot?.alwaysAllowed ?? [];
  };

  return { updateProfile, allowAlways, alwaysAllowed };
}

export type OttoBotStateRuntime = ReturnType<typeof createOttoBotStateRuntime>;
