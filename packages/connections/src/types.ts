import { z } from "zod";

export const JSON_VALUE = z.json();
export type JsonValue = z.infer<typeof JSON_VALUE>;
const identifier = z.string().min(1).max(200);
export const CONNECTION_CONFIG = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("github"),
      appId: identifier,
      installationId: z.number().int().positive(),
      accountId: z.number().int().positive(),
      repositories: z
        .array(
          z
            .object({
              id: z.number().int().positive(),
              name: z
                .string()
                .regex(/^[\w.-]+\/[\w.-]+$/)
                .max(200),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      permissions: z
        .object({
          issues: z.enum(["read", "write"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcp"),
      endpoint: z.url().max(2000),
      tools: z
        .array(
          z
            .object({
              name: z
                .string()
                .regex(/^[\w.-]+$/)
                .max(100),
              targetArgument: identifier,
              // Server annotations are advisory. Only the human-configured policy is trusted.
              readOnly: z.boolean(),
            })
            .strict(),
        )
        .max(50),
      resources: z.array(z.string().min(1).max(2000)).max(100),
    })
    .strict(),
]);
export type ConnectionConfig = z.infer<typeof CONNECTION_CONFIG>;
export interface Discovery {
  actions: string[];
  resources: string[];
}
export const CONNECTION_AUDIENCE = z
  .object({
    humans: z.array(z.string().min(1).max(200)).max(500),
    agents: z.array(z.uuid()).max(100),
  })
  .strict();
export type ConnectionAudience = z.infer<typeof CONNECTION_AUDIENCE>;
export const RUN_PROOF = z
  .object({
    runId: z.uuid(),
    launchKey: z.uuid(),
    attempt: z.number().int().nonnegative(),
    environmentGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type RunProof = z.infer<typeof RUN_PROOF>;
export const OPERATION_REQUEST = RUN_PROOF.extend({
  connectionId: z.uuid(),
  requestId: z.uuid(),
  action: identifier,
  target: z.string().min(1).max(2000),
  arguments: z.record(z.string().max(200), JSON_VALUE),
}).strict();
export type OperationRequest = z.infer<typeof OPERATION_REQUEST>;
export const OPERATION_APPROVAL = z
  .object({
    identity: z.string().length(64),
  })
  .strict();
export interface OperationResult {
  operationId: string;
  connectionId: string;
  runId: string;
  action: string;
  target: string;
  value: JsonValue;
  audience: ConnectionAudience;
}
