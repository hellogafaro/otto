import * as NodeCrypto from "node:crypto";

import {
  type ActivityEntry,
  AuthSessionId,
  BotId,
  type BotId as BotIdType,
  CommandId,
  type OrchestrationBot,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OttoToolInputSchemas,
  type ProjectId,
  TaskId,
  type ThreadId,
  type WorkParticipant,
  workParticipantKey,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ActivityStore } from "../activity/activity-store.ts";
import { OrganizationAccounts } from "../auth/organization-accounts.ts";
import type { AccountPerson } from "../auth/organization-accounts-runtime.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";

type Input<Name extends keyof typeof OttoToolInputSchemas> =
  (typeof OttoToolInputSchemas)[Name]["Type"];

/** The bot calling a task tool, and the chat it runs in. */
export interface TaskToolCaller {
  readonly threadId: ThreadId;
  readonly botId: BotIdType;
}

/** A refusal the bot reads and can act on, returned as the tool's result. */
class TaskToolError extends Schema.TaggedErrorClass<TaskToolError>()("TaskToolError", {
  detail: Schema.String,
}) {}

const fail = (detail: string) => Effect.fail(new TaskToolError({ detail }));

const LIST_DEFAULT = 25;

const ACTIVITY_SHOWN = 20;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const participantName = (participant: WorkParticipant, bots: ReadonlyArray<OrchestrationBot>) =>
  participant.kind === "person"
    ? participant.displayName
    : (bots.find((bot) => bot.id === participant.botId)?.name ?? "A bot");

/** Someone on a task as the bot sees them: a name, and the key to hand back to the tools. */
const describeParticipant = (
  participant: WorkParticipant,
  bots: ReadonlyArray<OrchestrationBot>,
  caller: TaskToolCaller,
) => ({
  key: workParticipantKey(participant),
  name: participantName(participant, bots),
  ...(participant.kind === "bot" && participant.botId === caller.botId ? { you: true } : {}),
});

const involves = (task: OrchestrationTask, key: string) =>
  [task.owner, ...task.assignees].some(
    (participant) => participant !== null && workParticipantKey(participant) === key,
  );

