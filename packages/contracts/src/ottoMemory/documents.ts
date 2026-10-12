import * as Schema from "effect/Schema";
import {
  BotId,
  GroupId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const OttoMemoryDocumentTarget = Schema.Literals(["user", "memory", "group"]);

export type OttoMemoryDocumentTarget = typeof OttoMemoryDocumentTarget.Type;

export const OttoMemoryFileOperation = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("add"),
    content: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    action: Schema.Literal("replace"),
    oldText: TrimmedNonEmptyString,
    content: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    action: Schema.Literal("remove"),
    oldText: TrimmedNonEmptyString,
  }),
]);

export type OttoMemoryFileOperation = typeof OttoMemoryFileOperation.Type;

export const OttoMemoryDocument = Schema.Struct({
  target: OttoMemoryDocumentTarget,
  content: Schema.String,
  charCount: NonNegativeInt,
  charLimit: PositiveInt,
  updatedAt: Schema.NullOr(IsoDateTime),
});

export type OttoMemoryDocument = typeof OttoMemoryDocument.Type;

export const OttoBotMemorySnapshot = Schema.Struct({
  botId: BotId,
  groupId: Schema.NullOr(GroupId),
  user: OttoMemoryDocument,
  memory: OttoMemoryDocument,
  group: Schema.NullOr(OttoMemoryDocument),
});

export type OttoBotMemorySnapshot = typeof OttoBotMemorySnapshot.Type;

export const OttoMemoryFileMutationInput = Schema.Struct({
  botId: BotId,
  groupId: Schema.NullOr(GroupId),
  groupMemberBotIds: Schema.Array(BotId),
  target: OttoMemoryDocumentTarget,
  operations: Schema.Array(OttoMemoryFileOperation),
});

export type OttoMemoryFileMutationInput = typeof OttoMemoryFileMutationInput.Type;

export const OttoMemoryFileMutationResult = Schema.Struct({
  document: OttoMemoryDocument,
  applied: PositiveInt,
  changed: Schema.Boolean,
});

export type OttoMemoryFileMutationResult = typeof OttoMemoryFileMutationResult.Type;

export const OttoMemoryDocumentsInspectInput = Schema.Struct({ threadId: ThreadId });

export type OttoMemoryDocumentsInspectInput = typeof OttoMemoryDocumentsInspectInput.Type;

export const OttoMemoryDocumentsSnapshot = Schema.Struct({
  ...OttoBotMemorySnapshot.fields,
  conversation: Schema.Struct({
    current: Schema.NullOr(
      Schema.Struct({
        generationCount: Schema.Number,
        activeObservations: Schema.String,
        createdAt: IsoDateTime,
        updatedAt: IsoDateTime,
      }),
    ),
    history: Schema.Array(
      Schema.Struct({
        generationCount: Schema.Number,
        activeObservations: Schema.String,
        createdAt: IsoDateTime,
        updatedAt: IsoDateTime,
      }),
    ),
  }),
});

export type OttoMemoryDocumentsSnapshot = typeof OttoMemoryDocumentsSnapshot.Type;

export const OttoMemoryDocumentReplaceInput = Schema.Struct({
  threadId: ThreadId,
  expectedBotId: BotId,
  expectedContent: Schema.String,
  target: OttoMemoryDocumentTarget,
  content: Schema.String,
});

export type OttoMemoryDocumentReplaceInput = typeof OttoMemoryDocumentReplaceInput.Type;

export const OttoMemoryObservationsClearInput = Schema.Struct({ threadId: ThreadId });

export type OttoMemoryObservationsClearInput = typeof OttoMemoryObservationsClearInput.Type;
