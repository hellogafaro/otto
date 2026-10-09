import {
  createTaskComment,
  deleteTaskComment,
  getTaskComment,
  getTaskComments,
  MAX_TASK_COMMENT_BYTES,
  TASK_COMMENT_SORTS,
  updateTaskComment,
} from "@otto/tasks/comments";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import { id, listQuery, validate } from "./validation";

const commentBody = z
  .string()
  .min(1)
  .max(MAX_TASK_COMMENT_BYTES)
  .refine(
    (value) =>
      !!value.trim() && Buffer.byteLength(value) <= MAX_TASK_COMMENT_BYTES,
  );
const commentInput = z.object({ body: commentBody }).strict();

export const taskCommentsApi = new Hono<ApiEnv>()
  .post(
    "/workspaces/:workspaceId/task-comments",
    validate("json", commentInput.extend({ taskId: id }).strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createTaskComment(ctx, c.req.valid("json"))),
      ),
  )
  .get(
    "/workspaces/:workspaceId/task-comments",
    validate("query", listQuery(TASK_COMMENT_SORTS, { taskId: id })),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getTaskComments(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/task-comments/:id", async (c) =>
    c.json(await transact(c, (ctx) => getTaskComment(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/task-comments/:id",
    validate("json", commentInput),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateTaskComment(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .delete("/workspaces/:workspaceId/task-comments/:id", async (c) => {
    await transact(c, (ctx) => deleteTaskComment(ctx, recordId(c)));
    return c.json({ removed: true });
  });