/** The task tools; `listPeople` is the organization's members, an empty list when unreadable. */
export const makeTaskToolRuntime = (
  listPeople: () => Effect.Effect<ReadonlyArray<AccountPerson>>,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<
      ProjectionSnapshotQuery | OrchestrationEngineService | ActivityStore
    >();

    const readModel = Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (query) =>
      query.getCommandReadModel(),
    ).pipe(Effect.mapError(() => new TaskToolError({ detail: "Could not read the tasks." })));

    const requireTask = (model: OrchestrationReadModel, taskId: string) => {
      const task = (model.tasks ?? []).find((candidate) => candidate.id === taskId);

      return task ? Effect.succeed(task) : fail("That task doesn't exist.");
    };

    /** `me`, `bot:…` or `person:…` as a participant; people come from the organization's members. */
    const resolve = (caller: TaskToolCaller, model: OrchestrationReadModel, ref: string) =>
      Effect.gen(function* () {
        if (ref === "me") return { kind: "bot" as const, botId: caller.botId };

        const [kind, ...rest] = ref.split(":");
        const id = rest.join(":");

        if (kind === "bot") {
          const bot = model.bots.find((candidate) => candidate.id === id);

          if (bot === undefined) return yield* fail(`No bot has the key '${ref}'.`);

          return { kind: "bot" as const, botId: BotId.make(bot.id) };
        }

        const people = yield* listPeople();

        const person = people.find((candidate) => candidate.userId === id);

        if (kind !== "person" || person === undefined) {
          return yield* fail(`No one in the organization has the key '${ref}'.`);
        }

        return {
          kind: "person" as const,
          personId: AuthSessionId.make(person.userId),
          displayName: person.displayName,
        };
      });

    const resolveAll = (
      caller: TaskToolCaller,
      model: OrchestrationReadModel,
      refs: ReadonlyArray<string> | undefined,
    ) =>
      refs === undefined
        ? Effect.succeed(undefined)
        : Effect.forEach(refs, (ref) => resolve(caller, model, ref));

    const summarize = (
      model: OrchestrationReadModel,
      caller: TaskToolCaller,
      task: OrchestrationTask,
    ) => ({
      taskId: task.id,
      title: task.title,
      status: task.status,
      project: model.projects.find((project) => project.id === task.projectId)?.title ?? null,
      projectId: task.projectId,
      owner: task.owner ? describeParticipant(task.owner, model.bots, caller) : null,
      assignees: task.assignees.map((participant) =>
        describeParticipant(participant, model.bots, caller),
      ),
      dueDate: task.dueDate,
      updatedAt: task.updatedAt,
    });

    const list = (caller: TaskToolCaller, input: Input<"ListTasks">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const statuses = input.status;
        const query = input.query?.toLowerCase();

        const assignee =
          input.assignee === undefined
            ? undefined
            : workParticipantKey(yield* resolve(caller, model, input.assignee));

        const matching = (model.tasks ?? [])
          .filter((task) =>
            statuses === undefined ? task.status !== "archived" : statuses.includes(task.status),
          )
          .filter((task) => input.projectId === undefined || task.projectId === input.projectId)
          .filter((task) => assignee === undefined || involves(task, assignee))
          .filter((task) => query === undefined || task.title.toLowerCase().includes(query))
          .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

        const people = yield* listPeople();

        // Otto: The projects and people to pick from, so a task can go anywhere and to anyone.
        return {
          tasks: matching
            .slice(0, input.limit ?? LIST_DEFAULT)
            .map((task) => summarize(model, caller, task)),
          total: matching.length,
          projects: model.projects
            .filter((project) => project.deletedAt === null && project.status !== "archived")
            .map((project) => ({ projectId: project.id, title: project.title })),
          people: people.map((person) => ({
            key: `person:${person.userId}`,
            name: person.displayName,
          })),
        };
      });

    const describeEntry = (
      model: OrchestrationReadModel,
      entry: ActivityEntry,
      people: ReadonlyMap<string, string>,
    ) => {
      const by =
        entry.actor === null
          ? null
          : entry.actor.type === "bot"
            ? (model.bots.find((bot) => bot.id === entry.actor?.id)?.name ?? "A bot")
            : (people.get(entry.actor.id) ?? "Someone");

      const base = { type: entry.type, by, at: entry.createdAt };

      switch (entry.type) {
        case "comment":
          return { ...base, content: entry.content, fileIds: entry.fileIds };
        case "changed":
          return { ...base, changed: Object.keys(entry.changes) };
        case "time_logged":
          return { ...base, minutes: Math.round(entry.duration / 60_000) };
        default:
          return base;
      }
    };

    const read = (caller: TaskToolCaller, input: { readonly taskId: string }) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const task = yield* requireTask(model, input.taskId);

        const { entries } = yield* (yield* ActivityStore)
          .list({ entityType: "task", entityId: task.id })
          .pipe(
            Effect.mapError(
              () => new TaskToolError({ detail: "Could not read the task's activity." }),
            ),
          );

        const people = new Map(
          (yield* listPeople()).map((person) => [person.userId, person.displayName]),
        );

        return {
          ...summarize(model, caller, task),
          description: task.description,
          resources: task.resources,
          createdAt: task.createdAt,
          activity: entries
            .slice(-ACTIVITY_SHOWN)
            .map((entry) => describeEntry(model, entry, people)),
        };
      });

    const dispatch = (command: Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0]) =>
      Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) =>
        engine.dispatch(command),
      ).pipe(Effect.mapError((error) => new TaskToolError({ detail: error.message })));

    const by = (caller: TaskToolCaller) => ({ type: "bot" as const, id: caller.botId });

    const create = (caller: TaskToolCaller, input: Input<"task_create">) =>
      Effect.gen(function* () {
        const model = yield* readModel;

        const projectId: ProjectId | undefined =
          input.projectId ??
          Option.getOrUndefined(
            yield* Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (query) =>
              query.getThreadShellById(caller.threadId),
            ).pipe(Effect.orElseSucceed(() => Option.none())),
          )?.projectId;

        if (projectId === undefined) return yield* fail("Pass the projectId to put the task in.");

        const taskId = TaskId.make(NodeCrypto.randomUUID());
        const assignees = yield* resolveAll(caller, model, input.assignees);

        yield* dispatch({
          type: "task.create",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId,
          projectId,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          by: by(caller),
          createdAt: yield* nowIso,
        });

        const next = yield* readModel;

        return { created: true, ...summarize(next, caller, yield* requireTask(next, taskId)) };
      });

    const update = (caller: TaskToolCaller, input: Input<"task_update">) =>
      Effect.gen(function* () {
        const model = yield* readModel;

        yield* requireTask(model, input.taskId);

        const assignees = yield* resolveAll(caller, model, input.assignees);

        yield* dispatch({
          type: "task.update",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: input.taskId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          by: by(caller),
        });

        const next = yield* readModel;

        return {
          updated: true,
          ...summarize(next, caller, yield* requireTask(next, input.taskId)),
        };
      });

    const comment = (caller: TaskToolCaller, input: Input<"task_comment">) =>
      Effect.gen(function* () {
        const commentId = NodeCrypto.randomUUID();

        yield* dispatch({
          type: "task.comment.add",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: input.taskId,
          commentId,
          content: escapeComment(input.content),
          fileIds: [],
          by: by(caller),
          createdAt: yield* nowIso,
        });

        return { commented: true, taskId: input.taskId, commentId };
      });

    const run = <A>(
      effect: Effect.Effect<
        A,
        TaskToolError,
        ProjectionSnapshotQuery | OrchestrationEngineService | ActivityStore
      >,
    ) =>
      effect.pipe(
        Effect.catch((error: TaskToolError) => Effect.succeed({ error: error.detail })),
        Effect.provide(context),
      );

    return {
      list: (caller: TaskToolCaller, input: Input<"ListTasks">) => run(list(caller, input)),
      read: (caller: TaskToolCaller, input: Input<"task_read">) => run(read(caller, input)),
      create: (caller: TaskToolCaller, input: Input<"task_create">) => run(create(caller, input)),
      update: (caller: TaskToolCaller, input: Input<"task_update">) => run(update(caller, input)),
      comment: (caller: TaskToolCaller, input: Input<"task_comment">) =>
        run(comment(caller, input)),
    };
  });

/** Comments are stored with `<`, `>` and `&` escaped, so a bot's plain text can't forge a mention. */
export const escapeComment = (text: string) =>
  text.trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export type TaskToolRuntimeShape = Effect.Success<ReturnType<typeof makeTaskToolRuntime>>;

let activeTaskToolRuntime: TaskToolRuntimeShape | undefined;

/** The running task tool runtime, published for tool handlers the way the Library's is. */
export const activeTaskTools = () => activeTaskToolRuntime;

export const layer = Layer.effectDiscard(
  Effect.flatMap(Effect.service(OrganizationAccounts), (accounts) =>
    makeTaskToolRuntime(() => accounts.listPeople().pipe(Effect.orElseSucceed(() => []))),
  ).pipe(
    Effect.flatMap((runtime) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          activeTaskToolRuntime = runtime;
        }),
        () =>
          Effect.sync(() => {
            if (activeTaskToolRuntime === runtime) activeTaskToolRuntime = undefined;
          }),
      ),
    ),
  ),
);
