import * as Predicate from "effect/Predicate";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  AssetAttachmentNotFoundError,
  AttachmentNotFoundError,
  WS_METHODS,
  WsRpcGroup,
} from "@otto/contracts";
import { issueAssetUrl } from "./assets/asset-access.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "./assets/attachment-upload.ts";
import { resolveAttachmentPathById } from "./attachment-store.ts";
import { canReadAttachment } from "./orchestration/group-visibility.ts";

import { projectEntriesFailureContext, projectFileFailureContext } from "./ws-support.ts";
import type { WsConnection } from "./ws-connection.ts";

export const createWsWorkspaceHandlers = ({
  currentSession,
  currentPersonId,
  projectionSnapshotQuery,
  projectionGroups,
  projectionThreadMessages,
  externalLauncher,
  config,
  workspaceEntries,
  workspaceFileSystem,
  observeRpcEffect,
}: Pick<
  WsConnection,
  | "currentSession"
  | "currentPersonId"
  | "projectionSnapshotQuery"
  | "projectionGroups"
  | "projectionThreadMessages"
  | "externalLauncher"
  | "config"
  | "workspaceEntries"
  | "workspaceFileSystem"
  | "observeRpcEffect"
>) =>
  ({
    [WS_METHODS.projectsSearchEntries]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsSearchEntries,
        workspaceEntries.search(input).pipe(
          Effect.mapError((cause) =>
            ProjectSearchEntriesError.fromContext({
              cwd: input.cwd,
              queryLength: input.query.length,
              limit: input.limit,
              ...projectEntriesFailureContext(cause),
              cause,
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),

    [WS_METHODS.projectsListEntries]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsListEntries,
        workspaceEntries.list(input).pipe(
          Effect.mapError((cause) =>
            ProjectListEntriesError.fromContext({
              ...input,
              ...projectEntriesFailureContext(cause),
              cause,
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),

    [WS_METHODS.projectsReadFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsReadFile,
        workspaceFileSystem.readFile(input).pipe(
          Effect.mapError((cause) =>
            ProjectReadFileError.fromContext({
              ...input,
              ...projectFileFailureContext(cause),
              cause,
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),

    [WS_METHODS.projectsWriteFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsWriteFile,
        workspaceFileSystem.writeFile(input).pipe(
          Effect.mapError((cause) =>
            ProjectWriteFileError.fromContext({
              cwd: input.cwd,
              relativePath: input.relativePath,
              ...projectFileFailureContext(cause),
              cause,
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),

    [WS_METHODS.shellOpenInEditor]: (input) =>
      observeRpcEffect(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input), {
        "rpc.aggregate": "workspace",
      }),

    [WS_METHODS.shellRevealAttachment]: (input) =>
      observeRpcEffect(
        WS_METHODS.shellRevealAttachment,
        Effect.gen(function* () {
          const path = resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: input.attachmentId,
          });

          if (!path) {
            return yield* new AttachmentNotFoundError({ attachmentId: input.attachmentId });
          }

          yield* externalLauncher.launchEditor({
            cwd: path,
            editor: "file-manager",
            reveal: true,
          });
        }),
        { "rpc.aggregate": "workspace" },
      ),

    [WS_METHODS.attachmentsCreateUploadUrl]: (input) =>
      observeRpcEffect(WS_METHODS.attachmentsCreateUploadUrl, issueAttachmentUploadUrl(input), {
        "rpc.aggregate": "workspace",
      }),

    [WS_METHODS.attachmentsDelete]: (input) =>
      observeRpcEffect(WS_METHODS.attachmentsDelete, deletePendingAttachment(input.attachmentId), {
        "rpc.aggregate": "workspace",
      }),

    [WS_METHODS.assetsCreateUrl]: (input) =>
      observeRpcEffect(
        WS_METHODS.assetsCreateUrl,
        Effect.gen(function* () {
          if (Predicate.isTagged(input.resource, "attachment")) {
            const readable = yield* canReadAttachment(
              { projectionSnapshotQuery, projectionGroups, projectionThreadMessages },
              input.resource.attachmentId,
              currentPersonId,
            );

            if (!readable) {
              return yield* new AssetAttachmentNotFoundError({ resource: input.resource });
            }

            return yield* issueAssetUrl({
              resource: input.resource,
              sessionId: currentSession.sessionId,
            });
          }

          const thread = yield* projectionSnapshotQuery
            .getThreadShellById(input.resource.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );

          if (Option.isNone(thread)) {
            return yield* new AssetWorkspaceContextNotFoundError({
              resource: input.resource,
            });
          }

          const project = yield* projectionSnapshotQuery
            .getProjectShellById(thread.value.projectId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );

          if (Option.isNone(project)) {
            return yield* new AssetWorkspaceContextNotFoundError({
              resource: input.resource,
            });
          }

          return yield* issueAssetUrl({
            resource: input.resource,
            sessionId: currentSession.sessionId,
            workspaceRoot: thread.value.worktreePath ?? project.value.workspaceRoot,
          });
        }),
        { "rpc.aggregate": "workspace" },
      ),
  }) satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.projectsSearchEntries
    | typeof WS_METHODS.projectsListEntries
    | typeof WS_METHODS.projectsReadFile
    | typeof WS_METHODS.projectsWriteFile
    | typeof WS_METHODS.shellOpenInEditor
    | typeof WS_METHODS.shellRevealAttachment
    | typeof WS_METHODS.attachmentsCreateUploadUrl
    | typeof WS_METHODS.attachmentsDelete
    | typeof WS_METHODS.assetsCreateUrl
  >;
