import {
  type Actor,
  isGroupPersonMember,
  type NotificationType,
  type OrchestrationEvent,
  type OrchestrationTask,
  type TaskChanges,
  type WorkParticipant,
} from "@otto/contracts";
import { makeDrainableWorker } from "@otto/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ActivityStore } from "../activity/activity-store.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { forkParked } from "../server-activation.ts";
import { commentText, repliedComment } from "../tasks/task-work-reactor.ts";
import { type NotificationRow, NotificationStore } from "./notification-store.ts";

const EXCERPT_LENGTH = 200;

const excerpt = (text: string) => text.replaceAll(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH);

const MENTION = /<mention type="([^"]*)" id="([^"]*)">[^<]*<\/mention>/g;

const peopleOf = (participants: ReadonlyArray<WorkParticipant | null>) =>
  participants.flatMap((participant) =>
    participant?.kind === "person" ? [String(participant.personId)] : [],
  );

const isActor = (actor: Actor | null | undefined, personId: string) =>
  actor?.type === "person" && actor.id === personId;

/** Who hears about a task change: people newly given the task, never the person who gave it. */
export const taskChangeRecipients = (input: {
  readonly task: Pick<OrchestrationTask, "owner" | "assignees">;
  readonly actor: Actor | undefined;
  /** Undefined for a new task. */
  readonly changes: TaskChanges | undefined;
  readonly created: boolean;
}): ReadonlyArray<{ readonly personId: string; readonly type: NotificationType }> => {
  const { task, actor, changes } = input;

  const owner =
    task.owner?.kind === "person" &&
    (input.created || changes?.owner !== undefined) &&
    !isActor(actor, task.owner.personId)
      ? [String(task.owner.personId)]
      : [];

  const before = input.created ? [] : peopleOf(changes?.assignees?.from ?? task.assignees);

  const assigned = peopleOf(task.assignees).filter(
    (personId) =>
      !before.includes(personId) && !owner.includes(personId) && !isActor(actor, personId),
  );

  return [
    ...owner.map((personId) => ({ personId, type: "owner" as const })),
    ...assigned.map((personId) => ({ personId, type: "assigned" as const })),
  ];
};

/**
 * Who hears about a comment, each once with the strongest reason: people it mentions, the
 * author of the comment it answers, then the task's owner and assignees. Never its author.
 */
export const commentRecipients = (input: {
  readonly content: string;
  readonly actor: Actor;
  readonly repliedAuthor: Actor | null;
  readonly participants: ReadonlyArray<WorkParticipant | null>;
}): ReadonlyArray<{ readonly personId: string; readonly type: NotificationType }> => {
  const reasons = new Map<string, NotificationType>();

  const add = (personId: string, type: NotificationType) => {
    if (!reasons.has(personId) && !isActor(input.actor, personId)) reasons.set(personId, type);
  };

  for (const [, type, id] of input.content.matchAll(MENTION)) {
    if (type === "person" && id) add(id, "mention");
  }

  if (input.repliedAuthor?.type === "person") add(input.repliedAuthor.id, "reply");

  for (const personId of peopleOf(input.participants)) add(personId, "comment");

  return [...reasons].map(([personId, type]) => ({ personId, type }));
};

/** The group people a chat message @mentions by name, except its author. */
export const chatMentionRecipients = (input: {
  readonly text: string;
  readonly authorPersonId: string;
  readonly people: ReadonlyArray<{ readonly personId: string; readonly displayName: string }>;
}) =>
  input.people.flatMap((person) => {
    if (person.personId === input.authorPersonId) return [];

    const name = person.displayName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(`(^|[^\\p{L}\\p{N}_])@${name}(?![\\p{L}\\p{N}_])`, "iu").test(input.text)
      ? [person.personId]
      : [];
  });

export interface NotificationReactorShape {
  /** Start turning task and chat events into people's notifications. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /** Resolves when every received event has been handled. For tests. */
  readonly drain: Effect.Effect<void>;
}

export class NotificationReactor extends Context.Service<
  NotificationReactor,
  NotificationReactorShape
>()("@otto/server/notifications/notification-reactor/NotificationReactor") {}

/**
 * Otto: Writes a notification for each person a live task or chat event is about: a task given
 * to them, a comment that mentions them, answers them or lands on their task, and a group chat
 * message that @mentions them. Only live events count, so history never floods anyone.
 */
export const makeNotificationReactor = (
  commentAuthor: (commentId: string) => Effect.Effect<Actor | null>,
) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery;
    const store = yield* NotificationStore;

    const write = (
      event: OrchestrationEvent,
      recipients: ReadonlyArray<{ readonly personId: string; readonly type: NotificationType }>,
      fields: Omit<NotificationRow, "id" | "personId" | "type" | "createdAt">,
    ) =>
      Effect.forEach(
        recipients,
        ({ personId, type }) =>
          store.insert({
            ...fields,
            id: `${event.eventId}:${personId}`,
            personId,
            type,
            createdAt: event.occurredAt,
          }),
        { discard: true },
      );

    const process = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (event.type === "task.created" || event.type === "task.updated") {
        const { task } = event.payload;

        const recipients = taskChangeRecipients({
          task,
          actor: event.payload.actor,
          changes: event.type === "task.updated" ? event.payload.changes : undefined,
          created: event.type === "task.created",
        });

        return yield* write(event, recipients, {
          actor: event.payload.actor ?? null,
          entityType: "task",
          entityId: task.id,
          title: task.title,
          excerpt: "",
        });
      }

      if (event.type === "task.comment-created") {
        const { task, comment } = event.payload;
        const replied = repliedComment(comment.content);

        const recipients = commentRecipients({
          content: comment.content,
          actor: comment.actor,
          repliedAuthor: replied === undefined ? null : yield* commentAuthor(replied),
          participants: [task.owner, ...task.assignees],
        });

        return yield* write(event, recipients, {
          actor: comment.actor,
          entityType: "task",
          entityId: task.id,
          title: task.title,
          excerpt: excerpt(
            commentText(comment.content).replaceAll(/\s\((task|project)Id: [^)]*\)/g, ""),
          ),
        });
      }

      if (event.type !== "thread.message-sent") return;

      const message = event.payload;

      if (message.role !== "user" || message.streaming || !message.authorPersonId) return;

      const thread = Option.getOrUndefined(yield* projection.getThreadShellById(message.threadId));

      if (thread?.groupId == null || !projection.getGroupById) return;

      const group = Option.getOrUndefined(yield* projection.getGroupById(thread.groupId));

      const recipients = chatMentionRecipients({
        text: message.text,
        authorPersonId: message.authorPersonId,
        people: (group?.members ?? []).filter(isGroupPersonMember),
      }).map((personId) => ({ personId, type: "chat_mention" as const }));

      yield* write(event, recipients, {
        actor: { type: "person", id: message.authorPersonId },
        entityType: "chat",
        entityId: message.threadId,
        title: thread.title,
        excerpt: excerpt(message.text),
      });
    });

    const worker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
      process(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("notification failed", { cause })),
      ),
    );

    const start: NotificationReactorShape["start"] = Effect.fn("NotificationReactor.start")(
      function* () {
        const events = yield* engine.subscribeDomainEvents;

        yield* forkParked(
          Stream.runForEach(events, (event) =>
            event.type === "task.created" ||
            event.type === "task.updated" ||
            event.type === "task.comment-created" ||
            event.type === "thread.message-sent"
              ? worker.enqueue(event)
              : Effect.void,
          ),
        );
      },
    );

    return { start, drain: worker.drain } satisfies NotificationReactorShape;
  });

export const NotificationReactorLive = Layer.effect(
  NotificationReactor,
  Effect.flatMap(Effect.service(ActivityStore), (activity) =>
    makeNotificationReactor((commentId) =>
      activity.getComment(commentId).pipe(
        Effect.map((entry) => entry.actor),
        Effect.orElseSucceed(() => null),
      ),
    ),
  ),
);
