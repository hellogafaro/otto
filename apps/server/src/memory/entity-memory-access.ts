import * as Match from "effect/Match";
import * as NodeCrypto from "node:crypto";

import {
  OttoMemoryPartitionId,
  type OttoMemoryPartition,
  type OttoMemoryThreadAccess,
  type OttoMemoryVisibility,
  type ProjectId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface AuthorizedMemoryPartition extends OttoMemoryPartition {
  readonly visibility: OttoMemoryVisibility;
}

export class OttoMemoryAccessDenied extends Schema.TaggedErrorClass<OttoMemoryAccessDenied>()(
  "OttoMemoryAccessDenied",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const partition = (
  input: OttoMemoryThreadAccess,
  scope: OttoMemoryPartition["scope"],
  partitionId: string,
  visibility: OttoMemoryVisibility,
): AuthorizedMemoryPartition => ({
  tenantId: input.tenantId,
  scope,
  partitionId: OttoMemoryPartitionId.make(partitionId),
  visibility,
});

export function deriveOttoWorkspaceId(projectId: ProjectId): OttoMemoryPartitionId {
  return OttoMemoryPartitionId.make(`workspace:${projectId}`);
}

const workspacePartitions = (input: OttoMemoryThreadAccess) => {
  const canonical = partition(input, "workspace", deriveOttoWorkspaceId(input.projectId), "shared");

  if (input.legacyWorkspaceOwnerProjectId !== input.projectId) return [canonical];

  return [
    canonical,
    partition(
      input,
      "workspace",
      `workspace:${NodeCrypto.createHash("sha256").update(input.workspaceRoot).digest("hex")}`,
      "shared",
    ),
  ];
};

export function resolveAuthorizedMemoryPartitions(
  input: OttoMemoryThreadAccess,
): Effect.Effect<ReadonlyArray<AuthorizedMemoryPartition>, OttoMemoryAccessDenied> {
  if (input.groupId !== null) {
    const respondingBotId = input.respondingBotId ?? input.botId;

    if (
      respondingBotId === null ||
      !input.groupMemberBotIds.some((memberBotId) => memberBotId === respondingBotId)
    ) {
      return Effect.fail(
        new OttoMemoryAccessDenied({
          reason: "The responding bot is not a current member of this thread's group.",
        }),
      );
    }

    return Effect.succeed([
      partition(input, "group", input.groupId, "shared"),
      partition(input, "project", input.projectId, "shared"),
      ...workspacePartitions(input),
      partition(input, "thread", input.threadId, "shared"),
    ]);
  }

  if (input.botId !== null) {
    return Effect.succeed([
      partition(input, "user", input.userId, "private"),
      partition(input, "bot-user", `${input.botId}:${input.userId}`, "private"),
      partition(input, "bot", input.botId, "private"),
      partition(input, "project", input.projectId, "shared"),
      ...workspacePartitions(input),
      partition(input, "thread", input.threadId, "private"),
    ]);
  }

  return Effect.succeed([
    partition(input, "project", input.projectId, "shared"),
    ...workspacePartitions(input),
    partition(input, "thread", input.threadId, "shared"),
  ]);
}

export function resolveMemoryArchivePartitions(
  input: OttoMemoryThreadAccess,
  target: "thread" | "bot" | "project" | "workspace" | "all",
): Effect.Effect<ReadonlyArray<AuthorizedMemoryPartition>, OttoMemoryAccessDenied> {
  return resolveAuthorizedMemoryPartitions(input).pipe(
    Effect.flatMap((partitions) => {
      const selected = Match.value(target).pipe(
        Match.when("all", () => partitions),
        Match.when("thread", () => partitions.filter((candidate) => candidate.scope === "thread")),
        Match.when("project", () =>
          partitions.filter((candidate) => candidate.scope === "project"),
        ),
        Match.when("workspace", () =>
          partitions.filter((candidate) => candidate.scope === "workspace"),
        ),
        Match.orElse(() =>
          partitions.filter(
            (candidate) => candidate.scope === "bot-user" || candidate.scope === "bot",
          ),
        ),
      );

      return selected.length > 0
        ? Effect.succeed(selected)
        : Effect.fail(
            new OttoMemoryAccessDenied({
              reason: `The ${target} memory target is not available to this thread.`,
            }),
          );
    }),
  );
}
