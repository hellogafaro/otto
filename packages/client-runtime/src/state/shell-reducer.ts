import * as Arr from "effect/Array";
import {
  ottoDelegationStateOf,
  isTerminalDelegationState,
  SHELL_RECENT_TERMINAL_DELEGATIONS_PER_THREAD,
  type OttoDelegationRecord,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
} from "@otto/contracts";

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);

      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }

    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "bot-upserted": {
      const bots = snapshot.bots.some((bot) => bot.id === event.bot.id)
        ? Arr.map(snapshot.bots, (bot) => (bot.id === event.bot.id ? event.bot : bot))
        : Arr.append(snapshot.bots, event.bot);

      return { ...snapshot, bots, snapshotSequence: event.sequence };
    }

    case "bot-removed":
      return {
        ...snapshot,
        bots: Arr.filter(snapshot.bots, (bot) => bot.id !== event.botId),
        snapshotSequence: event.sequence,
      };
    case "group-upserted": {
      const groups = snapshot.groups.some((group) => group.id === event.group.id)
        ? Arr.map(snapshot.groups, (group) => (group.id === event.group.id ? event.group : group))
        : Arr.append(snapshot.groups, event.group);

      return { ...snapshot, groups, snapshotSequence: event.sequence };
    }

    case "group-removed":
      return {
        ...snapshot,
        groups: Arr.filter(snapshot.groups, (group) => group.id !== event.groupId),
        snapshotSequence: event.sequence,
      };
    case "task-upserted": {
      const tasks = snapshot.tasks ?? [];

      const nextTasks = tasks.some((task) => task.id === event.task.id)
        ? Arr.map(tasks, (task) => (task.id === event.task.id ? event.task : task))
        : Arr.append(tasks, event.task);

      return { ...snapshot, tasks: nextTasks, snapshotSequence: event.sequence };
    }

    case "mcp-server-upserted": {
      const mcpServers = snapshot.mcpServers ?? [];

      const nextMcpServers = mcpServers.some((server) => server.id === event.mcpServer.id)
        ? Arr.map(mcpServers, (server) =>
            server.id === event.mcpServer.id ? event.mcpServer : server,
          )
        : Arr.append(mcpServers, event.mcpServer);

      return { ...snapshot, mcpServers: nextMcpServers, snapshotSequence: event.sequence };
    }

    case "mcp-server-removed":
      return {
        ...snapshot,
        mcpServers: Arr.filter(
          snapshot.mcpServers ?? [],
          (server) => server.id !== event.mcpServerId,
        ),
        snapshotSequence: event.sequence,
      };
    case "delegation-upserted": {
      const delegations = snapshot.delegations.some(
        (delegation) => delegation.delegationId === event.delegation.delegationId,
      )
        ? Arr.map(snapshot.delegations, (delegation) =>
            delegation.delegationId === event.delegation.delegationId
              ? event.delegation
              : delegation,
          )
        : Arr.append(snapshot.delegations, event.delegation);

      return {
        ...snapshot,
        delegations: isTerminalDelegationState(ottoDelegationStateOf(event.delegation.phase))
          ? capTerminalDelegations(delegations, event.delegation.parentThreadId)
          : delegations,
        snapshotSequence: event.sequence,
      };
    }

    // Otto: Routines and Library live in their own caches, so their events only move the snapshot on.
    case "routine-upserted":
    case "routine-removed":
    case "skill-assignment-upserted":
    case "skill-assignment-removed":
    case "library-folder-upserted":
    case "library-folder-removed":
    case "library-file-upserted":
    case "library-file-removed":
      return { ...snapshot, snapshotSequence: event.sequence };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);

      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }

    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}

/**
 * Keeps the newest finished delegations for one parent thread, matching the
 * limit the server applies to shell snapshots.
 */
// Binary order, matching SQLite's default collation in the shell snapshot query.
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

// Keeps the same finished delegations as the shell snapshot, which ranks them
// by updatedAt DESC, createdAt ASC, delegation_id ASC.
function capTerminalDelegations(
  delegations: ReadonlyArray<OttoDelegationRecord>,
  parentThreadId: OttoDelegationRecord["parentThreadId"],
): ReadonlyArray<OttoDelegationRecord> {
  const terminal = delegations.filter(
    (delegation) =>
      delegation.parentThreadId === parentThreadId &&
      isTerminalDelegationState(ottoDelegationStateOf(delegation.phase)),
  );

  if (terminal.length <= SHELL_RECENT_TERMINAL_DELEGATIONS_PER_THREAD) return delegations;

  const dropped = new Set(
    [...terminal]
      .sort(
        (left, right) =>
          compareText(right.updatedAt, left.updatedAt) ||
          compareText(left.createdAt, right.createdAt) ||
          compareText(left.delegationId, right.delegationId),
      )
      .slice(SHELL_RECENT_TERMINAL_DELEGATIONS_PER_THREAD),
  );

  return delegations.filter((delegation) => !dropped.has(delegation));
}
