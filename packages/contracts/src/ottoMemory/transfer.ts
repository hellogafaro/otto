import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  BotId,
  GroupId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { OttoMemoryRootId, OttoMemoryRevision, OttoMemoryCandidate } from "./base.ts";
import { OttoMemoryDocumentTarget } from "./documents.ts";

// Scopes a bot may propose through the memory tool. Private and bot-only
// facts belong in the bot's own memory documents.
export const OttoMemoryShareScope = Schema.Literals(["project", "group", "workspace"]);

export type OttoMemoryShareScope = typeof OttoMemoryShareScope.Type;

export const OttoMemoryArchiveFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  mediaType: Schema.Literal("text/markdown"),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  content: Schema.String,
});

export type OttoMemoryArchiveFile = typeof OttoMemoryArchiveFile.Type;

export const OttoMemoryArchiveV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  threadId: ThreadId,
  complete: Schema.Boolean,
  createdAt: IsoDateTime,
  files: Schema.Array(OttoMemoryArchiveFile),
  manifestSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMemoryArchiveV1 = typeof OttoMemoryArchiveV1.Type;

export const OttoMemoryArchiveTarget = Schema.Literals([
  "thread",
  "bot",
  "project",
  "workspace",
  "all",
]);

export type OttoMemoryArchiveTarget = typeof OttoMemoryArchiveTarget.Type;

