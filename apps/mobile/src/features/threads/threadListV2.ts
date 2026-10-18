import { Data } from "effect";
import {
  effectiveSnoozed,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
  resolveSnoozePresets,
  snoozeWakeLabel,
} from "@otto/client-runtime/state/thread-snoozed";
import type { SnoozePreset } from "@otto/client-runtime/state/thread-snoozed";
import type { EnvironmentThreadShell } from "@otto/client-runtime/state/shell";
import { threadSearchMatchKey } from "@otto/client-runtime/state/thread-search";
import { sortPinnedThreadsByOrderKey } from "@otto/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@otto/contracts";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";

type ThreadListV2SwipeActions = {
  readonly primary: Exclude<ThreadListV2SwipeAction, "snooze">;
  readonly secondary: "snooze" | null;
};

export { snoozeWakeLabel };

/**
 * Thread List v2 model, ported from the web sidebar v2
 * (apps/web/src/components/Sidebar.logic.ts + SidebarV2.tsx).
 *
 * Four visual states, three colors: color is reserved for "act now"
 * (approval), "in motion" (working), and "broken" (failed). Ready is the
 * unlabeled resting state.
 */
export type ThreadListV2Status = "approval" | "input" | "working" | "failed" | "ready";

export type ThreadListV2SwipeAction = "archive" | "snooze" | "unsnooze";

type SnoozeMenuSelection =
  | { readonly _tag: "selected"; readonly preset: SnoozePreset }
  | { readonly _tag: "expired" }
  | { readonly _tag: "not-snooze" };

const snoozeMenuSelection = Data.taggedEnum<SnoozeMenuSelection>();

export function resolveThreadListV2SnoozeMenuSelection(input: {
  readonly event: string;
  readonly displayedPresets: ReadonlyArray<SnoozePreset>;
  readonly now: Date;
}): SnoozeMenuSelection {
  if (!input.event.startsWith("snooze:")) return snoozeMenuSelection["not-snooze"]();

  const currentPreset = resolveSnoozePresets(input.now).find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );

  if (currentPreset) return snoozeMenuSelection["selected"]({ preset: currentPreset });

  const displayedPreset = input.displayedPresets.find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );

  if (displayedPreset && Date.parse(displayedPreset.snoozedUntil) > input.now.getTime()) {
    return snoozeMenuSelection["selected"]({ preset: displayedPreset });
  }

  return snoozeMenuSelection["expired"]();
}

export function resolveThreadListV2SwipeActions(input: {
  readonly snoozeSupported: boolean;
  readonly snoozable: boolean;
  /** Row is on the snoozed shelf. */
  readonly snoozed?: boolean;
}): ThreadListV2SwipeActions {
  if (input.snoozed === true) {
    return { primary: "unsnooze", secondary: null };
  }

  return {
    primary: "archive",
    secondary: input.snoozeSupported && input.snoozable ? "snooze" : null,
  };
}

/**
 * The point at which a queued-turn snooze guard expires on its own. Rows arm
 * a one-shot timer for this boundary so Snooze appears without waiting for an
 * unrelated render. User-blocked threads return null because only fresh
 * server data can make them snoozable.
 */
export function resolveThreadListV2SnoozeGateExpiryMs(
  thread: Pick<
    EnvironmentThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn" | "session"
  >,
  options: { readonly now: string },
): number | null {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return null;

  if (!hasQueuedTurnStart(thread, options)) return null;
  const messageAtMs = Date.parse(thread.latestUserMessageAt ?? "");

  if (Number.isNaN(messageAtMs)) return null;

  return messageAtMs + QUEUED_TURN_START_GRACE_MS;
}

export function resolveThreadListV2Status(
  thread: Pick<EnvironmentThreadShell, "hasPendingApprovals" | "hasPendingUserInput" | "session">,
): ThreadListV2Status {
  if (thread.hasPendingApprovals) {
    return "approval";
  }

  if (thread.hasPendingUserInput) {
    return "input";
  }

  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }

  if (thread.session?.status === "error") {
    return "failed";
  }

  return "ready";
}

