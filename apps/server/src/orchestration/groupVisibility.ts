import {
  canSeeLibraryItem,
  canUseMcpServer,
  isGroupPersonMember,
  type LibraryFolder,
  type LibraryVisibilityContext,
  type AuthSessionId,
  type GroupId,
  type GroupMembership,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { LibraryChatThread } from "../persistence/Services/ProjectionLibrary.ts";

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

/** Whether a thread is readable: any non-group thread, or a thread of a visible group. */
export function canSeeThread(
  thread: { readonly groupId?: GroupId | null | undefined },
  groups: ReadonlyArray<GroupMembers>,
  personId: AuthSessionId,
): boolean {
  if (thread.groupId == null) return true;
  const group = groups.find((candidate) => candidate.id === thread.groupId);

  return group === undefined || canSeeGroup(group, personId);
}

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

  if (groups.length === snapshot.groups.length) return { ...snapshot, ...library };

  return {
    ...snapshot,
    ...library,
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
        case "thread-upserted":
          return Effect.succeed(
            item.thread.groupId != null && !visible(item.thread.groupId) ? [] : [item],
          );
        case "thread-removed":
          return isChatThread(item.threadId) ? fresh : Effect.succeed([item]);
        case "library-folder-upserted":
        case "library-folder-removed":
          return fresh;
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
      (reset.libraryFolders?.length ?? 0) !== (initial.libraryFolders?.length ?? 0) ||
      (reset.libraryFiles?.length ?? 0) !== (initial.libraryFiles?.length ?? 0) ||
      (reset.mcpServers?.length ?? 0) !== (initial.mcpServers?.length ?? 0);

    if (!input.resuming || !hidesAny) return filtered;

    return Stream.concat(Stream.make({ kind: "snapshot" as const, snapshot: reset }), filtered);
  });
}
