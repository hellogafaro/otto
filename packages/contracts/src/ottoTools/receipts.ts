import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  BotId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { OttoAwaitHandleId } from "./inputs.ts";
import { OttoToolApprovalClass } from "./catalog.ts";

export const OttoToolReceiptPhase = Schema.Literals([
  "start",
  "progress",
  "approval",
  "success",
  "failure",
  "cancellation",
]);

export const OttoToolFailureCode = Schema.Literals([
  "validation",
  "denied",
  "not_found",
  "timeout",
  "cancelled",
  "internal",
]);

export const OttoToolReceipt = Schema.Struct({
  receiptId: TrimmedNonEmptyString,
  toolId: TrimmedNonEmptyString,
  phase: OttoToolReceiptPhase,
  threadId: ThreadId,
  botId: Schema.optional(BotId),
  handleId: Schema.optional(OttoAwaitHandleId),
  summary: Schema.optional(TrimmedNonEmptyString),
  authorizationUrl: Schema.optional(TrimmedNonEmptyString),
  progress: Schema.optional(NonNegativeInt),
  approvalClass: Schema.optional(OttoToolApprovalClass),
  failureCode: Schema.optional(OttoToolFailureCode),
  fatalToThread: Schema.Literal(false).pipe(
    Schema.withDecodingDefault(Effect.succeed(false as const)),
  ),
  billedBotId: Schema.optional(BotId),
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.optional(NonNegativeInt),
      outputTokens: Schema.optional(NonNegativeInt),
      costUsd: Schema.optional(Schema.Number),
    }),
  ),
  createdAt: IsoDateTime,
});

export type OttoToolReceipt = typeof OttoToolReceipt.Type;
