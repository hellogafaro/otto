import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import {
  createRunRuntime,
  getRunExecutionModel,
} from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import { required } from "../packages/shared/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  fixtureEncryptionKey,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("native account identity, sharing and revocation with deterministic models", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let runtime: ReturnType<typeof createRunRuntime>;
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let connector: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let owner: { id: string; cookie: string };
  const accounts: string[] = [];
  const prompts = new Map<string, unknown[]>();
  const publications: string[] = [];
  const record = z.object({ id: z.uuid() });
  const saved = async (id: string) =>
    required((await database.db.select().from(runs).where(eq(runs.id, id)))[0]);

  function call(
    human: typeof owner,
    path: string,
    value?: unknown,
    method = "POST",
  ) {
    return fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method: value === undefined ? "GET" : method,
      headers: {
        cookie: human.cookie,
        origin,
        "content-type": "application/json",
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  }
  async function post(
    human: typeof owner,
    path: string,
    value: unknown,
    method = "POST",
  ) {
    const response = await call(human, path, value, method);
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  }
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    origin = server.url.origin;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      nativeStorage: native,
      encryptionKey: fixtureEncryptionKey,
      modelAuthorization: nativeModelAuthorization,
    });
    async function human(name: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: `${name}@native-account.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      return {
        id: z
          .object({ user: z.object({ id: z.string() }) })
          .parse(await response.json()).user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    }
    owner = await human("owner");
    connector = await human("connector");
    member = await human("member");
    workspaceId = (
      await claimInstallation(database.db, owner.id, "Native account fixture")
    ).id;
    await database.db.insert(members).values(
      [connector, member].map((human) => ({
        workspaceId,
        userId: human.id,
        role: "contributor" as const,
      })),
    );
    runtime = createRunRuntime(database.db, {
      storage: native,
      resolveModel: async (attempt, signal) => {
        const accepted = await getRunExecutionModel(
          database.db,
          attempt,
          undefined,
          native,
        );
        accounts.push(accepted.accountId);
        const run = await saved(attempt.runId);
        return controlledModel({
          signal,
          hold: run.inputs.body === "hold",
          onPrompt: (prompt) => {
            const values = prompts.get(run.id) ?? [];
            values.push(prompt);
            prompts.set(run.id, values);
          },
        });
      },
      tools: () => ({}),
      publishOutput: async (attempt) => {
        publications.push(attempt.runId);
      },
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      nativeStorage: native,
      encryptionKey: fixtureEncryptionKey,
      modelAuthorization: nativeModelAuthorization,
      runtime,
    });
  });
  afterAll(async () => {
    await runtime?.close();
    await server?.stop(true);
    await native?.close();
    await boss?.stop();
    await database?.stop();
  });

  async function account(visibility: "user" | "workspace" = "workspace") {
    const account = record.parse(
      await post(connector, "/subscriptions", {
        title: "Controlled API-key account",
        provider: "openai",
        protocol: "responses",
        models: ["fixture"],
        visibility,
      }),
    );
    await post(
      connector,
      `/subscriptions/${account.id}/api-key`,
      { apiKey: "fixture-not-a-real-key" },
      "PUT",
    );
    return account.id;
  }
  async function target(subscriptionId: string) {
    const agent = z.object({ agent: record }).parse(
      await post(member, "/agents", {
        title: "Member worker",
        instructions: "Controlled native fixture",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      }),
    ).agent;
    const chat = record.parse(
      await post(member, "/chats", {
        title: "Member native Chat",
        visibility: "workspace",
      }),
    );
    await post(member, `/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    return { agentId: agent.id, chatId: chat.id };
  }
  const request = (
    selection: Awaited<ReturnType<typeof target>>,
    body = "finish",
    sessionId?: string,
  ) => ({
    ...selection,
    body,
    sessionId,
    type: "prompt",
    requestId: crypto.randomUUID(),
  });

  it("hides private accounts and refuses member reads, configuration and selection without side effects", async () => {
    const id = await account("user");
    const before = await database.db.select().from(runs);
    const starts = accounts.length;
    const list = z
      .object({ items: z.array(record) })
      .parse(await (await call(member, "/subscriptions")).json());
    expect(list.items.map((row) => row.id)).not.toContain(id);
    for (const path of [`/subscriptions/${id}`, `/subscriptions/${id}/models`])
      expect((await call(member, path)).status).toBe(403);
    expect(
      (
        await call(
          member,
          `/subscriptions/${id}`,
          { visibility: "workspace" },
          "PATCH",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          member,
          `/subscriptions/${id}/api-key`,
          { apiKey: "cannot-replace" },
          "PUT",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(member, "/agents", {
          title: "Forbidden account",
          instructions: "Work",
          model: "fixture",
          subscriptionId: id,
        })
      ).status,
    ).toBe(403);
    expect(await database.db.select().from(runs)).toEqual(before);
    expect(accounts).toHaveLength(starts);
    expect(
      await (await call(connector, `/subscriptions/${id}`)).json(),
    ).toMatchObject({ status: "enabled", visibility: "user" });
  });

  it("explicit sharing selects the exact native account/model without exposing a credential or fallback", async () => {
    const id = await account("user");
    await post(
      connector,
      `/subscriptions/${id}`,
      { visibility: "workspace" },
      "PATCH",
    );
    const view = await (await call(member, `/subscriptions/${id}`)).text();
    expect(view).not.toContain("fixture-not-a-real-key");
    expect(view).not.toContain("secretId");
    expect(
      await (await call(member, `/subscriptions/${id}/models`)).json(),
    ).toEqual({ items: [{ id: "fixture" }], next: null });
    expect(
      (
        await call(member, "/agents", {
          title: "Wrong model",
          instructions: "Work",
          model: "unconfigured",
          subscriptionId: id,
        })
      ).status,
    ).toBe(400);
    const selection = await target(id);
    const input = request(selection);
    const run = record.parse(await post(member, "/runs", input));
    const [stored] = await database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id));
    const starts = accounts.length;
    await runtime.dispatch(run.id);
    expect((await saved(run.id)).state).toBe("finished");
    expect(accounts.slice(starts)).toEqual([required(stored).secretId]);
    expect((await saved(run.id)).inputs).toMatchObject({
      subscriptionId: id,
      accountId: required(stored).secretId,
      model: "fixture",
      modelConfig: {
        provider: "openai",
        protocol: "responses",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(record.parse(await post(member, "/runs", input)).id).toBe(run.id);
    await runtime.dispatch(run.id);
    expect(accounts.slice(starts)).toHaveLength(1);
    expect(
      await (await call(member, `/runs/${run.id}/usage`)).json(),
    ).toMatchObject({ complete: true, estimatedCost: null });
  });

  it.each([
    "visibility",
    "creator removal",
    "disabled",
    "credential replacement",
  ] as const)(
    "revokes active and new member execution on %s without switching accounts",
    async (change) => {
      const id = await account();
      const selection = await target(id);
      const run = record.parse(
        await post(member, "/runs", request(selection, "hold")),
      );
      const work = runtime.dispatch(run.id);
      try {
        await expect.poll(() => accounts.length).toBeGreaterThan(0);
        await expect
          .poll(async () => (await saved(run.id)).state)
          .toBe("running");
        await expect.poll(() => prompts.has(run.id)).toBe(true);
        const starts = accounts.length;
        if (change === "visibility")
          await post(
            connector,
            `/subscriptions/${id}`,
            { visibility: "user" },
            "PATCH",
          );
        if (change === "disabled")
          await post(
            connector,
            `/subscriptions/${id}`,
            { status: "disabled" },
            "PATCH",
          );
        if (change === "creator removal")
          await post(owner, `/members/${connector.id}`, {}, "DELETE");
        if (change === "credential replacement")
          await post(
            connector,
            `/subscriptions/${id}/api-key`,
            { apiKey: "replacement-fixture-not-real" },
            "PUT",
          );
        await work;
        expect((await saved(run.id)).state).toBe("interrupted");
        expect(publications).not.toContain(run.id);
        expect(accounts).toHaveLength(starts);
        expect(
          await (await call(member, `/runs/${run.id}/usage`)).json(),
        ).toMatchObject({
          complete: false,
          totalTokens: null,
          estimatedCost: null,
        });
        const before = (await database.db.select().from(runs)).length;
        const retry = await call(
          member,
          "/runs",
          request(
            selection,
            "resume",
            required((await saved(run.id)).sessionId ?? undefined),
          ),
        );
        expect(retry.status).toBe(
          change === "credential replacement" ? 409 : 403,
        );
        expect(await database.db.select().from(runs)).toHaveLength(before);
        expect(accounts).toHaveLength(starts);
      } finally {
        await runtime.stop(workspaceId, { userId: member.id }, run.id);
        await work;
        if (change === "creator removal")
          await database.db
            .insert(members)
            .values({ workspaceId, userId: connector.id, role: "contributor" });
      }
    },
  );

  it("preserves private Session history and rejects changed credential identity without rewriting accepted inputs", async () => {
    const id = await account();
    const selection = await target(id);
    const first = record.parse(
      await post(
        member,
        "/runs",
        request(selection, "PRIVATE ACCEPTED PROMPT"),
      ),
    );
    await runtime.dispatch(first.id);
    const initial = await saved(first.id);
    const continuation = record.parse(
      await post(
        member,
        "/runs",
        request(
          selection,
          "Continue",
          required(initial.sessionId ?? undefined),
        ),
      ),
    );
    await runtime.dispatch(continuation.id);
    expect(JSON.stringify(prompts.get(continuation.id))).toContain(
      "PRIVATE ACCEPTED PROMPT",
    );
    await post(
      connector,
      `/subscriptions/${id}/api-key`,
      { apiKey: "rekey-fixture-not-real" },
      "PUT",
    );
    expect(
      (
        await call(
          member,
          "/runs",
          request(
            selection,
            "Cannot resume changed identity",
            required(initial.sessionId ?? undefined),
          ),
        )
      ).status,
    ).toBe(409);
    expect((await saved(first.id)).inputs).toEqual(initial.inputs);
    const fresh = record.parse(
      await post(member, "/runs", request(selection, "Fresh identity")),
    );
    await runtime.dispatch(fresh.id);
    expect((await saved(fresh.id)).state).toBe("finished");
    expect(JSON.stringify(prompts.get(fresh.id))).not.toContain(
      "PRIVATE ACCEPTED PROMPT",
    );
    expect((await saved(fresh.id)).inputs.accountId).not.toBe(
      initial.inputs.accountId,
    );
  });
});
