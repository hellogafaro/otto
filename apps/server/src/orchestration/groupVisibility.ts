import {
  canSeeDirectChat,
  canSeeLibraryItem,
  type DirectChatAccess,
  canUseMcpServer,
  isGroupPersonMember,
  type LibraryFolder,
  type LibraryVisibilityContext,
  type AuthSessionId,
  type GroupId,
  type GroupMembership,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type Routine,
  type ThreadId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { ProjectionGroupRepository } from "../persistence/Services/ProjectionGroups.ts";
import type { LibraryChatThread } from "../persistence/Services/ProjectionLibrary.ts";
import type { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

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

/** Whether a person may read or act on a chat; an unknown chat is left to its own checks. */
export const canSeeThreadById = (
  services: {
    readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
    readonly projectionGroups: ProjectionGroupRepository["Service"];
  },
  threadId: ThreadId,
  personId: AuthSessionId,
) =>
  Effect.gen(function* () {
    const thread = yield* services.projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.orElseSucceed(() => Option.none()));

    if (Option.isNone(thread)) return true;

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

/** Library items a person may see; a chat's folder follows that chat's people. */
function visibleLibrary(
  snapshot: OrchestrationShellSnapshot,
  personId: AuthSessionId,
  chatThreads: ReadonlyArray<LibraryChatThread>,
): Pick<OrchestrationShellSnapshot, "libraryFolders" | "libraryFiles"> {
  if (snapshot.libraryFolders === undefined && snapshot.libraryFiles === undefined) return {};

  const context = libraryContext(snapshot.libraryFolders ?? [], snapshot.groups, chatThreads);
  const viewer = { kind: "person" as const, personId };

  return {
    libraryFolders: (snapshot.libraryFolders ?? []).filter((folder) =>
      canSeeLibraryItem(folder, context, viewer),
    ),
    libraryFiles: (snapshot.libraryFiles ?? []).filter((file) =>
      canSeeLibraryItem(file, context, viewer),
    ),
  };
}

const libraryContext = (
  folders: ReadonlyArray<LibraryFolder>,
  groups: ReadonlyArray<GroupMembers>,
  chatThreads: ReadonlyArray<LibraryChatThread>,
): LibraryVisibilityContext => ({ folders, threads: chatThreads, groups });

export function visibleShellSnapshot(
  snapshot: OrchestrationShellSnapshot,
  personId: AuthSessionId,
  chatThreads: ReadonlyArray<LibraryChatThread>,
): OrchestrationShellSnapshot {
  const groups = snapshot.groups.filter((group) => canSeeGroup(group, personId));

  // Someone else's personal MCP server stays out of sight; their bots still use it.
  const library = {
    ...visibleLibrary(snapshot, personId, chatThreads),
    ...(snapshot.mcpServers
      ? {
          mcpServers: snapshot.mcpServers.filter((server) => canUseMcpServer(server, personId)),
        }
      : {}),
  };

  const routines = snapshot.routines?.filter((routine) => canSeeRoutine(routine, personId));

  return {
    ...snapshot,
    ...library,
    ...(routines !== undefined ? { routines } : {}),
    ...(snapshot.routineRuns !== undefined && routines !== undefined
      ? {
          routineRuns: snapshot.routineRuns.filter((run) =>
            routines.some((routine) => routine.id === run.routineId),
          ),
        }
      : {}),
    groups,
    threads: snapshot.threads.filter((thread) => canSeeThread(thread, snapshot.groups, personId)),
  };
}

/**
 * Filters one person's shell stream. When a membership change shows or hides a group for
 * them, the stream sends a fresh filtered snapshot so its threads appear or disappear too.
 * Library folder changes can show or hide everything under them, so they send one as well.
 */
export function withGroupVisibility<E, R>(input: {
  readonly stream: Stream.Stream<OrchestrationShellStreamItem, E, R>;
  readonly personId: AuthSessionId;
  readonly loadSnapshot: Effect.Effect<OrchestrationShellSnapshot, E, R>;
  readonly loadChatThreads: Effect.Effect<ReadonlyArray<LibraryChatThread>, E, R>;
  /** Resuming clients may hold groups cached before they were hidden. */
  readonly resuming: boolean;
}): Effect.Effect<Stream.Stream<OrchestrationShellStreamItem, E, R>, E, R> {
  return Effect.gen(function* () {
    const { personId } = input;
    const initial = yield* input.loadSnapshot;
    let chatThreads = yield* input.loadChatThreads;
    const groups = new Map<GroupId, GroupMembers>(initial.groups.map((group) => [group.id, group]));
    let folders = initial.libraryFolders ?? [];

    const visible = (groupId: GroupId) => {
      const group = groups.get(groupId);

      return group === undefined || canSeeGroup(group, personId);
    };

    const remember = (snapshot: OrchestrationShellSnapshot) => {
      groups.clear();

      for (const group of snapshot.groups) groups.set(group.id, group);
      folders = snapshot.libraryFolders ?? [];

      return visibleShellSnapshot(snapshot, personId, chatThreads);
    };

    const fresh = Effect.all([input.loadSnapshot, input.loadChatThreads]).pipe(
      Effect.map(([snapshot, threads]): ReadonlyArray<OrchestrationShellStreamItem> => {
        chatThreads = threads;

        return [{ kind: "snapshot", snapshot: remember(snapshot) }];
      }),
    );

    const isChatThread = (threadId: string) => chatThreads.some((thread) => thread.id === threadId);

    const filter = (
      item: OrchestrationShellStreamItem,
    ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, E, R> => {
      switch (item.kind) {
        case "snapshot":
          return input.loadChatThreads.pipe(
            Effect.map((threads) => {
              chatThreads = threads;

              return [{ kind: "snapshot", snapshot: remember(item.snapshot) }];
            }),
          );
        case "group-upserted": {
          const before = visible(item.group.id);
          groups.set(item.group.id, item.group);
          const after = visible(item.group.id);

          if (before !== after) return fresh;

          return Effect.succeed(after ? [item] : []);
        }

        case "group-removed":
          groups.delete(item.groupId);

          if (chatThreads.some((thread) => thread.groupId === item.groupId)) return fresh;

          return Effect.succeed([item]);
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
        case "library-folder-upserted":
        case "library-folder-removed":
          return fresh;
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
        case "library-file-upserted": {
          const context = libraryContext(folders, [...groups.values()], chatThreads);

          return Effect.succeed(
            canSeeLibraryItem(item.file, context, { kind: "person", personId })
              ? [item]
              : [{ kind: "library-file-removed", sequence: item.sequence, fileId: item.file.id }],
          );
        }

        default:
          return Effect.succeed([item]);
      }
    };

    const filtered = input.stream.pipe(
      Stream.mapEffect(filter),
      Stream.flatMap((items) => Stream.fromIterable<OrchestrationShellStreamItem>(items)),
    );

    const reset = visibleShellSnapshot(initial, personId, chatThreads);

    const hidesAny =
      initial.groups.some((group) => !canSeeGroup(group, personId)) ||
      reset.threads.length !== initial.threads.length ||
      (reset.libraryFolders?.length ?? 0) !== (initial.libraryFolders?.length ?? 0) ||
      (reset.libraryFiles?.length ?? 0) !== (initial.libraryFiles?.length ?? 0) ||
      (reset.mcpServers?.length ?? 0) !== (initial.mcpServers?.length ?? 0) ||
      (reset.routines?.length ?? 0) !== (initial.routines?.length ?? 0);

    if (!input.resuming || !hidesAny) return filtered;

    return Stream.concat(Stream.make({ kind: "snapshot" as const, snapshot: reset }), filtered);
  });
}
