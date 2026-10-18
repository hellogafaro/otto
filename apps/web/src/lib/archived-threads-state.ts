import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@otto/client-runtime/environment";
import type { EnvironmentThreadShell } from "@otto/client-runtime/state/shell";
import {
  type ArchivedSnapshotEntry,
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "@otto/client-runtime/state/threads";
import type { EnvironmentId, ScopedThreadRef } from "@otto/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useThreadShell } from "../state/entities";
import { orchestrationEnvironment } from "../state/orchestration";
import { appAtomRegistry } from "../rpc/atom-registry";

function archivedSnapshotAtom(environmentId: EnvironmentId) {
  return orchestrationEnvironment.archivedShellSnapshot({
    environmentId,
    input: {},
  });
}

const archivedSnapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
  getSnapshotAtom: archivedSnapshotAtom,
  labelPrefix: "web:archived-thread-snapshots",
});

/**
 * Otto: Chats archived in this session, as they were when archived. The live shell list drops a
 * chat as soon as it is archived, before the archived snapshot is refetched, so these keep the
 * open chat in place across that gap.
 */
const justArchivedShellsAtom = Atom.make<ReadonlyMap<string, EnvironmentThreadShell>>(
  new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("web:just-archived-thread-shells"));

const NO_ENVIRONMENTS: ReadonlyArray<EnvironmentId> = [];

export function refreshArchivedThreadsForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
}

export function setJustArchivedShell(
  threadRef: ScopedThreadRef,
  shell: EnvironmentThreadShell | null,
): void {
  const next = new Map(appAtomRegistry.get(justArchivedShellsAtom));

  if (shell === null) next.delete(scopedThreadKey(threadRef));
  else next.set(scopedThreadKey(threadRef), shell);

  appAtomRegistry.set(justArchivedShellsAtom, next);
}

export function useArchivedThreadSnapshots(environmentIds: ReadonlyArray<EnvironmentId>): {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly error: string | null;
  readonly isLoading: boolean;
} {
  const environmentKey = useMemo(
    () => makeArchivedThreadsEnvironmentKey(environmentIds),
    [environmentIds],
  );

  return useAtomValue(archivedSnapshotsAtom(environmentKey));
}

/**
 * Otto: The open chat's shell, live or archived. An archived chat stays readable at its address,
 * but never joins the live shell list the sidebar and Chats read. `pending` is true while the
 * archive is still loading to tell an archived chat from one that is gone.
 */
export function useChatShell(threadRef: ScopedThreadRef | null) {
  const live = useThreadShell(threadRef);

  const justArchived =
    useAtomValue(justArchivedShellsAtom).get(threadRef ? scopedThreadKey(threadRef) : "") ?? null;

  const archiveEnvironmentId =
    live === null && justArchived === null ? (threadRef?.environmentId ?? null) : null;

  const environmentIds = useMemo(
    () => (archiveEnvironmentId === null ? NO_ENVIRONMENTS : [archiveEnvironmentId]),
    [archiveEnvironmentId],
  );

  const archive = useArchivedThreadSnapshots(environmentIds);

  const archivedThread =
    archiveEnvironmentId === null
      ? undefined
      : archive.snapshots[0]?.snapshot.threads.find(
          (thread) => thread.id === threadRef?.threadId && thread.archivedAt !== null,
        );

  const archived = useMemo(
    () =>
      archivedThread === undefined || archiveEnvironmentId === null
        ? null
        : { ...archivedThread, environmentId: archiveEnvironmentId },
    [archiveEnvironmentId, archivedThread],
  );

  const shell = live ?? justArchived ?? archived;

  return { shell, pending: shell === null && archive.isLoading };
}
