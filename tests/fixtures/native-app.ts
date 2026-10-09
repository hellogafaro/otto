import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readConfig } from "../../apps/server/src/config";
import { startServer } from "../../apps/server/src/lifecycle";
import type { Mail } from "../../apps/server/src/mail";
import { startQueue } from "../../apps/server/src/queue";
import { ensureDefaultAgent } from "../../packages/agents/src/server";
import { claimInstallation, inWorkspace } from "../../packages/workspaces/src";
import { members, users } from "../../packages/workspaces/src/schema";
import { startPostgres } from "../postgres";
import { startS3Peer } from "./s3-peer";

const role = z.enum(["owner", "contributor", "viewer"]);
const userInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.email().optional(),
    password: z.string().min(12).optional(),
    role: role.optional(),
  })
  .strict();

export async function startNativeTestApp(
  options: { origin?: string; port?: number } = {},
) {
  const origin = options.origin ?? "http://127.0.0.1:5173";
  const cleanups: (() => Promise<void>)[] = [];
  let stopPromise: Promise<void> | undefined;
  let restarting: Promise<void> | undefined;
  let stopped = false;
  function stop() {
    stopped = true;
    stopPromise ??= (async () => {
      await restarting?.catch(() => {});
      const failures: unknown[] = [];
      for (const close of cleanups.toReversed()) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "Native fixture cleanup failed");
    })();
    return stopPromise;
  }
  try {
    const database = await startPostgres();
    cleanups.push(() => database.stop());
    const boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await boss.stop();
    const peer = await startS3Peer();
    cleanups.push(() => peer.stop());
    const spool = await mkdtemp(join(tmpdir(), "otto-native-spool-"));
    cleanups.push(() => rm(spool, { recursive: true, force: true }));
    await chmod(spool, 0o700);
    const pending = new Map<string, string>();
    cleanups.push(async () => pending.clear());
    const mail: Mail = {
      async send(message) {
        if (message.subject !== "Verify your Otto email") return;
        const email = message.to.toLowerCase();
        if (!pending.has(email) && pending.size >= 100)
          throw new Error("Fixture verification inbox is full");
        const prefix = "Verify your email: ";
        if (!message.text.startsWith(prefix))
          throw new Error("Invalid fixture verification message");
        const url = new URL(message.text.slice(prefix.length));
        if (url.origin !== origin || url.pathname !== "/api/auth/verify-email")
          throw new Error("Unexpected fixture verification destination");
        pending.set(email, url.pathname + url.search);
      },
    };
    const config = readConfig({
      DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      OTTO_ORIGIN: origin,
      HOST: "127.0.0.1",
      PORT: String(options.port ?? 0),
      S3_ENDPOINT: peer.endpoint,
      S3_BUCKET: peer.bucket,
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "disposable-peer",
      S3_SECRET_ACCESS_KEY: "disposable-peer-not-a-live-credential",
      UPLOAD_SPOOL_DIR: spool,
    });
    let runtime = await startServer(config, { mail });
    cleanups.push(() => runtime.stop());
    const port = runtime.server.port;
    if (port === undefined) throw new Error("Fixture requires a TCP listener");
    config.PORT = port;
    const apiOrigin = `http://127.0.0.1:${config.PORT}`;
    let workspace: Promise<string> | undefined;
    async function grant(
      userId: string,
      requestedRole: z.infer<typeof role> = "owner",
    ) {
      if (stopped) throw new Error("Native fixture is stopped");
      const selectedRole = role.parse(requestedRole);
      const [user] = await database.db
        .select({ verified: users.emailVerified })
        .from(users)
        .where(eq(users.id, userId));
      if (!user?.verified)
        throw new Error("A verified fixture user is required");
      if (!workspace) {
        if (selectedRole !== "owner")
          throw new Error("Provision the fixture owner before other members");
        workspace = claimInstallation(
          database.db,
          userId,
          "Native test workspace",
        ).then(async (value) => {
          await inWorkspace(
            database.db,
            value.id,
            { userId },
            ensureDefaultAgent,
          );
          return value.id;
        });
      }
      const workspaceId = await workspace;
      await database.db
        .insert(members)
        .values({
          workspaceId,
          userId,
          role: selectedRole,
        })
        .onConflictDoNothing();
      return workspaceId;
    }
    async function verifyEmail(email: string) {
      if (stopped) throw new Error("Native fixture is stopped");
      const address = z.email().parse(email).toLowerCase();
      const path = pending.get(address);
      if (!path) throw new Error("No pending fixture verification");
      const response = await fetch(`${apiOrigin}${path}`, {
        headers: { origin },
        redirect: "manual",
      });
      await response.body?.cancel();
      if (response.status !== 302)
        throw new Error("Fixture email verification failed");
      pending.delete(address);
      const [user] = await database.db
        .select({ id: users.id, verified: users.emailVerified })
        .from(users)
        .where(eq(users.email, address));
      if (!user?.verified) throw new Error("Fixture user was not verified");
      return user.id;
    }
    async function provisionUser(input: z.input<typeof userInput> = {}) {
      if (stopped) throw new Error("Native fixture is stopped");
      const selected = userInput.parse(input);
      const email =
        selected.email?.toLowerCase() ??
        `fixture-${crypto.randomUUID()}@example.test`;
      const password = selected.password ?? randomBytes(32).toString("base64");
      const response = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: selected.name ?? "Native fixture",
          email,
          password,
        }),
        redirect: "manual",
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Fixture user registration failed");
      const id = await verifyEmail(email);
      const workspaceId = await grant(id, selected.role);
      return { id, email, password, workspaceId };
    }
    function restart() {
      if (stopped)
        return Promise.reject(new Error("Native fixture is stopped"));
      restarting ??= (async () => {
        await runtime.stop();
        runtime = await startServer(config, { mail });
      })().finally(() => {
        restarting = undefined;
      });
      return restarting;
    }
    return {
      origin,
      apiOrigin,
      database,
      peer,
      provisionUser,
      verifyEmail,
      grant,
      restart,
      stop,
    };
  } catch (error) {
    try {
      await stop();
    } catch {
      throw new Error("Native fixture initialization and cleanup failed");
    }
    throw error;
  }
}
