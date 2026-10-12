import * as Predicate from "effect/Predicate";

import {
  BotId,
  CommandId,
  type OttoDelegationRecord,
  ottoDelegationStateOf,
  type OttoToolInputSchemas,
  acknowledgeOttoDelegation,
  isOttoDelegationResultPending,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";

import {
  type OttoDelegationRuntimeOptions,
  type OttoDelegationParent,
  phaseChildThreadId,
  isReachableFromThread,
  TERMINAL_PHASES,
} from "./OttoDelegationPolicy.ts";

export function createOttoDelegationControls(
  options: OttoDelegationRuntimeOptions,
  now: () => string,
  id: () => string,
  commandId: (label: string) => CommandId,
  dispatch: (command: OrchestrationCommand) => Promise<void>,
  setState: (delegation: OttoDelegationRecord) => Promise<void>,
) {
  const availableBot = (
    snapshot: OrchestrationReadModel,
    parent: OttoDelegationParent,
    botId: BotId,
  ) => {
    const parentThread = snapshot.threads.find((thread) => thread.id === parent.threadId);
    const bot = snapshot.bots.find((candidate) => candidate.id === botId);

    if (!parentThread || !bot || bot.archivedAt !== null) {
      throw new Error("The target bot is not available in this workspace.");
    }

    if (!isReachableFromThread(snapshot, parentThread, bot)) {
      throw new Error("The target bot is not available in the current group.");
    }

    return { parentThread, bot };
  };

  const create = async (
    parent: OttoDelegationParent,
    request: (typeof OttoToolInputSchemas.CreateAgent)["Type"],
  ) => {
    const snapshot = await options.readSnapshot();
    const { parentThread, bot: parentBot } = availableBot(snapshot, parent, parent.botId);

    if (
      snapshot.bots.some(
        (candidate) =>
          candidate.archivedAt === null &&
          candidate.name.localeCompare(request.name, undefined, { sensitivity: "accent" }) === 0,
      )
    ) {
      throw new Error(`A bot named '${request.name}' already exists.`);
    }

    const botId = BotId.make(`bot-${id()}`);
    await dispatch({
      type: "bot.create",
      commandId: commandId("bot-create"),
      botId,
      name: request.name,
      title: request.title ?? "Bot",
      label: null,
      description: request.description ?? null,
      disabledMcpServerIds: parentBot.disabledMcpServerIds,
      avatar: { kind: "dither", seed: String(botId) },
      engine: parentBot.engine,
      sandbox: parentBot.sandbox,
      runtimeMode: parent.access.runtimeMode,
      imageProvider: null,
      voiceEnabled: false,
      groupId: parentThread.groupId ?? null,
      createdAt: now(),
    });

    return { botId, name: request.name };
  };

  const check = async (
    parent: OttoDelegationParent,
    request: (typeof OttoToolInputSchemas.CheckAgent)["Type"],
  ) => {
    const snapshot = await options.readSnapshot();
    const { bot } = availableBot(snapshot, parent, request.botId);

    // A group thread holds work from several parent bots; each bot reads and
    // acknowledges only its own results.
    const delegations = snapshot.delegations.filter(
      (delegation) =>
        delegation.parentThreadId === parent.threadId &&
        delegation.parentBotId === parent.botId &&
        delegation.childBotId === bot.id,
    );

    // Reading a finished result here is its delivery, so the next parent turn
    // does not receive it again.
    for (const delegation of delegations) {
      if (isOttoDelegationResultPending(delegation)) {
        await setState(acknowledgeOttoDelegation(delegation, now()));
      }
    }

    return {
      botId: bot.id,
      name: bot.name,
      title: bot.title,
      delegations: delegations.map((delegation) => ({
        delegationId: delegation.delegationId,
        state: ottoDelegationStateOf(delegation.phase),
        childThreadId: phaseChildThreadId(delegation),
        summary: Predicate.isTagged(delegation.phase, "Completed")
          ? delegation.phase.result.summary
          : Predicate.isTagged(delegation.phase, "Failed")
            ? delegation.phase.failure.message
            : null,
        result: Predicate.isTagged(delegation.phase, "Completed") ? delegation.phase.result : null,
        failure: Predicate.isTagged(delegation.phase, "Failed") ? delegation.phase.failure : null,
      })),
    };
  };

  const stop = async (
    parent: OttoDelegationParent,
    request: (typeof OttoToolInputSchemas.StopAgent)["Type"],
  ) => {
    const snapshot = await options.readSnapshot();
    availableBot(snapshot, parent, request.botId);

    const active = snapshot.delegations.filter(
      (delegation) =>
        delegation.parentThreadId === parent.threadId &&
        delegation.childBotId === request.botId &&
        !TERMINAL_PHASES.has(delegation.phase._tag),
    );

    if (active.length === 0) throw new Error("The target bot has no active delegated work.");

    for (const delegation of active) {
      await dispatch({
        type: "delegation.cancel",
        commandId: commandId("stop"),
        delegationId: delegation.delegationId,
        keep: false,
        createdAt: now(),
      });
    }

    return { botId: request.botId, stopped: active.map((entry) => entry.delegationId) };
  };

  return { availableBot, create, check, stop };
}
