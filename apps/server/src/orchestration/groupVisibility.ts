import {
  isGroupPersonMember,
  type AuthSessionId,
  type GroupId,
  type GroupMembership,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

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

export function visibleShellSnapshot(
  snapshot: OrchestrationShellSnapshot,
  personId: AuthSessionId,
): OrchestrationShellSnapshot {
  const groups = snapshot.groups.filter((group) => canSeeGroup(group, personId));

  if (groups.length === snapshot.groups.length) return snapshot;

  return {
    ...snapshot,
    groups,
    threads: snapshot.threads.filter((thread) => canSeeThread(thread, snapshot.groups, personId)),
  };
}

/**
 * Filters one person's shell stream. When a membership change shows or hides a group for
 * them, the stream sends a fresh filtered snapshot so its threads appear or disappear too.
 */
export function withGroupVisibility<E, R>(input: {
  readonly stream: Stream.Stream<OrchestrationShellStreamItem, E, R>;
  readonly personId: AuthSessionId;
  readonly loadSnapshot: Effect.Effect<OrchestrationShellSnapshot, E, R>;
  /** Resuming clients may hold groups cached before they were hidden. */
  readonly resuming: boolean;
}): Effect.Effect<Stream.Stream<OrchestrationShellStreamItem, E, R>, E, R> {
  return Effect.gen(function* () {
    const { personId } = input;
    const initial = yield* input.loadSnapshot;
    const groups = new Map<GroupId, GroupMembers>(initial.groups.map((group) => [group.id, group]));

    const visible = (groupId: GroupId) => {
      const group = groups.get(groupId);

      return group === undefined || canSeeGroup(group, personId);
    };

    const fresh = input.loadSnapshot.pipe(
      Effect.map((snapshot): OrchestrationShellStreamItem => {
        for (const group of snapshot.groups) groups.set(group.id, group);

        return { kind: "snapshot", snapshot: visibleShellSnapshot(snapshot, personId) };
      }),
    );

    const filter = (
      item: OrchestrationShellStreamItem,
    ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, E, R> => {
      switch (item.kind) {
        case "snapshot":
          groups.clear();

          for (const group of item.snapshot.groups) groups.set(group.id, group);

          return Effect.succeed([
            { kind: "snapshot", snapshot: visibleShellSnapshot(item.snapshot, personId) },
          ]);
        case "group-upserted": {
          const before = visible(item.group.id);
          groups.set(item.group.id, item.group);
          const after = visible(item.group.id);

          if (before !== after) return fresh.pipe(Effect.map((snapshot) => [snapshot]));

          return Effect.succeed(after ? [item] : []);
        }

        case "group-removed":
          groups.delete(item.groupId);

          return Effect.succeed([item]);
        case "thread-upserted":
          return Effect.succeed(
            item.thread.groupId != null && !visible(item.thread.groupId) ? [] : [item],
          );
        default:
          return Effect.succeed([item]);
      }
    };

    const filtered = input.stream.pipe(
      Stream.mapEffect(filter),
      Stream.flatMap((items) => Stream.fromIterable<OrchestrationShellStreamItem>(items)),
    );

    const hidesAny = initial.groups.some((group) => !canSeeGroup(group, personId));

    if (!input.resuming || !hidesAny) return filtered;

    const reset: OrchestrationShellStreamItem = {
      kind: "snapshot",
      snapshot: visibleShellSnapshot(initial, personId),
    };

    return Stream.concat(Stream.make(reset), filtered);
  });
}
