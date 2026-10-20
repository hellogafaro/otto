import {
  type ActivityEntry,
  type Actor,
  AuthSessionId,
  BotId,
  type BotId as BotIdType,
  type OrchestrationBot,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type TaskTimeEntry,
  type ThreadId,
  type WorkParticipant,
  type WorkResource,
  workParticipantKey,
} from "@otto/contracts";

import type { AccountPerson } from "../auth/organization-accounts-runtime.ts";

/** The bot calling a task tool, and the chat it runs in. */
export interface TaskToolCaller {
  readonly threadId: ThreadId;
  readonly botId: BotIdType;
}

/** A key resolved to someone, or why it names no one the tool can use. */
export type Resolved<A> = { readonly participant: A } | { readonly reason: string };

export const minutesOf = (duration: number) => Math.round(duration / 60_000);

const participantName = (participant: WorkParticipant, bots: ReadonlyArray<OrchestrationBot>) =>
  participant.kind === "person"
    ? participant.displayName
    : (bots.find((bot) => bot.id === participant.botId)?.name ?? "A bot");

/** Someone on a task as the bot sees them: a name, and the key to hand back to the tools. */
export const describeParticipant = (
  participant: WorkParticipant,
  bots: ReadonlyArray<OrchestrationBot>,
  caller: TaskToolCaller,
) => ({
  key: workParticipantKey(participant),
  name: participantName(participant, bots),
  ...(participant.kind === "bot" && participant.botId === caller.botId ? { you: true } : {}),
});

export const involves = (task: OrchestrationTask, key: string) =>
  [task.owner, ...task.assignees].some(
    (participant) => participant !== null && workParticipantKey(participant) === key,
  );

export const resourceKey = (resource: WorkResource) =>
  resource.type === "link" ? `link:${resource.url}` : `${resource.type}:${resource.id}`;

/** Comments are stored with `<`, `>` and `&` escaped, so a bot's plain text can't forge a mention. */
export const escapeComment = (text: string) =>
  text.trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const PERSON_MENTION = /@person:([A-Za-z0-9_-]+)/g;

/**
 * A bot's comment as stored: its text escaped, and each `@person:<key>` of someone in the
 * organization turned into a mention, which notifies them as a person's mention does. Bots
 * aren't mentioned, so bots can't wake each other in a loop.
 */
export const botComment = (text: string, people: ReadonlyArray<AccountPerson>) =>
  escapeComment(text).replace(PERSON_MENTION, (token, id: string) => {
    const person = people.find((candidate) => candidate.userId === id);

    return person === undefined
      ? token
      : `<mention type="person" id="${person.userId}">${escapeComment(person.displayName)}</mention>`;
  });

const personName = (all: ReadonlyArray<AccountPerson>, id: string) =>
  all.find((person) => person.userId === id)?.displayName ?? "Someone";

export const describeActor = (
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  actor: Actor | null,
) =>
  actor === null
    ? null
    : actor.type === "bot"
      ? {
          key: `bot:${actor.id}`,
          name: model.bots.find((bot) => bot.id === actor.id)?.name ?? "A bot",
        }
      : { key: `person:${actor.id}`, name: personName(all, actor.id) };

/** `me`, `bot:…` or `person:…` as a participant, or why it names no one. */
export const resolveRef = (
  caller: TaskToolCaller,
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  ref: string,
): Resolved<WorkParticipant> => {
  if (ref === "me") return { participant: { kind: "bot", botId: caller.botId } };

  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");

  if (kind === "bot") {
    const bot = model.bots.find((candidate) => candidate.id === id);

    return bot === undefined
      ? { reason: `no bot has the key ${ref}` }
      : { participant: { kind: "bot", botId: BotId.make(bot.id) } };
  }

  const person = all.find((candidate) => candidate.userId === id);

  return kind !== "person" || person === undefined
    ? { reason: `no one in the organization has the key ${ref}` }
    : {
        participant: {
          kind: "person",
          personId: AuthSessionId.make(person.userId),
          displayName: person.displayName,
        },
      };
};

/** A person's key as a person, or why it can't be one: a bot, `me` for a bot, or no one. */
export const resolvePerson = (
  caller: TaskToolCaller,
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  ref: string,
): Resolved<Extract<WorkParticipant, { kind: "person" }>> => {
  if (ref === "me") return { reason: `"me" is you, a bot; give a person key` };

  const resolved = resolveRef(caller, model, all, ref);

  if ("reason" in resolved) return resolved;

  return resolved.participant.kind === "bot"
    ? { reason: `${ref} is a bot; this must be a person` }
    : { participant: resolved.participant };
};

export const describeResource = (
  model: OrchestrationReadModel,
  files: ReadonlyMap<string, string>,
  resource: WorkResource,
) => {
  switch (resource.type) {
    case "link":
      return { type: "url" as const, url: resource.url, title: resource.title };
    case "task":
      return {
        type: "task" as const,
        linkedTaskId: resource.id,
        title:
          (model.tasks ?? []).find((task) => task.id === resource.id)?.title ?? "A deleted task",
      };
    case "project":
      return {
        type: "project" as const,
        linkedProjectId: resource.id,
        title:
          model.projects.find((project) => project.id === resource.id)?.title ??
          "A deleted project",
      };
    case "file":
      return {
        type: "file" as const,
        fileId: resource.id,
        title: files.get(resource.id) ?? "A Library file you can't see",
      };
  }
};

export const summarize = (
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  caller: TaskToolCaller,
  task: OrchestrationTask,
) => ({
  taskId: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  project: model.projects.find((project) => project.id === task.projectId)?.title ?? null,
  projectId: task.projectId,
  owner: task.owner ? describeParticipant(task.owner, model.bots, caller) : null,
  assignees: task.assignees.map((participant) =>
    describeParticipant(participant, model.bots, caller),
  ),
  dueDate: task.dueDate,
  repeat: task.repeat,
  completedAt: task.completedAt,
  completedBy: describeActor(model, all, task.completedBy),
  updatedAt: task.updatedAt,
});

export const describeEntry = (
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  entry: ActivityEntry,
) => {
  const base = {
    id: entry.id,
    type: entry.type,
    by: describeActor(model, all, entry.actor),
    at: entry.createdAt,
  };

  switch (entry.type) {
    case "comment":
      return {
        ...base,
        content: entry.content,
        fileIds: entry.fileIds,
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      };
    case "changed":
      return { ...base, changes: entry.changes };
    case "time_logged":
    case "time_deleted":
      return {
        ...base,
        minutes: minutesOf(entry.duration),
        ...(entry.personId
          ? { person: describeActor(model, all, { type: "person", id: entry.personId }) }
          : {}),
        ...(entry.date ? { date: entry.date } : {}),
        note: entry.description,
      };
    case "comment_updated":
      return { ...base, commentId: entry.commentId, previousContent: entry.previousContent };
    case "comment_deleted":
      return { ...base, commentId: entry.commentId, content: entry.content };
    default:
      return base;
  }
};

export const describeTimeEntry = (
  model: OrchestrationReadModel,
  all: ReadonlyArray<AccountPerson>,
  entry: TaskTimeEntry,
) => ({
  entryId: entry.id,
  taskId: entry.taskId,
  person: describeActor(model, all, { type: "person", id: entry.personId }),
  minutes: minutesOf(entry.duration),
  date: entry.date,
  note: entry.description,
  createdBy: describeActor(model, all, entry.createdBy),
  createdAt: entry.createdAt,
});
