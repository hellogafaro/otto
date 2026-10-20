import {
  canSeeBot,
  canSeeDirectChat,
  canSeeLibraryItem,
  type DirectChatAccess,
  canUseMcpServer,
  isGroupPersonMember,
  type LibraryFile,
  type LibraryFolder,
  type LibraryVisibilityContext,
  type AuthSessionId,
  type BotId,
  type GroupId,
  type GroupMembership,
  type OrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type Routine,
  type ThreadId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { ProjectionBotRepository } from "../persistence/services/projection-bots.ts";
import type { ProjectionGroupRepository } from "../persistence/services/projection-groups.ts";
import type { LibraryChatThread } from "../persistence/services/projection-library.ts";
import type { ProjectionThreadMessageRepository } from "../persistence/services/projection-thread-messages.ts";
import type { ProjectionSnapshotQuery } from "./services/projection-snapshot-query.ts";

interface GroupMembers {
  readonly id: GroupId;
  readonly members: ReadonlyArray<GroupMembership>;
}

/**
 * A group chat is private to the people in it. A group with no people at all predates
 * people in groups, so everyone keeps seeing it.
 */
export function canSeeGroup(group: GroupMembers, personId: AuthSessionId): boolean {
  const people = group.members.filter(isGroupPersonMember);

  return people.length === 0 || people.some((person) => person.personId === personId);
}

/** Whether a thread is readable: a DM its creator shares or made, or a visible group's chat. */
export function canSeeThread(
  thread: DirectChatAccess & { readonly groupId?: GroupId | null | undefined },
  groups: ReadonlyArray<GroupMembers>,
  personId: AuthSessionId,
): boolean {
  if (thread.groupId == null) return canSeeDirectChat(thread, { kind: "person", personId });
  const group = groups.find((candidate) => candidate.id === thread.groupId);

  return group === undefined || canSeeGroup(group, personId);
}

/** Otto: A private routine, like a private DM, is seen by its creator and its bot only. */
export const canSeeRoutine = (
  routine: Pick<Routine, "createdBy" | "botId" | "visibility">,
  personId: AuthSessionId,
) => canSeeDirectChat(routine, { kind: "person", personId });

type ChatShell = DirectChatAccess & {
  readonly id: ThreadId;
  readonly groupId?: GroupId | null | undefined;
  readonly respondingBotId?: BotId | null | undefined;
  readonly parentThreadId?: ThreadId | null | undefined;
};

/**
 * Otto: The people a bot's answer in a chat reaches: a DM's person (both, in a person DM), or a group's people. A
 * group with no people predates people in groups and names no one.
 */
export function chatPeople(
  thread: ChatShell,
  groups: ReadonlyArray<GroupMembers>,
): ReadonlyArray<AuthSessionId> {
  if (thread.groupId == null) {
    return [thread.createdBy, thread.personId].filter((personId) => personId != null);
  }

  return (
    groups
      .find((group) => group.id === thread.groupId)
      ?.members.filter(isGroupPersonMember)
      .map((person) => person.personId) ?? []
  );
}

/**
 * Otto: The top-level chats other than `exceptId` a bot is in that every one of `people` may
 * read; what the bot finds there is safe to repeat to all of them.
 */
export function chatsSeenByAll<Thread extends ChatShell>(
  snapshot: {
    readonly threads: ReadonlyArray<Thread>;
    readonly groups: ReadonlyArray<GroupMembers>;
  },
  botId: BotId,
  people: ReadonlyArray<AuthSessionId>,
  exceptId: ThreadId,
): ReadonlyArray<Thread> {
  const botIn = (thread: Thread) =>
    thread.groupId == null
      ? thread.botId === botId || thread.respondingBotId === botId
      : (snapshot.groups
          .find((group) => group.id === thread.groupId)
          ?.members.some((member) => member.kind === "bot" && member.botId === botId) ?? false);

  return snapshot.threads.filter(
    (thread) =>
      thread.id !== exceptId &&
      thread.parentThreadId == null &&
      botIn(thread) &&
      people.every((personId) => canSeeThread(thread, snapshot.groups, personId)),
  );
}

interface ThreadVisibilityServices {
  readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly projectionGroups: ProjectionGroupRepository["Service"];
}

/**
 * Whether a person may read a chat, archived or not. An unknown chat is left to its own
 * checks unless `unknown` says otherwise.
 */
export const canSeeThreadById = (
  services: ThreadVisibilityServices,
  threadId: ThreadId,
  personId: AuthSessionId,
  unknown = true,
) =>
  Effect.gen(function* () {
    const thread = yield* services.projectionSnapshotQuery
      .getThreadShellById(threadId, { includeArchived: true })
      .pipe(Effect.orElseSucceed(() => Option.none()));

    if (Option.isNone(thread)) return unknown;

    const group =
      thread.value.groupId == null
        ? Option.none()
        : yield* services.projectionGroups
            .getById({ groupId: thread.value.groupId })
            .pipe(Effect.orElseSucceed(() => Option.none()));

    const groups = Option.match(group, {
      onNone: () => [],
      onSome: (found) => [{ id: found.groupId, members: found.members }],
    });

    return canSeeThread(thread.value, groups, personId);
  });

/**
 * Otto: A chat attachment is readable by the person who sent it, and by its chat's people
 * while they can see that chat. An attachment no message carries is readable by no one.
 * Returns the name and type the message gave it, so its download keeps them; null if unreadable.
 */
export const readableAttachment = (
  services: ThreadVisibilityServices & {
    readonly projectionThreadMessages: ProjectionThreadMessageRepository["Service"];
  },
  attachmentId: string,
  personId: AuthSessionId,
) =>
  Effect.gen(function* () {
    const messages = yield* services.projectionThreadMessages
      .listAttachmentMessages({ attachmentId })
      .pipe(Effect.orElseSucceed(() => []));

    const own = messages.find((message) => message.authorPersonId === personId);

    if (own) return { name: own.name, mimeType: own.mimeType };

    for (const message of messages) {
      if (yield* canSeeThreadById(services, message.threadId, personId, false)) {
        return { name: message.name, mimeType: message.mimeType };
      }
    }

    return null;
  });

/** Whether a person may read a chat attachment; see `readableAttachment`. */
export const canReadAttachment = (
  services: Parameters<typeof readableAttachment>[0],
  attachmentId: string,
  personId: AuthSessionId,
) =>
  readableAttachment(services, attachmentId, personId).pipe(
    Effect.map((attachment) => attachment !== null),
  );

/** The bots a command names, which a person must be able to see to send it. */
export function commandBotIds(command: OrchestrationCommand): ReadonlyArray<BotId> {
  const ids: Array<BotId> = [];

  if ("botId" in command && command.botId != null) ids.push(command.botId);

  if ("respondingBotId" in command && command.respondingBotId != null) {
    ids.push(command.respondingBotId);
  }

  return ids;
}

/** Whether a person may see every bot a command names. An unknown bot is left to the decider. */
export const canSeeCommandBots = (
  services: {
    readonly projectionBots: ProjectionBotRepository["Service"];
    readonly projectionGroups: ProjectionGroupRepository["Service"];
  },
  command: OrchestrationCommand,
  personId: AuthSessionId,
) =>
  Effect.gen(function* () {
    const ids = commandBotIds(command);

    if (ids.length === 0) return true;

    const groups = yield* services.projectionGroups.listAll().pipe(Effect.orElseSucceed(() => []));

    for (const botId of ids) {
      const bot = yield* services.projectionBots
        .getById({ botId })
        .pipe(Effect.orElseSucceed(() => Option.none()));

      if (Option.isSome(bot) && !canSeeBot({ ...bot.value, id: botId }, groups, personId)) {
        return false;
      }
    }

    return true;
  });

const libraryContext = (
  folders: ReadonlyArray<LibraryFolder>,
  groups: ReadonlyArray<GroupMembers>,
  chatThreads: ReadonlyArray<LibraryChatThread>,
): LibraryVisibilityContext => ({ folders, threads: chatThreads, groups });

export function visibleShellSnapshot(
  snapshot: OrchestrationShellSnapshot,
  personId: AuthSessionId,
): OrchestrationShellSnapshot {
  const groups = snapshot.groups.filter((group) => canSeeGroup(group, personId));

  // Someone else's personal MCP server stays out of sight; their bots still use it.
  const mcp = snapshot.mcpServers
    ? { mcpServers: snapshot.mcpServers.filter((server) => canUseMcpServer(server, personId)) }
    : {};

  return {
    ...snapshot,
    ...mcp,
    groups,
    bots: snapshot.bots.filter((bot) => canSeeBot(bot, snapshot.groups, personId)),
    threads: snapshot.threads.filter((thread) => canSeeThread(thread, snapshot.groups, personId)),
  };
}

/**
 * Filters one person's shell stream. When a membership change shows or hides a group for
 * them, the stream sends a fresh filtered snapshot so its threads appear or disappear too.
 * A Library folder they stop seeing arrives as its removal, which drops what is under it.
 */
export function withGroupVisibility<E, R>(input: {
  readonly stream: Stream.Stream<OrchestrationShellStreamItem, E, R>;
  readonly personId: AuthSessionId;
  readonly loadSnapshot: Effect.Effect<OrchestrationShellSnapshot, E, R>;
  readonly loadChatThreads: Effect.Effect<ReadonlyArray<LibraryChatThread>, E, R>;
  readonly loadLibraryFolders: Effect.Effect<ReadonlyArray<LibraryFolder>, E, R>;
  /**
   * Resuming clients may hold groups cached before they were hidden. Otto: Set only when the
   * stream replays events instead of opening with a snapshot, which seeds the filter itself.
   */
  readonly resuming: boolean;
}): Effect.Effect<Stream.Stream<OrchestrationShellStreamItem, E, R>, E, R> {
  return Effect.gen(function* () {
    const { personId } = input;
    let chatThreads: ReadonlyArray<LibraryChatThread> = [];
    const groups = new Map<GroupId, GroupMembers>();
    let folders: ReadonlyArray<LibraryFolder> = [];
    const bots = new Map<BotId, OrchestrationShellSnapshot["bots"][number]>();

    const visibleBotIds = () =>
      [...bots.values()]
        .flatMap((bot) => (canSeeBot(bot, [...groups.values()], personId) ? [bot.id] : []))
        .join();

    const visible = (groupId: GroupId) => {
      const group = groups.get(groupId);

      return group === undefined || canSeeGroup(group, personId);
    };

    const remember = (snapshot: OrchestrationShellSnapshot) => {
      groups.clear();

      for (const group of snapshot.groups) groups.set(group.id, group);
      bots.clear();

      for (const bot of snapshot.bots) bots.set(bot.id, bot);

      return visibleShellSnapshot(snapshot, personId);
    };

    const loadLibrary = Effect.all([input.loadChatThreads, input.loadLibraryFolders]).pipe(
      Effect.map(([threads, libraryFolders]) => {
        chatThreads = threads;
        folders = libraryFolders;
      }),
    );

    const fresh = Effect.all([input.loadSnapshot, loadLibrary]).pipe(
      Effect.map(
        ([snapshot]): ReadonlyArray<OrchestrationShellStreamItem> => [
          { kind: "snapshot", snapshot: remember(snapshot) },
        ],
      ),
    );

    const canSeeLibrary = (item: LibraryFolder | LibraryFile) =>
      canSeeLibraryItem(item, libraryContext(folders, [...groups.values()], chatThreads), {
        kind: "person",
        personId,
      });

    const isChatThread = (threadId: string) => chatThreads.some((thread) => thread.id === threadId);

    const filter = (
      item: OrchestrationShellStreamItem,
    ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, E, R> => {
      switch (item.kind) {
        case "snapshot":
          return loadLibrary.pipe(
            Effect.map(() => [{ kind: "snapshot", snapshot: remember(item.snapshot) }]),
          );
        case "group-upserted": {
          const before = visible(item.group.id);
          const botsBefore = visibleBotIds();
          groups.set(item.group.id, item.group);
          const after = visible(item.group.id);

          if (before !== after || botsBefore !== visibleBotIds()) return fresh;

          return Effect.succeed(after ? [item] : []);
        }

        case "group-removed": {
          const botsBefore = visibleBotIds();
          groups.delete(item.groupId);

          if (
            chatThreads.some((thread) => thread.groupId === item.groupId) ||
            botsBefore !== visibleBotIds()
          ) {
            return fresh;
          }

          return Effect.succeed([item]);
        }

        // Otto: A hidden group's chat stays unsent; a chat made private leaves everyone
        // else's list, since they may already hold it.
        case "thread-upserted":
          if (canSeeThread(item.thread, [...groups.values()], personId)) {
            return Effect.succeed([item]);
          }

          return Effect.succeed(
            item.thread.groupId == null
              ? [{ kind: "thread-removed", sequence: item.sequence, threadId: item.thread.id }]
              : [],
          );
        case "thread-removed":
          return isChatThread(item.threadId) ? fresh : Effect.succeed([item]);
        // Otto: A folder that leaves someone's sight is sent to them as removed; one they never
        // saw stays unsent.
        case "library-folder-upserted": {
          const previous = folders.find((folder) => folder.id === item.folder.id);
          const before = previous !== undefined && canSeeLibrary(previous);
          folders = [...folders.filter((folder) => folder.id !== item.folder.id), item.folder];

          if (canSeeLibrary(item.folder)) return Effect.succeed([item]);

          return Effect.succeed(
            before
              ? [
                  {
                    kind: "library-folder-removed",
                    sequence: item.sequence,
                    folderId: item.folder.id,
                  },
                ]
              : [],
          );
        }

        case "library-folder-removed":
          folders = folders.filter((folder) => folder.id !== item.folderId);

          return Effect.succeed([item]);
        case "bot-upserted":
          bots.set(item.bot.id, item.bot);

          return Effect.succeed(
            canSeeBot(item.bot, [...groups.values()], personId)
              ? [item]
              : [{ kind: "bot-removed", sequence: item.sequence, botId: item.bot.id }],
          );
        // Otto: A routine made private leaves everyone else's routines.
        case "routine-upserted":
          return Effect.succeed(
            canSeeRoutine(item.routine, personId)
              ? [item]
              : [{ kind: "routine-removed", sequence: item.sequence, routineId: item.routine.id }],
          );
        case "mcp-server-upserted":
          return Effect.succeed(
            canUseMcpServer(item.mcpServer, personId)
              ? [item]
              : [
                  {
                    kind: "mcp-server-removed",
                    sequence: item.sequence,
                    mcpServerId: item.mcpServer.id,
                  },
                ],
          );
        case "library-file-upserted":
          return Effect.succeed(
            canSeeLibrary(item.file)
              ? [item]
              : [{ kind: "library-file-removed", sequence: item.sequence, fileId: item.file.id }],
          );

        default:
          return Effect.succeed([item]);
      }
    };

    const filtered = input.stream.pipe(
      Stream.mapEffect(filter),
      Stream.flatMap((items) => Stream.fromIterable<OrchestrationShellStreamItem>(items)),
    );

    if (!input.resuming) return filtered;

    const initial = yield* input.loadSnapshot;
    yield* loadLibrary;
    const reset = remember(initial);

    const hidesAny =
      initial.groups.some((group) => !canSeeGroup(group, personId)) ||
      reset.threads.length !== initial.threads.length ||
      reset.bots.length !== initial.bots.length ||
      (reset.mcpServers?.length ?? 0) !== (initial.mcpServers?.length ?? 0);

    if (!hidesAny) return filtered;

    return Stream.concat(Stream.make({ kind: "snapshot" as const, snapshot: reset }), filtered);
  });
}
