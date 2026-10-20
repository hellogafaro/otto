import { Predicate } from "effect";
import {
  compareThreadActivity,
  type ThreadActivityInput,
} from "@otto/client-runtime/state/thread-sort";
import type { StartThreadTurnInput } from "@otto/client-runtime/state/threads";
import {
  type BotId,
  type GroupId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
  GENERAL_PROJECT_ID,
} from "@otto/contracts";

export function createBotTurnSubmissionQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(submission: () => Promise<T>): Promise<T> {
      const result = tail.then(submission, submission);
      tail = result.then(
        () => undefined,
        () => undefined,
      );

      return result;
    },
  };
}

export function buildBotTurnStartInput(input: {
  botId: BotId;
  threadId: ThreadId;
  projectId: ProjectId;
  title: string;
  message: StartThreadTurnInput["message"];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  createdAt: string;
  createThread: boolean;
}): StartThreadTurnInput {
  return {
    threadId: input.threadId,
    message: input.message,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.createThread
      ? {
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              botId: input.botId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: input.createdAt,
            },
          },
        }
      : {}),
    createdAt: input.createdAt,
  };
}

export function buildGroupTurnStartInput(input: {
  groupId: GroupId;
  respondingBotId?: BotId;
  threadId: ThreadId;
  projectId: ProjectId;
  title: string;
  message: StartThreadTurnInput["message"];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  createdAt: string;
  createThread: boolean;
}): StartThreadTurnInput {
  return {
    threadId: input.threadId,
    message: input.message,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.respondingBotId ? { respondingBotId: input.respondingBotId } : {}),
    ...(input.createThread
      ? {
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              groupId: input.groupId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: input.createdAt,
            },
          },
        }
      : {}),
    createdAt: input.createdAt,
  };
}

type BotChatCandidate = ThreadActivityInput & {
  environmentId: string;
  botId?: string | null | undefined;
  parentThreadId?: string | null | undefined;
  archivedAt: string | null;
  deletedAt?: string | null | undefined;
};

function isActiveBotChat(botId: string, environmentId: string, thread: BotChatCandidate): boolean {
  return (
    thread.environmentId === environmentId &&
    thread.botId === botId &&
    thread.archivedAt === null &&
    thread.parentThreadId == null &&
    thread.deletedAt == null
  );
}

/** The bot's own active chats in one environment, latest activity first. Child work is left out. */
export function listBotChats<TThread extends BotChatCandidate>(
  botId: string,
  environmentId: string,
  threads: readonly TThread[],
): TThread[] {
  return threads
    .filter((thread) => isActiveBotChat(botId, environmentId, thread))
    .toSorted(compareThreadActivity);
}

export function findLatestBotThreadTarget(
  botId: string,
  environmentId: string,
  threads: readonly BotChatCandidate[],
): { environmentId: string; threadId: string } | null {
  let latest: BotChatCandidate | undefined;

  for (const thread of threads) {
    if (!isActiveBotChat(botId, environmentId, thread)) continue;

    if (latest === undefined || compareThreadActivity(thread, latest) < 0) {
      latest = thread;
    }
  }

  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}

type GroupThreadShell = ThreadActivityInput & {
  environmentId: string;
  groupId?: string | null | undefined;
  parentThreadId?: string | null | undefined;
  archivedAt: string | null;
  deletedAt?: string | null | undefined;
};

const isActiveGroupChat = (thread: GroupThreadShell) =>
  thread.groupId != null &&
  thread.archivedAt === null &&
  thread.parentThreadId == null &&
  thread.deletedAt == null;

const isNewerThread = (thread: GroupThreadShell, than: GroupThreadShell | undefined) =>
  than === undefined || compareThreadActivity(thread, than) < 0;

export function findLatestGroupThreadTarget(
  groupId: string,
  environmentId: string,
  threads: readonly GroupThreadShell[],
): { environmentId: string; threadId: string } | null {
  let latest: GroupThreadShell | undefined;

  for (const thread of threads) {
    if (
      thread.environmentId === environmentId &&
      thread.groupId === groupId &&
      isActiveGroupChat(thread) &&
      isNewerThread(thread, latest)
    ) {
      latest = thread;
    }
  }

  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}

type PersonThreadShell = GroupThreadShell & {
  personId?: string | null | undefined;
  createdBy?: string | null | undefined;
};

/** Otto: The latest live DM between the signed-in person and another person, either side's. */
export function findLatestPersonThreadTarget(
  personId: string,
  currentPersonId: string,
  environmentId: string,
  threads: readonly PersonThreadShell[],
): { environmentId: string; threadId: string } | null {
  let latest: PersonThreadShell | undefined;

  for (const thread of threads) {
    const pair =
      (thread.personId === personId && thread.createdBy === currentPersonId) ||
      (thread.personId === currentPersonId && thread.createdBy === personId);

    if (
      pair &&
      thread.environmentId === environmentId &&
      thread.archivedAt === null &&
      thread.parentThreadId == null &&
      thread.deletedAt == null &&
      isNewerThread(thread, latest)
    ) {
      latest = thread;
    }
  }

  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}

export const latestGroupThreadKey = (environmentId: string, groupId: string) =>
  `${environmentId}\u0000${groupId}`;

/**
 * Every group's latest chat in one pass, keyed by `latestGroupThreadKey`, for
 * callers that would otherwise run `findLatestGroupThreadTarget` per shell.
 */
export function findLatestGroupThreadIds(
  threads: readonly GroupThreadShell[],
): ReadonlyMap<string, string> {
  const latest = new Map<string, GroupThreadShell>();

  for (const thread of threads) {
    if (thread.groupId == null || !isActiveGroupChat(thread)) continue;
    const key = latestGroupThreadKey(thread.environmentId, thread.groupId);

    if (isNewerThread(thread, latest.get(key))) latest.set(key, thread);
  }

  return new Map(Array.from(latest, ([key, thread]) => [key, thread.id] as const));
}

export function findUnhandledMcpAuthorization(
  activities: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly payload: unknown;
  }>,
  handledIds: ReadonlySet<string>,
): { readonly activityId: string; readonly url: string } | null {
  for (const activity of activities) {
    if (activity.kind !== "mcp.oauth.authorization-required" || handledIds.has(activity.id)) {
      continue;
    }

    if (!activity.payload || !Predicate.isObjectOrArray(activity.payload)) continue;

    const authorizationUrl =
      "authorizationUrl" in activity.payload ? activity.payload.authorizationUrl : undefined;

    if (!Predicate.isString(authorizationUrl)) continue;

    try {
      const url = new URL(authorizationUrl);

      if (url.protocol === "https:") return { activityId: activity.id, url: url.href };
    } catch {
      // Ignore malformed server data.
    }
  }

  return null;
}

/**
 * Where a chat started outside any project goes: the organization's General project, else the
 * most recently active one.
 */
export function chatHomeProject<P extends { readonly id: string }>(
  projects: ReadonlyArray<P>,
  mostRecent: () => P | null,
): P | null {
  return projects.find((project) => project.id === GENERAL_PROJECT_ID) ?? mostRecent();
}