/** NaN-safe Date.parse for sort comparators: a malformed timestamp must not
    poison the whole ordering, so it sinks to the epoch instead. */
function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);

  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * v2 sort: static order, newest creation time on top. Activity NEVER reorders
 * the list — a row holds its position between lifecycle transitions. Mirrors
 * web's sortThreadsForSidebar.
 */
export function sortThreadsForListV2<T extends { readonly id: string; readonly createdAt: string }>(
  threads: readonly T[],
): T[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023
  // change-by-copy array methods.
  return [...threads].sort(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export interface ThreadListV2Item {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  /** Snoozed-shelf row: shows the wake countdown and offers Wake. */
  readonly snoozed: boolean;
  /** Pinned-block row: renders the pin glyph and offers Unpin. */
  readonly pinned: boolean;
  readonly isLast: boolean;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
  /** Snoozed threads matching the current filters. */
  readonly snoozedCount: number;
  /** Index in `items` where the Snoozed shelf header belongs. The header is
      still rendered when the shelf is collapsed and no snoozed rows exist. */
  readonly snoozedShelfHeaderIndex: number | null;
  /** Soonest wake time among snoozed threads, or null. Callers arm
      a timeout at this boundary so the list re-partitions the moment a
      snooze expires instead of on the next minute tick. */
  readonly nextSnoozeWakeAt: string | null;
}

export interface ThreadListV2ThreadListItem {
  readonly type: "v2-thread";
  readonly key: string;
  readonly item: ThreadListV2Item;
  /** Precomputed so recycled-list equality can see a minute-tick change. */
  readonly snoozeWakeLabelText: string | undefined;
}

export interface ThreadListV2PendingListItem {
  readonly type: "v2-pending";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  /** First queued row after the active block draws the PENDING divider. */
  readonly showPendingDivider: boolean;
}

export interface ThreadListV2SnoozedShelfListItem {
  readonly type: "v2-snoozed-shelf";
  readonly key: "v2-snoozed-shelf";
  readonly count: number;
  readonly expanded: boolean;
}

export type ThreadListV2ListItem =
  | ThreadListV2ThreadListItem
  | ThreadListV2PendingListItem
  | ThreadListV2SnoozedShelfListItem;

/**
 * Builds the shared mobile order: active → pending → snoozed shelf.
 * Pending tasks are waiting rather than asking, and parked work remains
 * reachable without competing with the inbox.
 */
export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly snoozedCount?: number;
  readonly snoozedShelfExpanded?: boolean;
  readonly snoozedShelfHeaderIndex?: number | null;
  readonly snoozeLabelNow?: string;
}): ThreadListV2ListItem[] {
  const threadItems = input.items.map(
    (item): ThreadListV2ListItem => ({
      type: "v2-thread",
      key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
      item,
      snoozeWakeLabelText:
        item.snoozed && item.thread.snoozedUntil != null && input.snoozeLabelNow !== undefined
          ? snoozeWakeLabel(item.thread.snoozedUntil, { now: input.snoozeLabelNow })
          : undefined,
    }),
  );

  const pendingItems = input.pendingTasks.map(
    (pendingTask, index): ThreadListV2ListItem => ({
      type: "v2-pending",
      key: `v2-pending:${pendingTask.message.messageId}`,
      pendingTask,
      showPendingDivider: index === 0,
    }),
  );

  const snoozedCount = input.snoozedCount ?? 0;
  const snoozedShelfHeaderIndex = input.snoozedShelfHeaderIndex ?? null;
  const activeEnd = snoozedShelfHeaderIndex ?? threadItems.length;
  const result: ThreadListV2ListItem[] = [...threadItems.slice(0, activeEnd), ...pendingItems];

  if (snoozedShelfHeaderIndex !== null && snoozedCount > 0) {
    result.push({
      type: "v2-snoozed-shelf",
      key: "v2-snoozed-shelf",
      count: snoozedCount,
      expanded: input.snoozedShelfExpanded === true,
    });
    result.push(...threadItems.slice(snoozedShelfHeaderIndex));
  }

  return result;
}

