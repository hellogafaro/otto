import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { readConfig } from "../apps/server/src/config";
import { startServer } from "../apps/server/src/lifecycle";
import { createSmtpMail } from "../apps/server/src/mail";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import { connections, operations } from "../packages/connections/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { admitRun } from "../packages/runs/src";
import * as runRuntime from "../packages/runs/src/runtime";
import { openNativeStorage } from "../packages/sessions/src/native";
import { inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startSmtp } from "./fixtures/smtp";
import { startPostgres } from "./postgres";

const cwd = new URL("../", import.meta.url).pathname;
async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error("Condition did not become true");
}
describe("server operations on private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let databaseUrl: string;
  let nativeStorage: Awaited<ReturnType<typeof openNativeStorage>>;
  // Same memory-only signing/password fixtures as the reviewed auth tests.
  const signing = crypto.randomUUID() + crypto.randomUUID();
  beforeAll(async () => {
    database = await startPostgres();
    databaseUrl = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    const result = Bun.spawnSync([process.execPath, "scripts/push.ts"], {
      cwd,
      env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    });
    if (result.exitCode !== 0)
      throw new Error(result.stdout.toString() + result.stderr.toString());
    nativeStorage = await openNativeStorage({ connectionString: databaseUrl });
  });
  afterAll(async () => {
    await nativeStorage?.close();
    await database?.stop();
  });
  const config = () =>
    readConfig({
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: signing,
      ENCRYPTION_KEY: fixtureEncryptionKey.toString("base64"),
      OTTO_ORIGIN: "http://localhost:43001",
      PORT: "0",
    });
  it("startup and elapsed-clock queue recovery retire interrupted claims after sponsor removal", async () => {
    const workspaceId = crypto.randomUUID();
    const sponsorId = crypto.randomUUID();
    await database.db
      .insert(workspaces)
      .values({ id: workspaceId, title: "Recovery fixture" });
    await database.db.insert(users).values({
      id: sponsorId,
      name: "Removed sponsor",
      email: `${sponsorId}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: sponsorId, role: "contributor" });
    const [connection] = await database.db
      .insert(connections)
      .values({
        workspaceId,
        createdBy: sponsorId,
        title: "Lost operation fixture",
        type: "mcp",
        accountRef: "fixture",
      })
      .returning();
    if (!connection) throw new Error("Missing fixture Connection");
    const queue = await startQueue(database.db, database.pool, {
      workers: false,
    });
    const admitted = await inWorkspace(
      database.db,
      workspaceId,
      { userId: sponsorId },
      async (c) => {
        const agent = await createAgent(c, {
          subscriptionId: await controlledSubscription(c),
          title: "Recovery",
          instructions: "fixture",
          model: "fixture",
        });
        await createEnvironment(c, agent.id);
        const chat = await createChat(c, {
          title: "Recovery",
          visibility: "workspace",
        });
        await createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        });
        const run = await admitRun(
          c,
          queue,
          {
            agentId: agent.id,
            chatId: chat.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "fixture",
          },
          nativeModelAuthorization,
        );
        return { agentId: agent.id, runId: run.id };
      },
    );
    await queue.stop();
    const ids = Array.from({ length: 106 }, () => crypto.randomUUID());
    await database.db.insert(operations).values(
      ids.map((id, index) => ({
        id,
        workspaceId,
        connectionId: connection.id,
        agentId: admitted.agentId,
        sponsorId,
        runId: admitted.runId,
        requestId: crypto.randomUUID(),
        action: "write",
        target: "fixture",
        accountRef: "fixture",
        state: "executing" as const,
        executionToken: crypto.randomUUID(),
        startedAt: index === 105 ? new Date() : new Date(0),
        isWrite: true,
      })),
    );
    await database.db
      .delete(members)
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, sponsorId),
        ),
      );
    const server = await startServer(config());
    try {
      expect(
        (
          await database.db
            .select()
            .from(operations)
            .where(eq(operations.id, ids[105] ?? ""))
        )[0]?.state,
      ).toBe("executing");
      await expect
        .poll(
          async () =>
            (
              await database.db
                .select()
                .from(operations)
                .where(
                  and(
                    eq(operations.workspaceId, workspaceId),
                    eq(operations.state, "uncertain"),
                  ),
                )
            ).length,
          { timeout: 10000 },
        )
        .toBe(105);
      // Fault fixture ages the otherwise untouched claim; actual pg-boss clock must deliver recovery.
      await database.db
        .update(operations)
        .set({ startedAt: new Date(0) })
        .where(eq(operations.id, ids[105] ?? ""));
      await expect
        .poll(
          async () =>
            (
              await database.db
                .select()
                .from(operations)
                .where(eq(operations.id, ids[105] ?? ""))
            )[0]?.state,
          { timeout: 100000, interval: 500 },
        )
        .toBe("uncertain");
      expect((await fetch(new URL("/ready", server.server.url))).status).toBe(
        200,
      );
    } finally {
      await server.stop();
    }
    const restarted = await startServer(config());
    try {
      expect(
        (
          await database.db
            .select()
            .from(operations)
            .where(
              and(
                eq(operations.workspaceId, workspaceId),
                eq(operations.state, "uncertain"),
              ),
            )
        ).length,
      ).toBe(106);
    } finally {
      await restarted.stop();
    }
  }, 120000);
  it("rejects partial storage/mail configuration without including supplied values", () => {
    for (const partial of [
      { S3_ENDPOINT: "http://localhost:1" },
      { MAIL_FROM: "otto@example.test" },
    ]) {
      expect(() =>
        readConfig({
          ...config(),
          PORT: "0",
          SMTP_PORT: undefined,
          UPLOAD_SPOOL_BYTES: undefined,
          TRANSFER_BASE_MS: undefined,
          TRANSFER_MIN_BYTES_PER_SECOND: undefined,
          OTTO_ACCOUNT_SECRET_BINDINGS: undefined,
          ...partial,
        }),
      ).toThrow("Invalid configuration fields");
    }
  });
  it("refuses missing or mismatched declared schema without running DDL", async () => {
    for (const change of [
      {
        apply: "alter table workspaces rename column cursor to absent_cursor",
        undo: "alter table workspaces rename column absent_cursor to cursor",
      },
      {
        apply: "alter table workspaces alter column cursor type bigint",
        undo: "alter table workspaces alter column cursor type integer",
      },
      {
        apply: "alter table documents rename to absent_document",
        undo: "alter table absent_document rename to documents",
      },
    ]) {
      await database.pool.query(change.apply);
      try {
        await expect(startServer(config())).rejects.toThrow(
          "Server startup failed",
        );
        // A second start still fails: startup did not silently repair the database.
        await expect(startServer(config())).rejects.toThrow(
          "Server startup failed",
        );
      } finally {
        await database.pool.query(change.undo);
      }
    }
    const healthy = await startServer(config());
    try {
      expect(await healthy.isReady()).toBe(true);
    } finally {
      await healthy.stop();
    }
  });
  it("reports dependency readiness and releases the port on repeated stop", async () => {
    const runtime = await startServer(config());
    try {
      expect((await fetch(new URL("/ready", runtime.server.url))).status).toBe(
        200,
      );
      await database.pool.query(
        "alter table queue.version rename to version_unavailable",
      );
      try {
        expect(
          (await fetch(new URL("/ready", runtime.server.url))).status,
        ).toBe(503);
      } finally {
        await database.pool.query(
          "alter table queue.version_unavailable rename to version",
        );
      }
      expect(await runtime.isReady()).toBe(true);
    } finally {
      await Promise.all([runtime.stop(), runtime.stop()]);
    }
    expect(await runtime.isReady()).toBe(false);
  });
  it("rejects readiness when the real runtime closes while the database probe is blocked", async () => {
    const create = runRuntime.createRunRuntime;
    let execution: runRuntime.RunRuntime | undefined;
    const capture = vi
      .spyOn(runRuntime, "createRunRuntime")
      .mockImplementation((...args) => {
        execution = create(...args);
        return execution;
      });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const lock = await database.pool.connect();
    try {
      server = await startServer(config(), {
        execution: {
          resolveModel: async () => controlledModel(),
        },
      });
      capture.mockRestore();
      await lock.query("BEGIN");
      await lock.query("LOCK TABLE queue.version IN ACCESS EXCLUSIVE MODE");
      const pending = server.isReady();
      await until(async () => {
        const waiting = await database.pool.query(
          "select count(*)::int as count from pg_stat_activity where query='select version from queue.version' and wait_event_type='Lock'",
        );
        return z.object({ count: z.number() }).parse(waiting.rows[0]).count > 0;
      });
      if (!execution) throw new Error("Runtime capture missing");
      await execution.close();
      await lock.query("COMMIT");
      expect(await pending).toBe(false);
      expect((await fetch(new URL("/ready", server.server.url))).status).toBe(
        503,
      );
    } finally {
      capture.mockRestore();
      await lock.query("ROLLBACK");
      lock.release();
      await server?.stop();
    }
  });
  it("refuses legacy queue schema without changing or abandoning it", async () => {
    await database.pool.query(
      "create schema otto_jobs; create table otto_jobs.pending (id integer primary key); insert into otto_jobs.pending values (1)",
    );
    try {
      const result = Bun.spawnSync([process.execPath, "scripts/push.ts"], {
        cwd,
        env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15000,
      });
      expect(result.exitCode).toBe(1);
      await expect(startServer(config())).rejects.toThrow(
        "Server startup failed",
      );
      expect(
        (await database.pool.query("select id from otto_jobs.pending")).rows,
      ).toEqual([{ id: 1 }]);
    } finally {
      await database.pool.query("drop schema otto_jobs cascade");
    }
  });
  it("cleans up after a port conflict and does not alter the existing listener", async () => {
    const occupied = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("existing"),
    });
    try {
      await expect(
        startServer({ ...config(), PORT: occupied.port ?? 0 }),
      ).rejects.toThrow("Server startup failed");
      expect(await (await fetch(occupied.url)).text()).toBe("existing");
    } finally {
      await occupied.stop(true);
    }
    const runtime = await startServer(config());
    await runtime.stop();
  });
  it("runs the actual executable, SIGTERM/SIGINT, and restart without logging signing material", async () => {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const reservation = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(),
      });
      const port = reservation.port;
      await reservation.stop(true);
      const child = Bun.spawn([process.execPath, "apps/server/src/index.ts"], {
        cwd,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: databaseUrl,
          BETTER_AUTH_SECRET: signing,
          ENCRYPTION_KEY: fixtureEncryptionKey.toString("base64"),
          OTTO_ORIGIN: `http://127.0.0.1:${port}`,
          PORT: String(port),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      try {
        await until(
          async () =>
            (await fetch(`http://127.0.0.1:${port}/ready`)).status === 200,
        );
        expect(
          (await fetch(`http://127.0.0.1:${port}/api/workspaces`)).status,
        ).toBe(401);
        child.kill(signal);
        const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
        try {
          expect(await child.exited).toBe(0);
        } finally {
          clearTimeout(timer);
        }
        expect((await output).join("").includes(signing)).toBe(false);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited;
      }
    }
  });
  it("rejects invalid startup with a redacted field-only diagnostic", async () => {
    const child = Bun.spawnSync(
      [process.execPath, "apps/server/src/index.ts"],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: databaseUrl,
          BETTER_AUTH_SECRET: signing,
          ENCRYPTION_KEY: fixtureEncryptionKey.toString("base64"),
          OTTO_ORIGIN: "invalid",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10000,
      },
    );
    expect(child.exitCode).toBe(1);
    expect(child.stdout.toString().includes(signing)).toBe(false);
    expect(child.stdout.toString()).toContain("OTTO_ORIGIN");
  });
  it("allows no-mail signup and signin, protects credentials, and optionally delivers SMTP reset with session revocation", async () => {
    let reject = false;
    const sink = await startSmtp({
      onData() {
        if (reject) return new Error("provider error must stay private");
      },
    });
    const messages = sink.messages;
    const mail = createSmtpMail({
      from: "otto@example.test",
      host: sink.host,
      port: sink.port,
      tls: "none",
    });
    let app: ReturnType<typeof createApp>;
    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    const origin = http.url.origin;
    let auth = createAuth(database.db, signing, origin);
    const boss = await startQueue(database.db, database.pool, {
      workers: false,
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      nativeStorage,
      modelAuthorization: nativeModelAuthorization,
      encryptionKey: fixtureEncryptionKey,
    });
    const password = crypto.randomUUID().slice(0, 12);
    const nextPassword = crypto.randomUUID() + crypto.randomUUID();
    const post = (path: string, body: unknown, client = "192.0.2.1") =>
      fetch(`${origin}/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "x-forwarded-for": client,
        },
        body: JSON.stringify(body),
      });
    try {
      const signup = await post("sign-up/email", {
        email: "lifecycle@example.test",
        name: "Local test",
        password,
      });
      expect(signup.status).toBe(200);
      const signedUp = z
        .object({
          user: z.object({ id: z.string(), emailVerified: z.literal(false) }),
        })
        .parse(await signup.json());
      const signupCookie = signup.headers.get("set-cookie") ?? "";
      const signupSession = await auth.api.getSession({
        headers: new Headers({ cookie: signupCookie }),
      });
      expect(signupSession?.user.id).toBe(signedUp.user.id);
      expect(signupSession?.user.emailVerified).toBe(false);
      expect(signupSession?.session.expiresAt.getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(messages).toHaveLength(0);
      expect(
        (
          await post("sign-up/email", {
            email: "LIFECYCLE@example.test",
            name: "Duplicate test",
            password: nextPassword,
          })
        ).status,
      ).toBe(422);
      expect(
        await database.db
          .select({ id: users.id, emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.email, "lifecycle@example.test")),
      ).toEqual([{ id: signedUp.user.id, emailVerified: false }]);
      expect(
        (
          await post("sign-up/email", {
            email: "short-password@example.test",
            name: "Short password",
            password: "12345678901",
          })
        ).status,
      ).toBe(400);
      expect(
        await database.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, "short-password@example.test")),
      ).toEqual([]);
      expect(
        (
          await post("sign-in/email", {
            email: "lifecycle@example.test",
            password: nextPassword,
          })
        ).status,
      ).toBe(401);
      const login = await post("sign-in/email", {
        email: "lifecycle@example.test",
        password,
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie") ?? "";
      const loginSession = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      expect(loginSession?.user.id).toBe(signedUp.user.id);
      expect(loginSession?.user.emailVerified).toBe(false);
      expect(messages).toHaveLength(0);
      auth = createAuth(database.db, signing, origin, mail);
      app = createApp({
        db: database.db,
        boss,
        auth,
        origin,
        nativeStorage,
        modelAuthorization: nativeModelAuthorization,
        encryptionKey: fixtureEncryptionKey,
      });
      expect(
        (
          await post("request-password-reset", {
            email: "lifecycle@example.test",
            redirectTo: `${origin}/reset`,
          })
        ).status,
      ).toBe(200);
      expect(messages).toHaveLength(1);
      const reset = messages.find(
        (m) => m.subject === "Reset your Otto password",
      );
      expect(reset?.to).toEqual(["lifecycle@example.test"]);
      const resetUrl = reset?.text.split("Reset your password: ")[1];
      if (!resetUrl) throw new Error("Reset delivery missing");
      const token = new URL(resetUrl).pathname.split("/").at(-1);
      expect(
        (await post("reset-password", { token, newPassword: "12345678901" }))
          .status,
      ).toBe(400);
      expect(
        (await post("reset-password", { token, newPassword: nextPassword }))
          .status,
      ).toBe(200);
      expect(
        Boolean(
          await auth.api.getSession({ headers: new Headers({ cookie }) }),
        ),
      ).toBe(false);
      expect(
        await auth.api.getSession({
          headers: new Headers({ cookie: signupCookie }),
        }),
      ).toBeNull();
      expect(
        (
          await post("sign-in/email", {
            email: "lifecycle@example.test",
            password,
          })
        ).status,
      ).toBe(401);
      const resetLogin = await post(
        "sign-in/email",
        { email: "lifecycle@example.test", password: nextPassword },
        "192.0.2.2",
      );
      expect(resetLogin.status).toBe(200);
      expect(
        z
          .object({ user: z.object({ emailVerified: z.literal(false) }) })
          .parse(await resetLogin.json()).user.emailVerified,
      ).toBe(false);
      expect(
        (
          await database.db
            .select({ emailVerified: users.emailVerified })
            .from(users)
            .where(eq(users.id, signedUp.user.id))
        )[0]?.emailVerified,
      ).toBe(false);
      expect(messages).toHaveLength(1);
      expect(
        (await post("reset-password", { token, newPassword: password })).status,
      ).toBe(400);
      reject = true;
      await expect(
        mail.send({
          to: "lifecycle@example.test",
          subject: "Test",
          text: "Test",
          key: "failed-fixture",
        }),
      ).rejects.toThrow("Mail delivery uncertain");
    } finally {
      await boss.stop();
      try {
        await sink.close();
      } finally {
        await http.stop(true);
      }
    }
  });
});
