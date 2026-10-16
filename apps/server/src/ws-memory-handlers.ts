import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Effect from "effect/Effect";
import {
  isGroupBotMember,
  MEMORY_SCOPE_CAPS,
  type Memory,
  MemoryError,
  type MemoryScope,
  type MemorySection,
  WORKSPACE_MEMORY_SCOPE_ID,
  WS_METHODS,
  WsRpcGroup,
} from "@otto/contracts";

import { canSeeGroup, canSeeThread, canSeeThreadById } from "./orchestration/group-visibility.ts";
import { memoryOperationError } from "./ws-support.ts";
import type { WsConnection } from "./ws-connection.ts";

/** The old Markdown and fact RPCs, kept so older apps get a clear answer. */
const replaced = (operation: string) => () =>
  Effect.fail(
    memoryOperationError(operation, "This memory view was replaced. Open the bot's Memory panel."),
  );

export const createWsMemoryHandlers = ({
  agentController,
  memories,
  currentPersonId,
  projectionSnapshotQuery,
  projectionGroups,
  observeRpcEffect,
}: Pick<
  WsConnection,
  | "agentController"
  | "memories"
  | "currentPersonId"
  | "projectionSnapshotQuery"
  | "projectionGroups"
  | "observeRpcEffect"
>) => {
  const fail = (message: string) => Effect.fail(new MemoryError({ message }));

  const service = memories === null ? fail("Memory is unavailable.") : Effect.succeed(memories);

  const shell = projectionSnapshotQuery
    .getShellSnapshot()
    .pipe(Effect.mapError(() => new MemoryError({ message: "Memory could not be read." })));

  type Shell = Effect.Success<typeof shell>;

  /** Person memory belongs to its person; group memory to the people who can see the group. */
  const canReach = (shellSnapshot: Shell, scope: MemoryScope, scopeId: string) => {
    if (scope === "person") return scopeId === currentPersonId;

    if (scope !== "group") return true;

    return shellSnapshot.groups.some(
      (group) => group.id === scopeId && canSeeGroup(group, currentPersonId),
    );
  };

  /** An entry this person may change, by id. */
  const reachable = (id: string) =>
    Effect.all([service, shell]).pipe(
      Effect.flatMap(([memoriesService, shellSnapshot]) =>
        memoriesService
          .get(id)
          .pipe(
            Effect.flatMap((row) =>
              canReach(shellSnapshot, row.scope, row.scopeId)
                ? Effect.succeed({ memoriesService, row })
                : fail(`${id} does not exist.`),
            ),
          ),
      ),
    );

  return {
    [WS_METHODS.memoryExport]: replaced("documents.export"),
    [WS_METHODS.memoryImportPreview]: replaced("documents.importPreview"),
    [WS_METHODS.memoryImportApply]: replaced("documents.importApply"),
    [WS_METHODS.memoryArchiveExport]: replaced("archive.export"),
    [WS_METHODS.memoryArchivePreviewImport]: replaced("archive.previewImport"),
    [WS_METHODS.memoryArchiveApplyImport]: replaced("archive.applyImport"),
    [WS_METHODS.memoryFactsList]: replaced("facts.list"),
    [WS_METHODS.memoryFactMutate]: replaced("facts.mutate"),
    [WS_METHODS.memoryDocumentsInspect]: replaced("documents.inspect"),
    [WS_METHODS.memoryDocumentReplace]: replaced("document.replace"),

    [WS_METHODS.memoryObservationsClear]: (input) =>
      observeRpcEffect(
        WS_METHODS.memoryObservationsClear,
        Effect.gen(function* () {
          const visible = yield* canSeeThreadById(
            { projectionSnapshotQuery, projectionGroups },
            input.threadId,
            currentPersonId,
          );

          if (!visible || !agentController.clearConversationMemory) {
            return yield* memoryOperationError(
              "observations.clear",
              "Observational memory is unavailable.",
            );
          }

          yield* agentController
            .clearConversationMemory(input.threadId)
            .pipe(Effect.mapError((cause) => memoryOperationError("observations.clear", cause)));
        }),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryList]: ({ botId }) =>
      observeRpcEffect(
        WS_METHODS.memoryList,
        Effect.gen(function* () {
          const memoriesService = yield* service;
          const shellSnapshot = yield* shell;

          const groups = shellSnapshot.groups.filter(
            (group) =>
              group.members.some((member) => isGroupBotMember(member) && member.botId === botId) &&
              canSeeGroup(group, currentPersonId),
          );

          const rows = yield* memoriesService.list([
            ["person", currentPersonId],
            ["bot", botId],
            ...groups.map((group) => ["group", group.id] as const),
            ...shellSnapshot.projects.map((project) => ["project", project.id] as const),
            ["workspace", WORKSPACE_MEMORY_SCOPE_ID],
          ]);

          const threadTitles = new Map(
            shellSnapshot.threads
              .filter((thread) => canSeeThread(thread, shellSnapshot.groups, currentPersonId))
              .map((thread) => [String(thread.id), thread.title]),
          );

          const section = (scope: MemoryScope, scopeId: string, title: string): MemorySection => {
            const entries = rows.filter((row) => row.scope === scope && row.scopeId === scopeId);

            return {
              scope,
              scopeId,
              title,
              used: entries.reduce((total, row) => total + row.text.length, 0),
              cap: MEMORY_SCOPE_CAPS[scope],
              memories: entries.map(
                (row): Memory => ({
                  ...row,
                  threadTitle: row.threadId ? (threadTitles.get(row.threadId) ?? null) : null,
                }),
              ),
            };
          };

          // About you and the bot always show; shared scopes only once they hold something.
          const shared = [
            ...groups.map((group) => section("group", group.id, group.name)),
            ...shellSnapshot.projects.map((project) =>
              section("project", project.id, project.title),
            ),
            section("workspace", WORKSPACE_MEMORY_SCOPE_ID, ""),
          ].filter((candidate) => candidate.memories.length > 0);

          return {
            sections: [
              section("person", currentPersonId, ""),
              section("bot", botId, ""),
              ...shared,
            ],
          };
        }),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryCreate]: (input) =>
      observeRpcEffect(
        WS_METHODS.memoryCreate,
        Effect.gen(function* () {
          const memoriesService = yield* service;

          if (!canReach(yield* shell, input.scope, input.scopeId)) {
            return yield* fail("You cannot add to this memory.");
          }

          return yield* memoriesService.create({ personId: currentPersonId, ...input });
        }),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryUpdate]: (input) =>
      observeRpcEffect(
        WS_METHODS.memoryUpdate,
        reachable(input.id).pipe(
          Effect.flatMap(({ memoriesService, row }) =>
            row.status === "active"
              ? memoriesService.update({ personId: currentPersonId, row, text: input.text })
              : fail("Approve or reject this entry instead."),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryDelete]: (input) =>
      observeRpcEffect(
        WS_METHODS.memoryDelete,
        reachable(input.id).pipe(
          Effect.flatMap(({ memoriesService, row }) =>
            row.status === "active"
              ? memoriesService.remove(row.id).pipe(Effect.asVoid)
              : fail("Approve or reject this entry instead."),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryDecide]: (input) =>
      observeRpcEffect(
        WS_METHODS.memoryDecide,
        reachable(input.id).pipe(
          Effect.flatMap(({ memoriesService, row }) =>
            row.status === "pending"
              ? memoriesService
                  .decide({
                    personId: currentPersonId,
                    row,
                    decision: input.decision,
                    text: input.text,
                  })
                  .pipe(Effect.asVoid)
              : fail("This entry was already decided."),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.memoryExport
    | typeof WS_METHODS.memoryImportPreview
    | typeof WS_METHODS.memoryImportApply
    | typeof WS_METHODS.memoryArchiveExport
    | typeof WS_METHODS.memoryArchivePreviewImport
    | typeof WS_METHODS.memoryArchiveApplyImport
    | typeof WS_METHODS.memoryFactsList
    | typeof WS_METHODS.memoryFactMutate
    | typeof WS_METHODS.memoryDocumentsInspect
    | typeof WS_METHODS.memoryDocumentReplace
    | typeof WS_METHODS.memoryObservationsClear
    | typeof WS_METHODS.memoryList
    | typeof WS_METHODS.memoryCreate
    | typeof WS_METHODS.memoryUpdate
    | typeof WS_METHODS.memoryDelete
    | typeof WS_METHODS.memoryDecide
  >;
};
