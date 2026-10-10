import { DomainError, withCleanup } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { eq } from "drizzle-orm";
import { createGithubClient } from "./github";
import { type HttpOptions, MAX_OUTPUT_BYTES } from "./http";
import { connectionView, getConnectionRecord } from "./lifecycle";
import { createMcpClient } from "./mcp";
import {
  type ConnectionBoundary,
  getOperationRecord,
  operationRequest,
  operationView,
  requestOperation,
  validateOperation,
} from "./operations";
import { connections, operations } from "./schema";
import type { SecretResolver } from "./secrets";
import {
  CONNECTION_CONFIG,
  type Discovery,
  JSON_VALUE,
  type JsonValue,
  type OperationRequest,
} from "./types";

export { MCP_PROTOCOL_VERSION } from "./mcp";
export type { ConnectionBoundary, ValidateRun } from "./operations";
export {
  createInfisicalResolver,
  type InfisicalBinding,
  type SecretReference,
  type SecretResolver,
} from "./secrets";
export { CONNECTION_CONFIG } from "./types";

/** Concrete GitHub App/MCP HTTP composition. No credential is returned from any public method. */
export function createConnectionService(options: {
  boundary: ConnectionBoundary;
  secrets: SecretResolver;
  http: HttpOptions;
  allowAnonymousMcp?: boolean;
  githubEndpoint?: string;
}) {
  const { boundary } = options;
  const github = createGithubClient({
    endpoint: options.githubEndpoint,
    http: options.http,
  });
  const mcp = createMcpClient({ http: options.http });

  async function prepare(row: typeof connections.$inferSelect) {
    if (!row.config)
      throw new DomainError("unavailable", "Connection adapter unavailable");
    const config = CONNECTION_CONFIG.parse(row.config);
    const anonymous = config.type === "mcp" && config.authentication === "none";
    if (anonymous && !options.allowAnonymousMcp)
      throw new DomainError("unavailable", "Anonymous MCP is not configured");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.http.signal?.addEventListener("abort", abort, { once: true });
    if (options.http.signal?.aborted) controller.abort();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let credential = "";
    try {
      if (!anonymous) {
        if (!row.credentialRef)
          throw new DomainError(
            "unavailable",
            "Connection adapter unavailable",
          );
        credential = await Promise.race([
          options.secrets.resolve(
            {
              workspaceId: row.workspaceId,
              connectionId: row.id,
              credentialRef: row.credentialRef,
            },
            controller.signal,
          ),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => {
                controller.abort();
                reject(
                  new DomainError(
                    "unavailable",
                    "Credential deadline exceeded",
                  ),
                );
              },
              Math.min(options.http.timeoutMs ?? 10000, 10000),
            );
          }),
        ]);
        if (!credential || credential.length > 65536)
          throw new DomainError("unavailable");
      }
    } catch {
      throw new DomainError("unavailable", "Credential unavailable");
    } finally {
      clearTimeout(timeout);
      options.http.signal?.removeEventListener("abort", abort);
    }
    if (config.type === "github") {
      const access = await github.connect(config, credential);
      return {
        discovery: { actions: access.actions, resources: access.resources },
        expiresAt: access.expiresAt,
        execute: async (
          action: string,
          target: string,
          args: Record<string, JsonValue>,
        ) =>
          sanitize(await github.execute(config, access, action, target, args), [
            credential,
            access.token,
          ]),
        close: async () => {},
      };
    }
    const client = await mcp.connect(config, credential);
    return {
      discovery: client.discovery,
      expiresAt: null,
      execute: async (
        action: string,
        target: string,
        args: Record<string, JsonValue>,
      ) =>
        sanitize(
          await client.execute(action, target, args),
          anonymous ? [] : [credential],
        ),
      close: client.close,
    };
  }

  /** Connect and refresh authenticate from the same pinned credential reference, never another account. */
  async function connectConnection(id: string, editToken?: number) {
    const row = await boundary.transact(async (c) => {
      requireHuman(c);
      requireWriter(c);
      const current = await getConnectionRecord(c, id);
      if (current.createdBy !== c.actor.userId)
        throw new DomainError("forbidden");
      if (editToken !== undefined && current.editToken !== editToken)
        throw new DomainError("conflict", "Connection changed");
      await reserveCredentialLifetime(c, current);
      return current;
    });
    const prepared = await prepare(row);
    return withCleanup(async () => {
      return await boundary.transact(async (c) => {
        requireHuman(c);
        requireWriter(c);
        const current = await getConnectionRecord(c, id);
        if (
          current.createdBy !== c.actor.userId ||
          current.editToken !== row.editToken
        )
          throw new DomainError("conflict");
        await c.tx
          .update(connections)
          .set({
            connected: true,
            discovery: prepared.discovery,
            expiresAt: latestExpiry(current.expiresAt, prepared.expiresAt),
            updatedAt: new Date(),
          })
          .where(eq(connections.id, id));
        await advanceCursor(c);
        return connectionView(await getConnectionRecord(c, id));
      });
    }, prepared.close);
  }
  async function discoverConnection(id: string): Promise<Discovery> {
    await connectConnection(id);
    return boundary.transact(async (c) => {
      requireHuman(c);
      requireWriter(c);
      const row = await getConnectionRecord(c, id);
      if (row.createdBy !== c.actor.userId || !row.connected || !row.discovery)
        throw new DomainError("forbidden");
      return row.discovery;
    });
  }
  async function executeOperation(id: string) {
    const claimed = await boundary.transact(async (c) => {
      const row = await getOperationRecord(c, id);
      const authorization = await validateOperation(
        c,
        row,
        boundary.validateRun,
      );
      if (row.state !== "approved")
        return { row, connection: authorization.connection, claimed: false };
      await reserveCredentialLifetime(c, authorization.connection);
      const executionToken = crypto.randomUUID();
      const startedAt = new Date();
      await c.tx
        .update(operations)
        .set({
          state: "executing",
          executionToken,
          startedAt,
          updatedAt: startedAt,
        })
        .where(eq(operations.id, id));
      return {
        row: { ...row, state: "executing" as const, executionToken },
        connection: authorization.connection,
        claimed: true,
      };
    });
    if (!claimed.claimed) return operationView(claimed.row);
    let sent = false;
    let received = false;
    let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
    return withCleanup(
      async () => {
        try {
          prepared = await prepare(claimed.connection);
          // Credential resolution, installation scope verification and discovery are asynchronous.
          await boundary.transact(async (c) => {
            options.http.signal?.throwIfAborted();
            const row = await getOperationRecord(c, id);
            const authorization = await validateOperation(
              c,
              row,
              boundary.validateRun,
            );
            if (
              row.state !== "executing" ||
              row.executionToken !== claimed.row.executionToken
            )
              throw new DomainError("conflict");
            if (
              !prepared?.discovery.actions.includes(row.action) ||
              !prepared.discovery.resources.includes(row.target)
            )
              throw new DomainError("forbidden");
            await c.tx
              .update(connections)
              .set({
                expiresAt: latestExpiry(
                  authorization.connection.expiresAt,
                  prepared.expiresAt,
                ),
                updatedAt: new Date(),
              })
              .where(eq(connections.id, row.connectionId));
          });
          sent = true;
          const value = await prepared.execute(
            claimed.row.action,
            claimed.row.target,
            operationRequest(claimed.row).arguments,
          );
          received = true;
          return await boundary.transact(async (c) => {
            options.http.signal?.throwIfAborted();
            const row = await getOperationRecord(c, id);
            await validateOperation(c, row, boundary.validateRun);
            if (
              row.state !== "executing" ||
              row.executionToken !== claimed.row.executionToken
            )
              throw new DomainError("conflict");
            const completedAt = new Date();
            await c.tx
              .update(operations)
              .set({
                state: "succeeded",
                result: value,
                outcome: "completed",
                completedAt,
                updatedAt: completedAt,
              })
              .where(eq(operations.id, id));
            return operationView({
              ...row,
              state: "succeeded",
              outcome: "completed",
              updatedAt: completedAt,
            });
          });
        } catch {
          // Failure recording does not publish results or require a still-valid grant.
          // If the sponsor was removed entirely, the durable claim is recovered by recoverOperations.
          return boundary.transact(async (c) => {
            const row = await getOperationRecord(c, id);
            if (
              row.sponsorId !== c.actor.userId ||
              row.state !== "executing" ||
              row.executionToken !== claimed.row.executionToken
            )
              throw new DomainError("conflict");
            const state = sent && row.isWrite ? "uncertain" : "failed";
            const completedAt = new Date();
            const outcome =
              state === "uncertain"
                ? received
                  ? "result_withheld"
                  : "external_outcome_unknown"
                : "operation_failed";
            await c.tx
              .update(operations)
              .set({
                state,
                outcome,
                result: null,
                completedAt,
                updatedAt: completedAt,
              })
              .where(eq(operations.id, id));
            return operationView({
              ...row,
              state,
              outcome,
              updatedAt: completedAt,
            });
          });
        }
      },
      async () => {
        await prepared?.close();
      },
    );
  }
  return {
    connectConnection,
    discoverConnection,
    readOperation: (id: string) =>
      boundary.transact(async (c) => {
        const row = await getOperationRecord(c, id);
        if (
          !c.actor.agentId ||
          row.agentId !== c.actor.agentId ||
          row.sponsorId !== c.actor.userId
        )
          throw new DomainError("forbidden");
        await validateOperation(c, row, boundary.validateRun);
        return {
          ...operationView(row),
          result: row.state === "succeeded" ? row.result : null,
        };
      }),
    requestOperation: (input: OperationRequest) =>
      boundary.transact((c) =>
        requestOperation(c, input, boundary.validateRun),
      ),
    executeOperation,
  };
}
function sanitize(value: unknown, secrets: string[]): JsonValue {
  const parsed = JSON_VALUE.safeParse(value);
  if (!parsed.success) throw new DomainError("unavailable");
  const text = JSON.stringify(parsed.data);
  if (
    Buffer.byteLength(text) > MAX_OUTPUT_BYTES ||
    secrets.some(
      (secret) =>
        text.includes(secret) ||
        text.includes(JSON.stringify(secret).slice(1, -1)),
    )
  )
    throw new DomainError("unavailable", "Provider output rejected");
  return parsed.data;
}

function latestExpiry(saved: Date | null, received: Date | null) {
  return saved && (!received || saved > received) ? saved : received;
}
/** Persist a conservative one-hour token lifetime before minting; disconnect can race token issuance. */
async function reserveCredentialLifetime(
  c: Context,
  row: typeof connections.$inferSelect,
) {
  if (row.type !== "github") return;
  await c.tx
    .update(connections)
    .set({
      expiresAt: latestExpiry(row.expiresAt, new Date(Date.now() + 3_660_000)),
      updatedAt: new Date(),
    })
    .where(eq(connections.id, row.id));
}

export { recoverConnectionOperations } from "./recovery";
