import {
  approveOperation,
  CONNECTION_AUDIENCE,
  CONNECTION_SORTS,
  createConnection,
  denyOperation,
  disconnectConnection,
  getConnection,
  getConnectionDetails,
  getConnections,
  getOperation,
  getOperations,
  grantConnectionAccess,
  OPERATION_APPROVAL,
  OPERATION_SORTS,
  retryOperation,
  revokeConnectionAccess,
  updateConnection,
} from "@otto/connections";
import { CONNECTION_CONFIG } from "@otto/connections/server";
import { DomainError } from "@otto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { connectionService, validateConnectionRun } from "./connections";
import { type ApiEnv, recordId, transact, workspaceId } from "./http";
import {
  editToken,
  flag,
  id,
  listQuery,
  validate,
  visibility,
} from "./validation";

function service(c: import("hono").Context<ApiEnv>) {
  const options = c.get("options");
  if (!options.connections)
    throw new DomainError(
      "unavailable",
      "Connection credential scope not configured",
    );
  return connectionService(
    options.db,
    workspaceId(c),
    { userId: c.get("userId") },
    { ...options.connections, native: options.nativeStorage },
  );
}
export const connectionApi = new Hono<ApiEnv>()
  .get("/workspaces/:workspaceId/connections/:id/details", async (c) =>
    c.json(
      await transact(c, (ctx) => getConnectionDetails(ctx, recordId(c)), false),
    ),
  )
  .get(
    "/workspaces/:workspaceId/connections",
    validate(
      "query",
      listQuery(CONNECTION_SORTS, {
        type: z.enum(["github", "mcp"]).optional(),
        visibility: visibility.optional(),
        createdBy: z.string().min(1).max(128).optional(),
        connected: flag,
        query: z.string().max(200).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getConnections(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/connections/:id", async (c) =>
    c.json(await transact(c, (ctx) => getConnection(ctx, recordId(c)), false)),
  )
  .post(
    "/workspaces/:workspaceId/connections",
    validate(
      "json",
      z
        .object({
          title: z.string().min(1).max(200),
          type: z.enum(["github", "mcp"]),
          accountRef: z.string().min(1).max(200),
          visibility: z.enum(["user", "workspace"]).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createConnection(ctx, c.req.valid("json"))),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/connections/:id",
    validate(
      "json",
      z
        .object({
          title: z.string().min(1).max(200).optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
          editToken: editToken.optional(),
          credentialRef: z.string().min(1).max(200).optional(),
          config: CONNECTION_CONFIG.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateConnection(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post("/workspaces/:workspaceId/connections/:id/connect", async (c) =>
    c.json(await service(c).connectConnection(recordId(c))),
  )
  .post("/workspaces/:workspaceId/connections/:id/discover", async (c) =>
    c.json(await service(c).discoverConnection(recordId(c))),
  )
  .post("/workspaces/:workspaceId/connections/:id/disconnect", async (c) =>
    c.json(await transact(c, (ctx) => disconnectConnection(ctx, recordId(c)))),
  )
  .post(
    "/workspaces/:workspaceId/connections/:id/grants",
    validate(
      "json",
      z
        .object({
          agentId: id,
          audience: CONNECTION_AUDIENCE,
          resources: z.array(z.string().min(1).max(2000)).max(100),
          operations: z.record(
            z.string().max(200),
            z.enum(["allowed", "confirmation", "disabled"]),
          ),
        })
        .strict(),
    ),
    async (c) => {
      await transact(c, (ctx) =>
        grantConnectionAccess(ctx, recordId(c), c.req.valid("json")),
      );
      return c.json({ granted: true });
    },
  )
  .delete(
    "/workspaces/:workspaceId/connections/:id/grants/:agentId",
    async (c) => {
      await transact(c, (ctx) =>
        revokeConnectionAccess(
          ctx,
          recordId(c),
          id.parse(c.req.param("agentId")),
        ),
      );
      return c.json({ revoked: true });
    },
  )
  .get(
    "/workspaces/:workspaceId/connections/:id/operations",
    validate(
      "query",
      listQuery(OPERATION_SORTS, {
        state: z
          .enum([
            "awaiting_approval",
            "approved",
            "denied",
            "executing",
            "succeeded",
            "failed",
            "uncertain",
          ])
          .optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getOperations(ctx, {
              connectionId: recordId(c),
              ...c.req.valid("query"),
            }),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/operations/:id", async (c) =>
    c.json(await transact(c, (ctx) => getOperation(ctx, recordId(c)), false)),
  )
  .post(
    "/workspaces/:workspaceId/operations/:id/approve",
    validate("json", OPERATION_APPROVAL),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          approveOperation(
            ctx,
            recordId(c),
            c.req.valid("json"),
            (ctx, proof) =>
              validateConnectionRun(ctx, proof, c.get("options").nativeStorage),
          ),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/operations/:id/deny",
    validate("json", OPERATION_APPROVAL),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          denyOperation(ctx, recordId(c), c.req.valid("json"), (ctx, proof) =>
            validateConnectionRun(ctx, proof, c.get("options").nativeStorage),
          ),
        ),
      ),
  )
  .post("/workspaces/:workspaceId/operations/:id/execute", async (c) =>
    c.json(await service(c).executeOperation(recordId(c))),
  )
  .post("/workspaces/:workspaceId/operations/:id/retry", async (c) =>
    c.json(
      await transact(c, (ctx) =>
        retryOperation(ctx, recordId(c), (ctx, proof) =>
          validateConnectionRun(ctx, proof, c.get("options").nativeStorage),
        ),
      ),
    ),
  );
