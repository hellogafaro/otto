import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { archiveAgent, updateAgent } from "../packages/agents/src";
import { ensureDefaultAgent } from "../packages/agents/src/server";
import { secrets } from "../packages/secrets/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  createSubscription,
  getSubscription,
  updateSubscription,
} from "../packages/subscriptions/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import {
  type AcceptedSubscriptionModel,
  authorizeSubscriptionModel,
  resolveSubscriptionModel,
  setSubscriptionApiKey,
} from "../packages/subscriptions/src/server";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("native API-key provider authenticated authority", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let nativeStorage: Awaited<ReturnType<typeof openNativeStorage>>;
  let server: Bun.Server<undefined>;
  let app: ReturnType<typeof createApp>;
  let origin: string;
  let workspaceId: string;
  let owner: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  const encryptionKey = randomBytes(32);
  const scope = <T>(
    work: Parameters<typeof inWorkspace<T>>[3],
    userId = owner.id,
  ) => inWorkspace(database.db, workspaceId, { userId }, work);
  const json = { "content-type": "application/json" };
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = owner.cookie,
    requestOrigin = origin,
  ) =>
    fetch(`${origin}/api/workspaces/${workspaceId}/subscriptions${path}`, {
      method,
      headers: { ...json, cookie, origin: requestOrigin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const input = {
    title: "Controlled provider",
    provider: "openai" as const,
    protocol: "responses" as const,
    models: ["gpt-fixture"],
    visibility: "user" as const,
  };
  async function create(visibility: "user" | "workspace" = "user") {
    return scope((c) => createSubscription(c, { ...input, visibility }));
  }
  async function accepted(id: string): Promise<AcceptedSubscriptionModel> {
    return {
      workspaceId,
      sponsorId: owner.id,
      subscriptionId: id,
      model: "gpt-fixture",
      ...(await scope((c) => authorizeSubscriptionModel(c, id, "gpt-fixture"))),
    };
  }
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    nativeStorage = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    origin = server.url.origin;
    app = createApp({
      db: database.db,
      boss,
      nativeStorage,
      origin,
      encryptionKey,
      auth: createAuth(
        database.db,
        crypto.randomUUID() + crypto.randomUUID(),
        origin,
      ),
    });
    async function signup(label: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { ...json, origin },
        body: JSON.stringify({
          name: label,
          email: `${label}@provider.example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      const data = z
        .object({ user: z.object({ id: z.string() }) })
        .parse(await response.json());
      return {
        id: data.user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    }
    owner = await signup("owner");
    member = await signup("member");
    viewer = await signup("viewer");
    await Bun.sleep(11000);
    outsider = await signup("outsider");
    workspaceId = (await claimInstallation(database.db, owner.id, "Providers"))
      .id;
    await database.db.insert(members).values([
      { workspaceId, userId: member.id, role: "contributor" },
      { workspaceId, userId: viewer.id, role: "viewer" },
    ]);
  });
  afterAll(async () => {
    await server?.stop(true);
    await nativeStorage?.close();
    await boss?.stop();
    await database?.stop();
  });
  it("creates and replaces a key over authenticated HTTP without exposing its plaintext or secret ID", async () => {
    const created = await call("", "POST", input);
    expect(created.status).toBe(200);
    const row = z
      .object({ id: z.string(), status: z.string() })
      .parse(await created.json());
    expect(row.status).toBe("needs_auth");
    const saved = await call(`/${row.id}/api-key`, "PUT", {
      apiKey: "fixture-provider-key-one",
    });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain("fixture-provider-key-one");
    expect(text).not.toContain("secretId");
    expect(JSON.parse(text).status).toBe("enabled");
    const first = await accepted(row.id);
    const stored = (
      await database.db
        .select()
        .from(secrets)
        .where(eq(secrets.id, first.accountId))
    )[0];
    expect(stored?.value).not.toContain("fixture-provider-key-one");
    expect(
      (
        await call(`/${row.id}/api-key`, "PUT", {
          apiKey: "fixture-provider-key-two",
        })
      ).status,
    ).toBe(200);
    expect((await accepted(row.id)).accountId).not.toBe(first.accountId);
    expect(
      await database.db
        .select()
        .from(secrets)
        .where(eq(secrets.id, first.accountId)),
    ).toHaveLength(0);
    await expect(
      resolveSubscriptionModel(
        database.db,
        first,
        encryptionKey,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Accepted provider identity changed");
    const refreshed = await call(`/${row.id}`);
    expect(await refreshed.text()).not.toContain("secretId");
    expect((await call(`/${row.id}/api-key`)).status).toBe(404);
  });
  it("denies origin forgery, anonymous requests, viewers and nonowners before storing a key", async () => {
    const row = await create("workspace");
    const before = await database.db.select().from(secrets);
    expect(
      (
        await call(
          `/${row.id}/api-key`,
          "PUT",
          { apiKey: "fixture-key" },
          owner.cookie,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(`/${row.id}/api-key`, "PUT", { apiKey: "fixture-key" }, ""))
        .status,
    ).toBe(401);
    for (const person of [member, viewer, outsider])
      expect(
        (
          await call(
            `/${row.id}/api-key`,
            "PUT",
            { apiKey: "fixture-key" },
            person.cookie,
          )
        ).status,
      ).toBe(403);
    expect(await database.db.select().from(secrets)).toEqual(before);
  });
  it("shares use but never credential management, denies private access and unconfigured models", async () => {
    const shared = await create("workspace");
    const privateRow = await create();
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        shared.id,
        { apiKey: "fixture-shared" },
        encryptionKey,
      ),
    );
    await expect(
      scope(
        (c) => authorizeSubscriptionModel(c, shared.id, "gpt-fixture"),
        member.id,
      ),
    ).resolves.toMatchObject({ modelConfig: { id: "gpt-fixture" } });
    await expect(
      scope((c) => getSubscription(c, privateRow.id), member.id),
    ).rejects.toThrow();
    await expect(
      scope(
        (c) => authorizeSubscriptionModel(c, shared.id, "gpt-fixture"),
        viewer.id,
      ),
    ).rejects.toThrow();
    await expect(
      scope((c) => authorizeSubscriptionModel(c, shared.id, "other-model")),
    ).rejects.toThrow("Provider or model unavailable");
    expect(
      (await call(`/${shared.id}/models`, "GET", undefined, member.cookie))
        .status,
    ).toBe(200);
    const identity = { ...(await accepted(shared.id)), sponsorId: member.id };
    await expect(
      resolveSubscriptionModel(
        database.db,
        identity,
        encryptionKey,
        new AbortController().signal,
      ),
    ).resolves.toBeDefined();
    await scope((c) =>
      updateSubscription(c, shared.id, { visibility: "user" }),
    );
    await expect(
      resolveSubscriptionModel(
        database.db,
        identity,
        encryptionKey,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("reauthorizes disabled providers and removed provider owners without any network call", async () => {
    const row = await create("workspace");
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        row.id,
        { apiKey: "fixture-current" },
        encryptionKey,
      ),
    );
    const identity = await accepted(row.id);
    await scope((c) => updateSubscription(c, row.id, { status: "disabled" }));
    await expect(
      resolveSubscriptionModel(
        database.db,
        identity,
        encryptionKey,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        row.id,
        { apiKey: "fixture-current" },
        encryptionKey,
      ),
    );
    const next = await accepted(row.id);
    await database.db
      .delete(members)
      .where(
        and(eq(members.workspaceId, workspaceId), eq(members.userId, owner.id)),
      );
    try {
      await expect(
        resolveSubscriptionModel(
          database.db,
          next,
          encryptionKey,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    } finally {
      await database.db
        .insert(members)
        .values({ workspaceId, userId: owner.id, role: "owner" });
    }
  });
  it("pins model, provider, endpoint and protocol and fails closed for corrupt ciphertext", async () => {
    const row = await create();
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        row.id,
        { apiKey: "fixture-current" },
        encryptionKey,
      ),
    );
    const identity = await accepted(row.id);
    for (const changed of [
      { protocol: "chat-completions" as const },
      { baseUrl: "https://other.vendor.com/v1" },
      { id: "other-model" },
      { provider: "anthropic" as const },
    ]) {
      await expect(
        resolveSubscriptionModel(
          database.db,
          { ...identity, modelConfig: { ...identity.modelConfig, ...changed } },
          encryptionKey,
          new AbortController().signal,
        ),
      ).rejects.toThrow("Accepted provider identity changed");
    }
    await database.db
      .update(secrets)
      .set({ value: "broken" })
      .where(eq(secrets.id, identity.accountId));
    await expect(
      resolveSubscriptionModel(
        database.db,
        identity,
        encryptionKey,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Stored credential unavailable");
  });
  it("keeps historical Codex rows readable but impossible to execute or reconnect", async () => {
    const [row] = await database.db
      .insert(subscriptions)
      .values({
        workspaceId,
        createdBy: owner.id,
        title: "Historical",
        provider: "codex",
        status: "enabled",
      })
      .returning();
    if (!row) throw new Error("Missing fixture row");
    expect((await call(`/${row.id}`)).status).toBe(200);
    await expect(
      scope((c) => authorizeSubscriptionModel(c, row.id, "gpt-fixture")),
    ).rejects.toThrow();
    expect(
      (await call(`/${row.id}/api-key`, "PUT", { apiKey: "fixture-key" }))
        .status,
    ).toBe(403);
    expect((await call(`/${row.id}/login`, "POST")).status).toBe(404);
  });
  it("disconnects terminally and deletes encrypted bytes atomically", async () => {
    const row = await create();
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        row.id,
        { apiKey: "fixture-delete" },
        encryptionKey,
      ),
    );
    const identity = await accepted(row.id);
    expect((await call(`/${row.id}/disconnect`, "POST")).status).toBe(200);
    expect(
      await database.db
        .select()
        .from(secrets)
        .where(eq(secrets.id, identity.accountId)),
    ).toHaveLength(0);
    expect(
      (await call(`/${row.id}/api-key`, "PUT", { apiKey: "fixture-resurrect" }))
        .status,
    ).toBe(403);
    expect((await call(`/${row.id}/disconnect`, "POST")).status).toBe(200);
    await expect(
      scope((c) => authorizeSubscriptionModel(c, row.id, "gpt-fixture")),
    ).rejects.toThrow();
  });
  it("rejects cross-workspace provider IDs even for members of both workspaces", async () => {
    const row = await create();
    const [other] = await database.db
      .insert(workspaces)
      .values({ title: "Other" })
      .returning();
    if (!other) throw new Error("Missing fixture workspace");
    await database.db
      .insert(members)
      .values({ workspaceId: other.id, userId: owner.id, role: "owner" });
    await expect(
      inWorkspace(database.db, other.id, { userId: owner.id }, (c) =>
        setSubscriptionApiKey(
          c,
          row.id,
          { apiKey: "fixture-wrong-workspace" },
          encryptionKey,
        ),
      ),
    ).rejects.toThrow();
  });
  it("provisions exactly one unconfigured protected default and allows explicit provider selection", async () => {
    const [first, second] = await Promise.all([
      scope(ensureDefaultAgent),
      scope(ensureDefaultAgent),
    ]);
    expect(first.id).toBe(second.id);
    expect(first).toMatchObject({
      isDefault: true,
      subscriptionId: null,
      model: "unconfigured",
      visibility: "workspace",
      archived: false,
    });
    await expect(scope((c) => archiveAgent(c, first.id, true))).rejects.toThrow(
      "Default agent cannot be archived",
    );
    await expect(
      scope((c) =>
        updateAgent(c, first.id, {
          visibility: "user",
          editToken: first.editToken,
        }),
      ),
    ).rejects.toThrow("Default agent must remain shared");
    const row = await create();
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        row.id,
        { apiKey: "fixture-default" },
        encryptionKey,
      ),
    );
    const updated = await scope((c) =>
      updateAgent(c, first.id, {
        subscriptionId: row.id,
        model: "gpt-fixture",
        editToken: first.editToken,
      }),
    );
    expect(updated).toMatchObject({
      isDefault: true,
      subscriptionId: row.id,
      model: "gpt-fixture",
    });
  });
});
