import * as NodeCrypto from "node:crypto";

import {
  type Actor,
  BotId,
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationTask,
  ProviderInstanceId,
  type TaskId,
  type TaskWake,
  ThreadId,
  type WorkParticipant,
} from "@otto/contracts";
import { makeDrainableWorker } from "@otto/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ActivityStore } from "../activity/activity-store.ts";
import { OrganizationAccounts } from "../auth/organization-accounts.ts";
import type { AccountPerson } from "../auth/organization-accounts-runtime.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { forkParked } from "../server-activation.ts";
import { escapeComment } from "./task-tool-runtime.ts";

/**
 * Otto: Each bot works on a task in one chat of its own, reused for every assignment and
 * mention so it keeps the task's history.
 */
export const taskChatId = (taskId: TaskId, botId: BotId) =>
  ThreadId.make(`task-${taskId}--${botId}`);

const MENTION = /<mention type="([^"]*)" id="([^"]*)">([^<]*)<\/mention>/g;

/** The bots a comment @mentions. */
export const mentionedBots = (content: string) =>
  [...content.matchAll(MENTION)].flatMap(([, type, id]) =>
    type === "bot" && id ? [BotId.make(id)] : [],
  );

/** The comment a comment replies to, if any. */
export const repliedComment = (content: string) =>
  [...content.matchAll(MENTION)].find(([, type, id]) => type === "comment" && id)?.[2];

/** A comment as plain text for a bot: mentions as `@Name`, work with its id, markup unescaped. */
export const commentText = (content: string) =>
  content
    .replace(MENTION, (_tag, type: string, id: string, label: string) =>
      type === "task" || type === "project" ? `@${label} (${type}Id: ${id})` : `@${label}`,
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const botsOf = (participants: ReadonlyArray<WorkParticipant | null>) =>
  participants.flatMap((participant) => (participant?.kind === "bot" ? [participant.botId] : []));

/** The bots a task event newly gives the task to, except a bot handing work to itself. */
export const newlyAssignedBots = (event: OrchestrationEvent): ReadonlyArray<BotId> => {
  if (event.type !== "task.created" && event.type !== "task.updated") return [];

  const { task, actor } = event.payload;
  const changes = event.type === "task.updated" ? event.payload.changes : undefined;

  const before =
    event.type === "task.created"
      ? []
      : botsOf([
          ...(changes?.assignees?.from ?? task.assignees),
          changes?.owner?.from ?? task.owner,
        ]);

  const after = botsOf([...task.assignees, task.owner]);

  return [...new Set(after)].filter(
    (botId) => !before.includes(botId) && !(actor?.type === "bot" && actor.id === botId),
  );
};

interface Work {
  readonly taskId: TaskId;
  readonly botId: BotId;
  /** The comment that asked, which the bot's reply answers in its thread. */
  readonly replyTo: { readonly id: string; readonly label: string } | null;
  reply: string;
  replyId: string | null;
  live: boolean;
}

export interface TaskWorkReactorShape {
  /** Start giving bots the tasks they're assigned or mentioned on. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /** Resolves when every received event has been handled. For tests. */
  readonly drain: Effect.Effect<void>;
}

export class TaskWorkReactor extends Context.Service<TaskWorkReactor, TaskWorkReactorShape>()(
  "@otto/server/tasks/task-work-reactor/TaskWorkReactor",
) {}

/**
 * Otto: A bot assigned to a task, or @mentioned or replied to in one of its comments by a person,
 * gets a turn in its chat for that task with the task as context; the turn's final reply is
 * posted on the task as the bot's comment.
 */
export const makeTaskWorkReactor = (
  listPeople: () => Effect.Effect<ReadonlyArray<AccountPerson>>,
  commentAuthor: (commentId: string) => Effect.Effect<Actor | null>,
) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery;
    const working = new Map<ThreadId, Work>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const actorKey = (actor: Actor | undefined) =>
      actor === undefined ? "unknown" : `${actor.type}:${actor.id}`;

    const actorName = (actor: Actor | undefined, task: OrchestrationTask) =>
      Effect.gen(function* () {
        if (actor === undefined) return "Someone";

        if (actor.type === "bot") {
          const model = yield* projection.getCommandReadModel();

          return model.bots.find((bot) => bot.id === actor.id)?.name ?? "A bot";
        }

        const known = [task.owner, ...task.assignees].find(
          (participant) => participant?.kind === "person" && participant.personId === actor.id,
        );

        if (known?.kind === "person") return known.displayName;

        return (
          (yield* listPeople()).find((person) => person.userId === actor.id)?.displayName ??
          "Someone"
        );
      });

    const comment = (
      task: OrchestrationTask,
      botId: BotId,
      text: string,
      replyTo: Work["replyTo"] = null,
    ) =>
      Effect.gen(function* () {
        const thread = replyTo
          ? `<mention type="comment" id="${replyTo.id}">${escapeComment(replyTo.label)}</mention> `
          : "";

        yield* engine.dispatch({
          type: "task.comment.add",
          commandId: CommandId.make(`task-work:comment:${NodeCrypto.randomUUID()}`),
          taskId: task.id,
          commentId: NodeCrypto.randomUUID(),
          content: thread + escapeComment(text),
          fileIds: [],
          by: { type: "bot", id: botId },
          createdAt: yield* nowIso,
        });
      });

    /**
     * Gives the bot a turn in its chat for the task, creating the chat the first time. The chat
     * shows the comment under its author, or a line for an assignment; the bot gets the event.
     */
    const startWork = (
      task: OrchestrationTask,
      botId: BotId,
      actor: Actor | undefined,
      wake: TaskWake,
      replyTo: Work["replyTo"] = null,
    ) =>
      Effect.gen(function* () {
        const model = yield* projection.getCommandReadModel();
        const bot = model.bots.find((candidate) => candidate.id === botId);

        if (bot === undefined || bot.archivedAt !== null) return;

        const project = model.projects.find((candidate) => candidate.id === task.projectId);

        const modelSelection = bot.engine
          ? {
              instanceId: ProviderInstanceId.make(bot.engine.provider),
              model: bot.engine.model,
              ...(bot.engine.options ? { options: bot.engine.options } : {}),
            }
          : project?.defaultModelSelection;

        if (!modelSelection) {
          return yield* comment(
            task,
            botId,
            "I need a model before I can work on tasks. Ask whoever manages me to pick one.",
            replyTo,
          );
        }

        const threadId = taskChatId(task.id, botId);
        const createdAt = yield* nowIso;

        if (Option.isNone(yield* projection.getThreadShellById(threadId))) {
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`task-work:chat:${threadId}`),
            threadId,
            projectId: task.projectId,
            botId,
            groupId: null,
            createdBy: actor?.type === "person" ? actor.id : null,
            visibility: "organization",
            title: task.title,
            modelSelection,
            runtimeMode: bot.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          });
        }

        const text = wake.text ?? `${wake.by.name} assigned ${bot.name} to this task.`;

        working.set(threadId, {
          taskId: task.id,
          botId,
          replyTo,
          reply: "",
          replyId: null,
          live: false,
        });

        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`task-work:turn:${NodeCrypto.randomUUID()}`),
          threadId,
          message: {
            messageId: MessageId.make(`task-work:${NodeCrypto.randomUUID()}`),
            role: "user",
            text,
            attachments: [],
          },
          ...(actor?.type === "person"
            ? { senderPersonId: actor.id, senderDisplayName: wake.by.name }
            : {}),
          taskWake: { ...wake, text },
          modelSelection,
          runtimeMode: bot.runtimeMode,
          interactionMode: "default",
          createdAt,
        });
      });

    const finish = (threadId: ThreadId, work: Work) =>
      Effect.gen(function* () {
        working.delete(threadId);

        const reply = work.reply.trim();

        if (reply.length === 0) return;

        const task = ((yield* projection.getCommandReadModel()).tasks ?? []).find(
          (candidate) => candidate.id === work.taskId,
        );

        if (task) yield* comment(task, work.botId, reply, work.replyTo);
      });

    const process = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (event.type === "task.created" || event.type === "task.updated") {
        const { task, actor } = event.payload;

        for (const botId of newlyAssignedBots(event)) {
          yield* startWork(task, botId, actor, {
            type: "assigned",
            taskId: task.id,
            by: { key: actorKey(actor), name: yield* actorName(actor, task) },
          });
        }

        return;
      }

      if (event.type === "task.commented") {
        const { task, comment: posted } = event.payload;

        if (posted.actor.type !== "person") return;

        const who = yield* actorName(posted.actor, task);
        const replied = repliedComment(posted.content);
        const repliedAuthor = replied === undefined ? null : yield* commentAuthor(replied);

        const mentioned = mentionedBots(posted.content);

        const bots = new Set([
          ...mentioned,
          ...(repliedAuthor?.type === "bot" ? [repliedAuthor.id] : []),
        ]);

        for (const botId of bots) {
          yield* startWork(
            task,
            botId,
            posted.actor,
            {
              type: "commented",
              taskId: task.id,
              by: { key: actorKey(posted.actor), name: who },
              commentId: posted.id,
              reason: mentioned.includes(botId) ? "mention" : "reply",
              ...(replied === undefined ? {} : { replyTo: replied }),
              text: commentText(posted.content),
            },
            { id: posted.id, label: who },
          );
        }

        return;
      }

      if (event.type === "thread.message-sent") {
        const work = working.get(event.payload.threadId);

        if (work === undefined || event.payload.role !== "assistant") return;

        // Only the turn's last message is its answer; earlier ones narrate the work.
        if (work.replyId !== event.payload.messageId) {
          work.replyId = event.payload.messageId;
          work.reply = "";
        }

        if (event.payload.streaming) work.reply += event.payload.text;
        else if (event.payload.text.length > 0) work.reply = event.payload.text;

        return;
      }

      if (event.type !== "thread.session-set") return;

      const work = working.get(event.payload.threadId);

      if (work === undefined) return;

      const status = event.payload.session.status;

      if (status === "starting" || status === "running") {
        work.live ||= status === "running";

        return;
      }

      if (work.live || status === "error") yield* finish(event.payload.threadId, work);
    });

    const worker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
      process(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("task work failed", { cause })),
      ),
    );

    const start: TaskWorkReactorShape["start"] = Effect.fn("TaskWorkReactor.start")(function* () {
      const events = yield* engine.subscribeDomainEvents;

      yield* forkParked(
        Stream.runForEach(events, (event) =>
          event.type === "task.created" ||
          event.type === "task.updated" ||
          event.type === "task.commented" ||
          event.type === "thread.message-sent" ||
          event.type === "thread.session-set"
            ? worker.enqueue(event)
            : Effect.void,
        ),
      );
    });

    return { start, drain: worker.drain } satisfies TaskWorkReactorShape;
  });

export const TaskWorkReactorLive = Layer.effect(
  TaskWorkReactor,
  Effect.gen(function* () {
    const accounts = yield* OrganizationAccounts;
    const activity = yield* ActivityStore;

    return yield* makeTaskWorkReactor(
      () => accounts.listPeople().pipe(Effect.orElseSucceed(() => [])),
      (commentId) =>
        activity.getComment(commentId).pipe(
          Effect.map((entry) => entry.actor),
          Effect.orElseSucceed(() => null),
        ),
    );
  }),
);