export const OttoMemoryArchiveRevision = Schema.Struct({
  revision: OttoMemoryRevision,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMemoryArchiveRevision = typeof OttoMemoryArchiveRevision.Type;

export const OttoMemoryInspectInput = Schema.Struct({ threadId: ThreadId });

export type OttoMemoryInspectInput = typeof OttoMemoryInspectInput.Type;

export const OttoConversationMemoryRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  generationCount: NonNegativeInt,
  originType: Schema.Literals(["initial", "reflection"]),
  activeObservations: Schema.String,
  bufferedObservations: Schema.String,
  bufferedReflection: Schema.NullOr(Schema.String),
  totalTokensObserved: NonNegativeInt,
  observationTokenCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type OttoConversationMemoryRecord = typeof OttoConversationMemoryRecord.Type;

export const OttoConversationMemorySnapshot = Schema.Struct({
  current: Schema.NullOr(OttoConversationMemoryRecord),
  history: Schema.Array(OttoConversationMemoryRecord),
});

export type OttoConversationMemorySnapshot = typeof OttoConversationMemorySnapshot.Type;

export const OttoMarkdownMemoryArchiveDocument = Schema.Struct({
  botId: BotId,
  groupId: Schema.NullOr(GroupId),
  target: OttoMemoryDocumentTarget,
  path: TrimmedNonEmptyString,
  content: Schema.String,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMarkdownMemoryArchiveDocument = typeof OttoMarkdownMemoryArchiveDocument.Type;

export const OttoMarkdownMemoryArchiveV3 = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  anchorThreadId: ThreadId,
  botId: BotId,
  groupId: Schema.NullOr(GroupId),
  createdAt: IsoDateTime,
  documents: Schema.Array(OttoMarkdownMemoryArchiveDocument),
  conversation: Schema.Struct({
    snapshot: OttoConversationMemorySnapshot,
    sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  }),
  manifestSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMarkdownMemoryArchiveV3 = typeof OttoMarkdownMemoryArchiveV3.Type;

export const OttoMarkdownMemoryExportInput = Schema.Struct({
  threadId: ThreadId,
  target: OttoMemoryArchiveTarget.pipe(
    Schema.withDecodingDefault(Effect.succeed("thread" as const)),
  ),
  complete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});

export type OttoMarkdownMemoryExportInput = typeof OttoMarkdownMemoryExportInput.Type;

export const OttoMarkdownMemoryImportPreviewInput = Schema.Struct({
  threadId: ThreadId,
  archive: OttoMarkdownMemoryArchiveV3,
});

export type OttoMarkdownMemoryImportPreviewInput = typeof OttoMarkdownMemoryImportPreviewInput.Type;

export const OttoMarkdownMemoryImportPreviewItem = Schema.Struct({
  target: OttoMemoryDocumentTarget,
  classification: Schema.Literals(["new", "changed", "unchanged"]),
  charCount: NonNegativeInt,
  charLimit: PositiveInt,
});

export type OttoMarkdownMemoryImportPreviewItem = typeof OttoMarkdownMemoryImportPreviewItem.Type;

export const OttoMarkdownMemoryImportPreview = Schema.Struct({
  previewHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  documents: Schema.Array(OttoMarkdownMemoryImportPreviewItem),
  restoresObservations: Schema.Boolean,
});

export type OttoMarkdownMemoryImportPreview = typeof OttoMarkdownMemoryImportPreview.Type;

export const OttoMarkdownMemoryImportApplyInput = Schema.Struct({
  ...OttoMarkdownMemoryImportPreviewInput.fields,
  previewHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMarkdownMemoryImportApplyInput = typeof OttoMarkdownMemoryImportApplyInput.Type;

export const OttoMarkdownMemoryImportApplyResult = Schema.Struct({
  changedDocuments: NonNegativeInt,
  restoredObservations: Schema.Boolean,
});

export type OttoMarkdownMemoryImportApplyResult = typeof OttoMarkdownMemoryImportApplyResult.Type;

export const OttoMemoryArchiveConversation = Schema.Struct({
  threadId: ThreadId,
  snapshot: OttoConversationMemorySnapshot,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMemoryArchiveConversation = typeof OttoMemoryArchiveConversation.Type;

export const OttoMemoryArchiveV2 = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  anchorThreadId: ThreadId,
  target: OttoMemoryArchiveTarget,
  complete: Schema.Boolean,
  createdAt: IsoDateTime,
  files: Schema.Array(OttoMemoryArchiveFile),
  revisions: Schema.Array(OttoMemoryArchiveRevision),
  conversations: Schema.Array(OttoMemoryArchiveConversation),
  manifestSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export type OttoMemoryArchiveV2 = typeof OttoMemoryArchiveV2.Type;

export const OttoMemorySnapshot = Schema.Struct({
  threadId: ThreadId,
  durable: Schema.Array(OttoMemoryRevision),
  histories: Schema.Array(
    Schema.Struct({
      rootId: OttoMemoryRootId,
      revisions: Schema.Array(OttoMemoryRevision),
    }),
  ),
  pending: Schema.Array(OttoMemoryCandidate),
  conversation: OttoConversationMemorySnapshot,
});

export type OttoMemorySnapshot = typeof OttoMemorySnapshot.Type;

export const OttoMemoryExportInput = Schema.Struct({
  threadId: ThreadId,
  complete: Schema.Boolean,
  target: OttoMemoryArchiveTarget.pipe(
    Schema.withDecodingDefault(Effect.succeed("thread" as const)),
  ),
});

export type OttoMemoryExportInput = typeof OttoMemoryExportInput.Type;

export const OttoMemoryImportClassification = Schema.Literals([
  "new",
  "changed",
  "conflicting",
  "skipped",
]);

export type OttoMemoryImportClassification = typeof OttoMemoryImportClassification.Type;

export const OttoMemoryImportPreviewItem = Schema.Struct({
  rootId: OttoMemoryRootId,
  classification: OttoMemoryImportClassification,
  reason: TrimmedNonEmptyString,
});

export type OttoMemoryImportPreviewItem = typeof OttoMemoryImportPreviewItem.Type;

export const OttoMemoryImportPreviewInput = Schema.Struct({
  threadId: ThreadId,
  target: OttoMemoryArchiveTarget,
  archive: OttoMemoryArchiveV2,
});

export type OttoMemoryImportPreviewInput = typeof OttoMemoryImportPreviewInput.Type;

export const OttoMemoryImportPreview = Schema.Struct({
  previewHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  items: Schema.Array(OttoMemoryImportPreviewItem),
});

export type OttoMemoryImportPreview = typeof OttoMemoryImportPreview.Type;

export const OttoMemoryImportApplyInput = Schema.Struct({
  ...OttoMemoryImportPreviewInput.fields,
  previewHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  resolutions: Schema.Array(
    Schema.Struct({
      rootId: OttoMemoryRootId,
      decision: Schema.Literals(["keep-local", "use-archive"]),
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

export type OttoMemoryImportApplyInput = typeof OttoMemoryImportApplyInput.Type;

export const OttoMemoryImportApplyResult = Schema.Struct({
  imported: NonNegativeInt,
  changed: NonNegativeInt,
  skipped: NonNegativeInt,
});

export type OttoMemoryImportApplyResult = typeof OttoMemoryImportApplyResult.Type;
