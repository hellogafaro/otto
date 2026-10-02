import type { ArtifactStorage } from "@otto/artifacts";
import type { Database } from "@otto/db";
import type { Harnesses } from "@otto/runs";
import type { RunRuntime } from "@otto/runs/runtime";
import { type Context, inWorkspace } from "@otto/workspaces";
import type { Context as HttpContext } from "hono";
import type { PgBoss } from "pg-boss";
import type { Auth } from "./auth";
import type { ConnectionOptions } from "./connections";
import type { createContentPresence } from "./content-presence";
import type { Mail } from "./mail";
import { id } from "./validation";

export interface ApiOptions {
  db: Database;
  auth: Auth;
  boss: PgBoss;
  origin: string;
  storage?: ArtifactStorage;
  runtime?: RunRuntime;
  harnesses?: Harnesses;
  mail?: Mail;
  connections?: ConnectionOptions;
}
export interface ApiEnv {
  Variables: {
    options: ApiOptions;
    userId: string;
    presence: ReturnType<typeof createContentPresence>;
  };
}
export const workspaceId = (c: HttpContext<ApiEnv>) =>
  id.parse(c.req.param("workspaceId"));
export const recordId = (c: HttpContext<ApiEnv>) => id.parse(c.req.param("id"));
/** Human identity comes from the single authenticated entry, never a browser actor field. */
export function transact<T>(
  c: HttpContext<ApiEnv>,
  work: (c: Context) => Promise<T>,
  write = true,
) {
  return inWorkspace(
    c.get("options").db,
    workspaceId(c),
    { userId: c.get("userId") },
    work,
    write,
  );
}
