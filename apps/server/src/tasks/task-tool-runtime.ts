import * as NodeCrypto from "node:crypto";

import {
  canSeeLibraryItem,
  CommandId,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OttoToolInputSchemas,
  type ProjectId,
  TaskId,
  type TaskPriority,
  type WorkParticipant,
  type WorkResource,
  workParticipantKey,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { resolveBotMentions } from "@otto/shared/mention";

import { ActivityStore } from "../activity/activity-store.ts";
import { OrganizationAccounts } from "../auth/organization-accounts.ts";
import type { AccountPerson } from "../auth/organization-accounts-runtime.ts";
import { ServerSecretStore } from "../auth/server-secret-store.ts";
import { loadLibraryState } from "../library/library-store.ts";
import { LIST_CURSOR_SECRET_NAME, openListCursor, sealListCursor } from "../list-cursor.ts";
import { zonedToday } from "../orchestration/decider/tasks.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { ProjectionGroupRepository } from "../persistence/services/projection-groups.ts";
import { ProjectionLibraryRepository } from "../persistence/services/projection-library.ts";
import { ProjectionTaskRepository } from "../persistence/services/projection-tasks.ts";
import { NOT_AUTHOR, deleteTaskComment, updateTaskComment } from "./task-comments.ts";
import {
  describeActor,
  describeEntry,
  describeResource,
  describeTimeEntry,
  involves,
  minutesOf,
  resolvePerson,
  resolveRef,
  resourceKey,
  summarize,
  type TaskToolCaller,
} from "./task-tool-format.ts";

export { escapeComment, type TaskToolCaller } from "./task-tool-format.ts";

type Input<Name extends keyof typeof OttoToolInputSchemas> =
  (typeof OttoToolInputSchemas)[Name]["Type"];

/** What search asks of tasks: lowercase words, the filters, and the organization's today and week end. */
export interface TaskSearch {
  readonly terms: ReadonlyArray<string>;
  readonly status?: ReadonlyArray<OrchestrationTask["status"]> | undefined;
  readonly priority?: ReadonlyArray<TaskPriority> | undefined;
  readonly assignee?: string | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly due?: "overdue" | "today" | "this_week" | "none" | undefined;
  /** YYYY-MM-DD in the organization's time zone, and the Sunday that ends its week. */
  readonly today: string;
  readonly weekEnd: string;
}

/** Every task tool refuses with one of these codes; `fields` names each invalid field. */
type TaskToolErrorCode =
  | "invalid_fields"
  | "not_found"
  | "no_access"
  | "future_date"
  | "not_author"
  | "rejected";

interface InvalidField {
  readonly field: string;
  readonly reason: string;
}

/** A refusal the bot reads and can act on, returned as the tool's result. */
class TaskToolError extends Schema.TaggedErrorClass<TaskToolError>()("TaskToolError", {
  code: Schema.String,
  detail: Schema.String,
  fields: Schema.optional(
    Schema.Array(Schema.Struct({ field: Schema.String, reason: Schema.String })),
  ),
}) {}

const fail = (code: TaskToolErrorCode, detail: string) =>
  Effect.fail(new TaskToolError({ code, detail }));

const invalidFields = (fields: ReadonlyArray<InvalidField>) =>
  Effect.fail(
    new TaskToolError({
      code: "invalid_fields",
      detail: "Nothing changed; fix the fields listed.",
      fields,
    }),
  );

const SHOWN = 10;

const DEFAULT_LIMIT = 50;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * The task tools. `listPeople` is the organization's members, an empty list when unreadable, and
 * `timeZone` the organization's time zone.
 */
export const makeTaskToolRuntime = (services: {
  readonly listPeople: () => Effect.Effect<ReadonlyArray<AccountPerson>>;
  readonly timeZone: () => string;
}) =>
  Effect.gen(function* () {
    const { listPeople, timeZone } = services;

    const context = yield* Effect.context<
      | ProjectionSnapshotQuery
      | OrchestrationEngineService
      | ActivityStore
      | ProjectionTaskRepository
      | ServerSecretStore
      | ProjectionLibraryRepository
      | ProjectionGroupRepository
    >();

    const readModel = Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (query) =>
      query.getCommandReadModel(),
    ).pipe(
      Effect.mapError(
        () => new TaskToolError({ code: "rejected", detail: "Could not read the tasks." }),
      ),
    );

    const findTask = (model: OrchestrationReadModel, taskId: string) =>
      (model.tasks ?? []).find((candidate) => candidate.id === taskId);

    const requireTask = (model: OrchestrationReadModel, taskId: string) => {
      const task = findTask(model, taskId);

      return task ? Effect.succeed(task) : fail("not_found", `No task has the id '${taskId}'.`);
    };

    const people = Effect.suspend(listPeople);

    /** The Library files this bot can see, by id, with their titles. */
    const visibleFiles = (caller: TaskToolCaller) =>
      loadLibraryState.pipe(
        Effect.map(
          (state) =>
            new Map<string, string>(
              state.files
                .filter((file) =>
                  canSeeLibraryItem(file, state.context, { kind: "bot", botId: caller.botId }),
                )
                .map((file) => [file.id, file.title]),
            ),
        ),
        Effect.orElseSucceed(() => new Map<string, string>()),
      );

    /** Tasks that pass the filters and contain any of the words; every member sees every task. */
    const search = (caller: TaskToolCaller, input: TaskSearch) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const all = yield* people;

        const assignee =
          input.assignee === undefined ? undefined : resolveRef(caller, model, all, input.assignee);

        if (assignee !== undefined && "reason" in assignee) {
          return yield* invalidFields([{ field: "assignee", reason: assignee.reason }]);
        }

        const assigneeKey =
          assignee === undefined ? undefined : workParticipantKey(assignee.participant);

        const due = (task: OrchestrationTask) => {
          switch (input.due) {
            case undefined:
              return true;
            case "none":
              return task.dueDate === null;
            case "today":
              return task.dueDate === input.today;
            case "this_week":
              return (
                task.dueDate !== null &&
                task.dueDate >= input.today &&
                task.dueDate <= input.weekEnd
              );
            case "overdue":
              return (
                task.dueDate !== null &&
                task.dueDate < input.today &&
                task.status !== "completed" &&
                task.status !== "archived"
              );
          }
        };

        return (model.tasks ?? [])
          .filter((task) =>
            input.status === undefined
              ? task.status !== "archived"
              : input.status.includes(task.status),
          )
          .filter(
            (task) =>
              input.priority === undefined ||
              (task.priority !== null && input.priority.includes(task.priority)),
          )
          .filter((task) => input.projectId === undefined || task.projectId === input.projectId)
          .filter((task) => assigneeKey === undefined || involves(task, assigneeKey))
          .filter(due)
          .filter((task) => {
            const text = `${task.title}\n${task.description}`.toLowerCase();

            return input.terms.length === 0 || input.terms.some((term) => text.includes(term));
          })
          .map((task) => ({
            ...summarize(model, all, caller, task),
            description: task.description,
          }));
      });

    const activityFailed = Effect.mapError(
      () => new TaskToolError({ code: "rejected", detail: "Could not read the task's activity." }),
    );

    const timesheetFailed = Effect.mapError(
      () => new TaskToolError({ code: "rejected", detail: "Could not read the time entries." }),
    );

    const secret = Effect.flatMap(Effect.service(ServerSecretStore), (store) =>
      store.getOrCreateRandom(LIST_CURSOR_SECRET_NAME, 32),
    ).pipe(
      Effect.mapError(
        () => new TaskToolError({ code: "rejected", detail: "Could not page the list." }),
      ),
    );

    /** The key a cursor sealed for this same list, or a refusal for any other. */
    const openCursor = (view: string, cursor: string | undefined) =>
      Effect.gen(function* () {
        if (cursor === undefined) return null;
        const key = openListCursor(yield* secret, view, cursor);

        return key === undefined
          ? yield* invalidFields([
              {
                field: "cursor",
                reason: "this cursor is from another list; start again without it",
              },
            ])
          : key;
      });

    const read = (caller: TaskToolCaller, input: Input<"task_read">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const task = yield* requireTask(model, input.taskId);
        const all = yield* people;
        const activity = yield* ActivityStore;

        const { entries } = yield* activity
          .list({ entityType: "task", entityId: task.id })
          .pipe(activityFailed);

        const comments = yield* activity
          .listComments({ taskId: task.id, order: "newest", limit: SHOWN, after: null })
          .pipe(activityFailed);

        const timesheet = yield* (yield* ProjectionTaskRepository)
          .listTimeEntries({ filter: { taskId: task.id }, limit: SHOWN, after: null })
          .pipe(timesheetFailed);

        const files = yield* visibleFiles(caller);

        return {
          ...summarize(model, all, caller, task),
          description: task.description,
          resources: task.resources.map((resource) => describeResource(model, files, resource)),
          createdAt: task.createdAt,
          createdBy: describeActor(model, all, task.createdBy),
          updatedBy: describeActor(model, all, task.updatedBy),
          commentCount: comments.total,
          comments: comments.rows
            .slice(0, SHOWN)
            .map(({ entry }) => describeEntry(model, all, entry)),
          totalMinutes: minutesOf(timesheet.totalDuration),
          timeEntries: timesheet.rows
            .slice(0, SHOWN)
            .map(({ entry }) => describeTimeEntry(model, all, entry)),
          history: entries
            .filter((entry) => entry.type !== "comment")
            .slice(-SHOWN)
            .toReversed()
            .map((entry) => describeEntry(model, all, entry)),
        };
      });

    const dispatch = (command: Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0]) =>
      Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) =>
        engine.dispatch(command),
      ).pipe(
        Effect.mapError((error) => new TaskToolError({ code: "rejected", detail: error.message })),
      );

    const by = (caller: TaskToolCaller) => ({ type: "bot" as const, id: caller.botId });

    /**
     * The fields create and update share, resolved and checked together so one call reports
     * every invalid field at once and changes nothing until they are all right.
     */
    const resolveFields = (
      caller: TaskToolCaller,
      model: OrchestrationReadModel,
      input: Input<"task_update"> | Input<"task_create">,
    ) =>
      Effect.gen(function* () {
        const all = yield* people;
        const invalid: InvalidField[] = [];

        const assignees = input.assignees?.flatMap((ref) => {
          const resolved = resolveRef(caller, model, all, ref);

          if ("participant" in resolved) return [resolved.participant];

          invalid.push({ field: "assignees", reason: resolved.reason });

          return [];
        });

        let owner: WorkParticipant | null | undefined;

        if (input.owner === null) owner = null;
        else if (input.owner !== undefined) {
          const person = resolvePerson(caller, model, all, input.owner);

          if ("reason" in person) {
            invalid.push({
              field: "owner",
              reason: person.reason.replace("this must be a person", "owner must be a person"),
            });
          } else owner = person.participant;
        }

        if (input.projectId !== undefined) {
          const project = model.projects.find((candidate) => candidate.id === input.projectId);

          if (project === undefined || project.deletedAt !== null) {
            invalid.push({
              field: "projectId",
              reason: `no project has the id ${input.projectId}`,
            });
          }
        }

        let resources: WorkResource[] | undefined;

        if (input.resources !== undefined) {
          const files = input.resources.some((resource) => resource.type === "file")
            ? yield* visibleFiles(caller)
            : new Map<string, string>();

          const resolved = input.resources.flatMap((resource): WorkResource[] => {
            switch (resource.type) {
              case "url":
                return [{ type: "link", title: resource.title ?? resource.url, url: resource.url }];
              case "file":
                if (files.has(resource.fileId)) return [{ type: "file", id: resource.fileId }];
                invalid.push({
                  field: "resources",
                  reason: `no Library file you can see has the id ${resource.fileId}`,
                });

                return [];
              case "task":
                if (findTask(model, resource.linkedTaskId)) {
                  return [{ type: "task", id: resource.linkedTaskId }];
                }

                invalid.push({
                  field: "resources",
                  reason: `no task has the id ${resource.linkedTaskId}`,
                });

                return [];
              case "project":
                if (model.projects.some((project) => project.id === resource.linkedProjectId)) {
                  return [{ type: "project", id: resource.linkedProjectId }];
                }

                invalid.push({
                  field: "resources",
                  reason: `no project has the id ${resource.linkedProjectId}`,
                });

                return [];
            }
          });

          // Otto: the same thing linked twice is kept once.
          resources = [
            ...new Map(resolved.map((resource) => [resourceKey(resource), resource])).values(),
          ];
        }

        if (invalid.length > 0) return yield* invalidFields(invalid);

        return {
          ...(input.description !== undefined ? { description: input.description ?? "" } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...(owner !== undefined ? { owner } : {}),
          ...(resources !== undefined ? { resources } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
        };
      });

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

        if (projectId === undefined) {
          return yield* invalidFields([
            { field: "projectId", reason: "pass the projectId to put the task in" },
          ]);
        }

        const fields = yield* resolveFields(caller, model, input);
        const taskId = TaskId.make(NodeCrypto.randomUUID());

        yield* dispatch({
          type: "task.create",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId,
          projectId,
          title: input.title,
          ...fields,
          by: by(caller),
          createdAt: yield* nowIso,
        });

        const next = yield* readModel;

        return {
          created: true,
          ...summarize(next, yield* people, caller, yield* requireTask(next, taskId)),
        };
      });

    const update = (caller: TaskToolCaller, input: Input<"task_update">) =>
      Effect.gen(function* () {
        const model = yield* readModel;

        yield* requireTask(model, input.taskId);

        const fields = yield* resolveFields(caller, model, input);

        yield* dispatch({
          type: "task.update",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: input.taskId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...fields,
          by: by(caller),
          timezone: timeZone(),
        });

        const next = yield* readModel;

        return {
          updated: true,
          ...summarize(next, yield* people, caller, yield* requireTask(next, input.taskId)),
        };
      });

    const remove = (caller: TaskToolCaller, input: Input<"task_delete">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const task = yield* requireTask(model, input.taskId);

        yield* dispatch({
          type: "task.delete",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: task.id,
          by: by(caller),
        });

        return { deleted: true, taskIds: [task.id] };
      });

    /**
     * A mention tag the bot may write: a person, task, project or Library file it can see.
     * A bot tag is refused, so bots can't wake each other. An unknown id stays text.
     */
    const commentContent = (caller: TaskToolCaller, text: string) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const all = yield* people;
        const files = yield* visibleFiles(caller);

        return resolveBotMentions(text, ({ type, id }) => {
          if (type === "person") return all.find((person) => person.userId === id)?.displayName;

          if (type === "task") return findTask(model, id)?.title;

          if (type === "project") return model.projects.find((project) => project.id === id)?.title;

          return type === "library" ? files.get(id) : undefined;
        });
      });

    const createComment = (caller: TaskToolCaller, input: Input<"task_comment_create">) =>
      Effect.gen(function* () {
        yield* requireTask(yield* readModel, input.taskId);

        const commentId = NodeCrypto.randomUUID();

        yield* dispatch({
          type: "task.comment.create",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: input.taskId,
          commentId,
          content: yield* commentContent(caller, input.content),
          fileIds: [],
          by: by(caller),
          createdAt: yield* nowIso,
        });

        return { created: true, taskId: input.taskId, commentId };
      });

    const listComments = (caller: TaskToolCaller, input: Input<"task_comment_list">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const task = yield* requireTask(model, input.taskId);
        const order = input.order ?? "newest";
        const limit = input.limit ?? DEFAULT_LIMIT;
        const view = `task-comments:${task.id}:${order}`;
        const after = yield* openCursor(view, input.cursor);
        const all = yield* people;

        const page = yield* (yield* ActivityStore)
          .listComments({
            taskId: task.id,
            order,
            limit,
            after: after === null ? null : [String(after[0]), String(after[1])],
          })
          .pipe(activityFailed);

        const rows = page.rows.slice(0, limit);
        const last = rows.at(-1);

        return {
          taskId: task.id,
          commentCount: page.total,
          comments: rows.map(({ entry }) => describeEntry(model, all, entry)),
          ...(page.rows.length > limit && last
            ? { cursor: sealListCursor(yield* secret, view, [...last.key]) }
            : {}),
        };
      });

    const commentFailed = (error: { readonly detail: string }) =>
      new TaskToolError({
        code:
          error.detail === NOT_AUTHOR
            ? "not_author"
            : error.detail.includes("doesn't exist")
              ? "not_found"
              : "rejected",
        detail: error.detail,
      });

    const commentServices = Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;

      return { activityStore: yield* ActivityStore, dispatch: engine.dispatch };
    });

    const updateComment = (caller: TaskToolCaller, input: Input<"task_comment_update">) =>
      Effect.gen(function* () {
        const comment = yield* updateTaskComment(
          {
            id: input.commentId,
            content: yield* commentContent(caller, input.content),
            by: by(caller),
          },
          yield* commentServices,
        ).pipe(Effect.mapError(commentFailed));

        return { updated: true, taskId: comment.entityId, commentId: comment.id };
      });

    const deleteComment = (caller: TaskToolCaller, input: Input<"task_comment_delete">) =>
      Effect.gen(function* () {
        const deleted = yield* deleteTaskComment(
          { id: input.commentId, by: by(caller) },
          yield* commentServices,
        ).pipe(Effect.mapError(commentFailed));

        return { deleted: true, ...deleted };
      });

    const createTime = (caller: TaskToolCaller, input: Input<"task_time_create">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const task = yield* requireTask(model, input.taskId);
        const person = resolvePerson(caller, model, yield* people, input.person);

        if ("reason" in person) {
          return yield* invalidFields([{ field: "person", reason: person.reason }]);
        }

        const createdAt = yield* nowIso;
        const today = zonedToday(createdAt, timeZone());

        if (input.date !== undefined && input.date > today) {
          return yield* fail(
            "future_date",
            `${input.date} is after today, ${today}; time can't be logged ahead.`,
          );
        }

        const entryId = NodeCrypto.randomUUID();

        yield* dispatch({
          type: "task.time.create",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: task.id,
          entryId,
          duration: input.minutes * 60_000,
          ...(input.note !== undefined ? { description: input.note } : {}),
          personId: person.participant.personId,
          date: input.date ?? today,
          by: by(caller),
          timezone: timeZone(),
          createdAt,
        });

        const next = yield* readModel;

        const entry = (yield* requireTask(next, task.id)).timeEntries.find(
          (candidate) => candidate.id === entryId,
        );

        return entry === undefined
          ? yield* fail("rejected", "The entry wasn't saved.")
          : { created: true, ...describeTimeEntry(next, yield* people, entry) };
      });

    const deleteTime = (caller: TaskToolCaller, input: Input<"task_time_delete">) =>
      Effect.gen(function* () {
        const model = yield* readModel;

        const task = (model.tasks ?? []).find((candidate) =>
          candidate.timeEntries.some((entry) => entry.id === input.entryId),
        );

        if (task === undefined) {
          return yield* fail("not_found", `No time entry has the id '${input.entryId}'.`);
        }

        yield* dispatch({
          type: "task.time.delete",
          commandId: CommandId.make(`task-tool:${NodeCrypto.randomUUID()}`),
          taskId: task.id,
          entryId: input.entryId,
          by: by(caller),
        });

        return { deleted: true, taskId: task.id, entryId: input.entryId };
      });

    const listTime = (caller: TaskToolCaller, input: Input<"task_time_list">) =>
      Effect.gen(function* () {
        const model = yield* readModel;
        const all = yield* people;

        const person =
          input.person === undefined ? undefined : resolvePerson(caller, model, all, input.person);

        if (person !== undefined && "reason" in person) {
          return yield* invalidFields([{ field: "person", reason: person.reason }]);
        }

        if (input.taskId !== undefined) yield* requireTask(model, input.taskId);

        const filter = {
          taskId: input.taskId,
          personId: person?.participant.personId,
          projectId: input.projectId,
          from: input.from,
          to: input.to,
        };

        const limit = input.limit ?? DEFAULT_LIMIT;
        const view = `task-time:${[filter.taskId, filter.personId, filter.projectId, filter.from, filter.to].map((value) => value ?? "").join("|")}`;
        const after = yield* openCursor(view, input.cursor);

        const page = yield* (yield* ProjectionTaskRepository)
          .listTimeEntries({ filter, limit, after })
          .pipe(timesheetFailed);

        const rows = page.rows.slice(0, limit);
        const last = rows.at(-1);

        return {
          totalMinutes: minutesOf(page.totalDuration),
          entries: rows.map(({ entry }) => ({
            ...describeTimeEntry(model, all, entry),
            task: findTask(model, entry.taskId)?.title ?? null,
          })),
          ...(page.rows.length > limit && last
            ? { cursor: sealListCursor(yield* secret, view, [...last.key]) }
            : {}),
        };
      });

    const run = <A>(
      effect: Effect.Effect<
        A,
        TaskToolError,
        | ProjectionSnapshotQuery
        | OrchestrationEngineService
        | ActivityStore
        | ProjectionTaskRepository
        | ServerSecretStore
        | ProjectionLibraryRepository
        | ProjectionGroupRepository
      >,
    ) =>
      effect.pipe(
        Effect.catch((error: TaskToolError) =>
          Effect.succeed({
            error: error.code,
            message: error.detail,
            ...(error.fields ? { fields: error.fields } : {}),
          }),
        ),
        Effect.provide(context),
      );

    return {
      timeZone,
      search: (caller: TaskToolCaller, input: TaskSearch) => run(search(caller, input)),
      read: (caller: TaskToolCaller, input: Input<"task_read">) => run(read(caller, input)),
      create: (caller: TaskToolCaller, input: Input<"task_create">) => run(create(caller, input)),
      update: (caller: TaskToolCaller, input: Input<"task_update">) => run(update(caller, input)),
      delete: (caller: TaskToolCaller, input: Input<"task_delete">) => run(remove(caller, input)),
      createComment: (caller: TaskToolCaller, input: Input<"task_comment_create">) =>
        run(createComment(caller, input)),
      listComments: (caller: TaskToolCaller, input: Input<"task_comment_list">) =>
        run(listComments(caller, input)),
      updateComment: (caller: TaskToolCaller, input: Input<"task_comment_update">) =>
        run(updateComment(caller, input)),
      deleteComment: (caller: TaskToolCaller, input: Input<"task_comment_delete">) =>
        run(deleteComment(caller, input)),
      createTime: (caller: TaskToolCaller, input: Input<"task_time_create">) =>
        run(createTime(caller, input)),
      deleteTime: (caller: TaskToolCaller, input: Input<"task_time_delete">) =>
        run(deleteTime(caller, input)),
      listTime: (caller: TaskToolCaller, input: Input<"task_time_list">) =>
        run(listTime(caller, input)),
    };
  });

export type TaskToolRuntimeShape = Effect.Success<ReturnType<typeof makeTaskToolRuntime>>;

let activeTaskToolRuntime: TaskToolRuntimeShape | undefined;

/** The running task tool runtime, published for tool handlers the way the Library's is. */
export const activeTaskTools = () => activeTaskToolRuntime;

export const layer = Layer.effectDiscard(
  Effect.flatMap(Effect.service(OrganizationAccounts), (accounts) =>
    makeTaskToolRuntime({
      listPeople: () => accounts.listPeople().pipe(Effect.orElseSucceed(() => [])),
      timeZone: () => accounts.runtime.timeZone(),
    }),
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
