import type { CursorCodec, Database } from "@otto/db";
import type { FileStorage } from "@otto/files";
import type { ModelAuthorization } from "@otto/runs";
import type { RunRuntime } from "@otto/runs/runtime";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { type Context, inWorkspace } from "@otto/workspaces";
import type { Context as HttpContext } from "hono";
import type { PgBoss } from "pg-boss";
import type { Auth } from "./auth";
import type { ConnectionOptions } from "./connections";
import type { createContentPresence } from "./content-presence";
import type { Mail } from "./mail";
import type { Spool, TransferLimits } from "./spool";
import type { Transcriber } from "./transcription";
import { id } from "./validation";

export interface ApiOptions {
  db: Database;
  auth: Auth;
  boss: PgBoss;
  origin: string;
  storage?: FileStorage;
  /** Private disk for in-flight uploads and verified downloads; required with storage for file bytes. */
  spool?: Spool;
  /** Deadlines for file transfers; defaults apply when omitted. */
  transfer?: TransferLimits;
  runtime?: RunRuntime;
  modelAuthorization?: ModelAuthorization;
  nativeStorage: NativeSessionStorage;
  encryptionKey?: Uint8Array;
  mail?: Mail;
  connections?: ConnectionOptions;
  /** Speech to text for dictation; absent without OPENROUTER_API_KEY. */
  transcriber?: Transcriber;
  /** Seals sorted list cursors; production derives it from the auth secret. Without it a sorted list is unavailable. */
  cursors?: CursorCodec;
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
    c.get("options").cursors,
  );
}