/**
 * Partitions visible threads into the pinned and active card block (creation
 * order) and the snoozed shelf, matching the web v2 list.
 */
export function buildThreadListV2Items(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }> | null;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
  /** Environments whose server supports thread.snooze/unsnooze. Threads on
      other environments never classify as snoozed. Absent = no gating
      (tests). */
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  /** Injectable for tests; defaults to now. */
  readonly now?: string;
  /** Second-precise clock for snooze classification. Callers pass a
      minute-quantized `now` for memoization; snooze wake times are
      second-precise, so classifying with the floored minute would hold a
      woken thread hidden for up to a minute. Defaults to `now`. */
  readonly snoozeNow?: string;
  /** Expands the snoozed shelf into rows. Collapsed is the default. */
  readonly snoozedShelfExpanded?: boolean;
  /** The selected thread remains visible on an otherwise collapsed shelf so
      a split-view detail can never lose its navigation row. */
  readonly selectedThreadKey?: string | null;
}): ThreadListV2Layout {
  const now = input.now ?? new Date().toISOString();
  const snoozeNow = input.snoozeNow ?? now;
  const query = input.searchQuery.trim().toLocaleLowerCase();

  const projectKeys = input.projectRefs
    ? new Set(input.projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;

  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  let nextSnoozeWakeAt: string | null = null;

  for (const thread of input.threads) {
    if (input.environmentId !== null && thread.environmentId !== input.environmentId) continue;

    if (projectKeys !== null && !projectKeys.has(`${thread.environmentId}:${thread.projectId}`)) {
      continue;
    }

    if (
      query.length > 0 &&
      !thread.title.toLocaleLowerCase().includes(query) &&
      input.matchedThreadKeys?.has(
        threadSearchMatchKey({
          environmentId: thread.environmentId,
          threadId: thread.id,
        }),
      ) !== true
    ) {
      continue;
    }

    const supportsSnooze = input.snoozeEnvironmentIds?.has(thread.environmentId) ?? true;

    // Snooze outranks pinning until the thread wakes.
    if (supportsSnooze && effectiveSnoozed(thread, { now: snoozeNow })) {
      snoozed.push(thread);

      if (
        thread.snoozedUntil != null &&
        (nextSnoozeWakeAt === null ||
          parseTimestampMs(thread.snoozedUntil) < parseTimestampMs(nextSnoozeWakeAt))
      ) {
        nextSnoozeWakeAt = thread.snoozedUntil;
      }

      continue;
    }

    if (thread.pinnedAt != null) {
      pinned.push(thread);
    } else {
      active.push(thread);
    }
  }

  const orderedActive = sortThreadsForListV2(active);

  const orderedSnoozed = [...snoozed].sort(
    (left, right) =>
      parseTimestampMs(left.snoozedUntil ?? "") - parseTimestampMs(right.snoozedUntil ?? ""),
  );

  const selectedThreadKey = input.selectedThreadKey ?? null;

  const visibleSnoozed =
    input.snoozedShelfExpanded === true
      ? orderedSnoozed
      : orderedSnoozed.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );

  const items: ThreadListV2Item[] = [];

  for (const thread of sortPinnedThreadsByOrderKey(pinned)) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: true,
      isLast: false,
    });
  }

  for (const thread of orderedActive) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: false,
      isLast: false,
    });
  }

  const snoozedShelfHeaderIndex = orderedSnoozed.length > 0 ? items.length : null;

  for (const thread of visibleSnoozed) {
    items.push({
      thread,
      variant: "slim",
      snoozed: true,
      pinned: false,
      isLast: false,
    });
  }

  const last = items.at(-1);

  if (last) {
    items[items.length - 1] = { ...last, isLast: true };
  }

  return {
    items,
    snoozedCount: orderedSnoozed.length,
    snoozedShelfHeaderIndex,
    nextSnoozeWakeAt,
  };
}
