import type {
  OttoMemoryId,
  OttoMemoryMutation,
  OttoMemoryRevision,
  OttoMemoryRootId,
  OttoMemoryTargetScope,
  OttoMemoryThreadAccess,
  OttoMemoryImportPreview,
  OttoMemoryImportApplyResult,
  MessageId,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { OttoMemoryAccessDenied } from "../EntityMemoryAccess.ts";
import type { AuthorizedMemoryPartition } from "../EntityMemoryAccess.ts";

export class EntityMemoryConflictError extends Schema.TaggedErrorClass<EntityMemoryConflictError>()(
  "EntityMemoryConflictError",
  {
    rootId: Schema.String,
    expectedRevision: Schema.Number,
    actualRevision: Schema.NullOr(Schema.Number),
  },
) {
  override get message(): string {
    return `Memory revision conflict for ${this.rootId}. Expected ${this.expectedRevision}, found ${this.actualRevision ?? "none"}.`;
  }
}

export class EntityMemoryNotFoundError extends Schema.TaggedErrorClass<EntityMemoryNotFoundError>()(
  "EntityMemoryNotFoundError",
  { rootId: Schema.String },
) {
  override get message(): string {
    return `Memory ${this.rootId} does not exist.`;
  }
}

export interface SearchEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly query: string;
  readonly limit: number;
}

export interface GetEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly rootId: OttoMemoryRootId;
}

export interface ListEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
}

export interface ListEntityMemoryPartitionsInput {
  readonly access: OttoMemoryThreadAccess;
  readonly partitions: ReadonlyArray<AuthorizedMemoryPartition>;
  readonly complete: boolean;
}

export interface DeleteEntityMemoryInput extends GetEntityMemoryInput {}

export interface InsertEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly revision: OttoMemoryRevision;
}

export interface ReviseEntityMemoryInput extends InsertEntityMemoryInput {
  readonly expectedRevision: number;
}

export interface ApplyEntityMemoryMutationInput {
  readonly access: OttoMemoryThreadAccess;
  readonly mutation: Extract<OttoMemoryMutation, { readonly operation: `fact.${string}` }>;
  readonly memoryId: OttoMemoryId;
  readonly updatedAt: string;
  /** Shared-scope policy for a mutation that lands a fact on a shared scope. */
  readonly sharedProjectApproval: "approved" | "pending";
}

// Writes a new approved fact to the partition that backs a target scope for
// the given thread access. Used when a person approves a memory candidate.
export interface InsertScopedEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly scope: OttoMemoryTargetScope;
  readonly fact: string;
  readonly sensitive: boolean;
  readonly confidence: number;
  readonly sourceMessageId: MessageId | null;
  readonly memoryId: OttoMemoryId;
  readonly createdAt: string;
}

export interface TombstoneEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly rootId: OttoMemoryRootId;
  readonly expectedRevision: number;
  readonly memoryId: OttoMemoryId;
  readonly updatedAt: string;
}

export interface ImportEntityMemoryInput {
  readonly access: OttoMemoryThreadAccess;
  readonly partitions: ReadonlyArray<AuthorizedMemoryPartition>;
  readonly revisions: ReadonlyArray<OttoMemoryRevision>;
}

export interface ApplyEntityMemoryImportInput extends ImportEntityMemoryInput {
  readonly previewHash: string;
  readonly resolutions?: ReadonlyArray<{
    readonly rootId: OttoMemoryRootId;
    readonly decision: "keep-local" | "use-archive";
  }>;
}

export class EntityMemoryImportError extends Schema.TaggedErrorClass<EntityMemoryImportError>()(
  "EntityMemoryImportError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export type EntityMemoryRepositoryError =
  | ProjectionRepositoryError
  | OttoMemoryAccessDenied
  | EntityMemoryConflictError
  | EntityMemoryNotFoundError
  | EntityMemoryImportError;

export interface EntityMemoryRepositoryShape {
  readonly recordDerivedCopies?: (input: {
    readonly tenantId: string;
    readonly threadId: string;
    readonly revisions: ReadonlyArray<OttoMemoryRevision>;
  }) => Effect.Effect<void, EntityMemoryRepositoryError>;
  readonly insert: (
    input: InsertEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryRevision, EntityMemoryRepositoryError>;
  readonly revise: (
    input: ReviseEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryRevision, EntityMemoryRepositoryError>;
  readonly tombstone: (
    input: TombstoneEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryRevision, EntityMemoryRepositoryError>;
  readonly getCurrent: (
    input: GetEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryRevision, EntityMemoryRepositoryError>;
  readonly search: (
    input: SearchEntityMemoryInput,
  ) => Effect.Effect<ReadonlyArray<OttoMemoryRevision>, EntityMemoryRepositoryError>;
  readonly listCurrent: (
    input: ListEntityMemoryInput,
  ) => Effect.Effect<ReadonlyArray<OttoMemoryRevision>, EntityMemoryRepositoryError>;
  readonly listHistory: (
    input: GetEntityMemoryInput,
  ) => Effect.Effect<ReadonlyArray<OttoMemoryRevision>, EntityMemoryRepositoryError>;
  readonly listByPartitions: (
    input: ListEntityMemoryPartitionsInput,
  ) => Effect.Effect<ReadonlyArray<OttoMemoryRevision>, EntityMemoryRepositoryError>;
  readonly previewImport: (
    input: ImportEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryImportPreview, EntityMemoryRepositoryError>;
  readonly applyImport: (
    input: ApplyEntityMemoryImportInput,
  ) => Effect.Effect<OttoMemoryImportApplyResult, EntityMemoryRepositoryError>;
  readonly deleteRoot: (
    input: DeleteEntityMemoryInput,
  ) => Effect.Effect<void, EntityMemoryRepositoryError>;
  readonly insertScopedFact: (
    input: InsertScopedEntityMemoryInput,
  ) => Effect.Effect<OttoMemoryRevision, EntityMemoryRepositoryError>;
  readonly applyMutation: (
    input: ApplyEntityMemoryMutationInput,
  ) => Effect.Effect<OttoMemoryRevision | null, EntityMemoryRepositoryError>;
}

export class EntityMemoryRepository extends Context.Service<
  EntityMemoryRepository,
  EntityMemoryRepositoryShape
>()("@otto/server/memory/Services/EntityMemoryRepository") {}
