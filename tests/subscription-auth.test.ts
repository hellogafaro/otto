import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createSubscriptionLogin } from "../apps/server/src/subscription-login";
import {
  ACCOUNT_AUTH,
  type AccountAuth,
  type AccountCredential,
  createInfisicalAccounts,
  credentialFingerprint,
} from "../apps/server/src/subscription-secrets";
import { createSubscription } from "../packages/subscriptions/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { startPostgres } from "./postgres";

// Real private PG + authenticated HTTP + controlled Infisical protocol peer; no actual OAuth account or secret scope.
describe("account credential persistence authority", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let server: Bun.Server<undefined>;
  let peer: Bun.Server<undefined>;
  let app: ReturnType<typeof createApp>;
  let service: ReturnType<typeof createSubscriptionLogin>;
  let origin: string;
  let cookie: string;
  let userId: string;
  let oauthHook: ((request: Request) => Promise<Response>) | undefined;
  let workspaceId: string;
  let id: string;
  let stored: AccountAuth;
  let writeHook: (() => Promise<Response | undefined>) | undefined;
  const machineKey = crypto.randomUUID();
  function credential(
    accountId = "controlled-account",
    generation = 1,
  ): AccountCredential {
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: accountId },
      }),
    ).toString("base64url");
    return {
      provider: "codex",
      accountId,
      accessToken: `fixture.${payload}.fixture${generation}`,
      refreshToken: `controlled-${generation}`,
      expired: "2030-01-01T00:00:00.000Z",
    };
  }
  async function status() {
    const [row] = await database.db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.id, id));
    return row?.status;
  }
  async function enabled() {
    writeHook = undefined;
    stored = {
      credential: credential(),
      authenticatedAt: "2026-10-03T00:00:00.000Z",
    };
    // Explicit controlled authenticated datum. Not live OAuth qualification.
    await database.db
      .update(subscriptions)
      .set({ status: "enabled", visibility: "workspace" })
      .where(eq(subscriptions.id, id));
  }
  async function callback(
    method = "GET",
    value?: unknown,
    key: string = machineKey,
  ) {
    return fetch(`${origin}/internal/gateway/accounts/${id}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  }
  function refresh(value = credential("controlled-account", 2)) {
    return callback("PUT", {
      expectedFingerprint: credentialFingerprint(stored.credential),
      expectedAuthenticatedAt: stored.authenticatedAt,
      credential: value,
    });
  }
  beforeAll(async () => {
    database = await startPostgres({ poolMax: 2 });
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    peer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/oauth-peer/")) {
          if (!oauthHook) throw new Error("Unexpected OAuth call");
          return oauthHook(request);
        }
        expect(url.pathname).toBe(
          `/api/v4/secrets/OTTO_ACCOUNT_${id.replaceAll("-", "_")}`,
        );
        if (request.method === "GET") {
          expect(url.searchParams.get("projectId")).toBe("controlled-project");
          expect(url.searchParams.get("includeImports")).toBe("false");
        } else {
          const body = z
            .object({
              secretValue: z.string(),
              environment: z.literal("controlled"),
              secretPath: z.literal("/otto"),
            })
            .parse(await request.json());
          stored = ACCOUNT_AUTH.parse(JSON.parse(body.secretValue));
          const response = await writeHook?.();
          if (response) return response;
        }
        return Response.json({
          secret: { secretValue: JSON.stringify(stored) },
        });
      },
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
    app = createApp({ db: database.db, auth, boss, origin });
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Human",
        email: "credential@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(signup.status).toBe(200);
    cookie = signup.headers.get("set-cookie") ?? "";
    userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user.id;
    workspaceId = (await claimInstallation(database.db, userId, "Accounts")).id;
    const response = await fetch(
      `${origin}/api/workspaces/${workspaceId}/subscriptions`,
      {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Account",
          provider: "codex",
          visibility: "workspace",
        }),
      },
    );
    expect(response.status).toBe(200);
    id = z.object({ id: z.uuid() }).parse(await response.json()).id;
    const secrets = createInfisicalAccounts({
      endpoint: peer.url.origin,
      allowLoopbackHttp: true,
      bindings: [
        {
          workspaceId,
          projectId: "controlled-project",
          environment: "controlled",
          secretPath: "/otto",
        },
      ],
      getAccessToken: async () => "controlled-peer-capability",
    });
    service = createSubscriptionLogin(database.db, secrets, database.pool);
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      subscriptionLogin: service,
      gatewayStoreKey: machineKey,
    });
  });
  afterAll(async () => {
    await service?.close();
    await server?.stop(true);
    await peer?.stop(true);
    await boss?.stop();
    await database?.stop();
  });
  it("requires the private capability and current enabled account, with no human credential projection", async () => {
    await enabled();
    expect((await callback("GET", undefined, "forged")).status).toBe(403);
    const before = await callback();
    expect(before.status).toBe(200);
    expect(before.headers.get("cache-control")).toBe("no-store");
    const human = await fetch(
      `${origin}/api/workspaces/${workspaceId}/subscriptions/${id}`,
      { headers: { cookie } },
    );
    const value = z
      .object({ title: z.literal("Account") })
      .parse(await human.json());
    expect(value).not.toHaveProperty("credential");
    await database.db
      .update(subscriptions)
      .set({ status: "disabled" })
      .where(eq(subscriptions.id, id));
    expect((await callback()).status).toBe(403);
  });
  it("commits needs_auth before write I/O and enables only after exact readback", async () => {
    await enabled();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    writeHook = async () => {
      entered();
      await gate;
      return undefined;
    };
    const pending = refresh();
    await started;
    expect(await status()).toBe("needs_auth");
    // A fresh server/domain lookup denies use while the first writer is still blocked.
    expect((await callback()).status).toBe(403);
    release();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(
      z.object({ fingerprint: z.string() }).parse(await response.json())
        .fingerprint,
    ).toBe(credentialFingerprint(stored.credential));
    expect(await status()).toBe("enabled");
    expect(stored.authenticatedAt).toBe("2026-10-03T00:00:00.000Z");
  });
  it("lost acknowledgement stays durably needs_auth on a fresh service instance", async () => {
    await enabled();
    writeHook = async () => new Response(null, { status: 503 });
    expect((await refresh()).status).toBe(503);
    expect(await status()).toBe("needs_auth");
    expect((await callback()).status).toBe(403);
    // Refresh changed the secret, not the trusted authentication event.
    expect(stored.authenticatedAt).toBe("2026-10-03T00:00:00.000Z");
  });
  it("stale refresh never downgrades the newer authentication", async () => {
    await enabled();
    const stale = {
      expectedFingerprint: credentialFingerprint(stored.credential),
      expectedAuthenticatedAt: stored.authenticatedAt,
      credential: credential("controlled-account", 2),
    };
    stored = {
      credential: credential("controlled-account", 3),
      authenticatedAt: "2026-10-03T00:01:00.000Z",
    };
    expect((await callback("PUT", stale)).status).toBe(409);
    expect(await status()).toBe("enabled");
    expect(stored.credential).toEqual(credential("controlled-account", 3));
  });
  it("revocation during persisted write cannot restore qualification", async () => {
    await enabled();
    writeHook = async () => {
      await database.db
        .update(subscriptions)
        .set({ status: "disabled" })
        .where(eq(subscriptions.id, id));
      return undefined;
    };
    expect((await refresh()).status).toBe(403);
    expect(await status()).toBe("disabled");
    expect((await callback()).status).toBe(403);
  });
  it("refuses a foreign account and remains fail closed", async () => {
    await enabled();
    expect((await refresh(credential("foreign-account"))).status).toBe(409);
    expect(await status()).toBe("needs_auth");
    expect(stored.credential.accountId).toBe("controlled-account");
  });
  it("concurrent refresh callbacks complete with two pool connections, without nested acquisition", async () => {
    const accounts = await inWorkspace(
      database.db,
      workspaceId,
      { userId },
      async (c) =>
        Promise.all([
          createSubscription(c, { title: "First", provider: "codex" }),
          createSubscription(c, { title: "Second", provider: "codex" }),
        ]),
    );
    const records = new Map(
      accounts.map((account) => [
        account.id,
        {
          credential: credential(account.id),
          authenticatedAt: "2026-10-03T00:00:00.000Z",
        },
      ]),
    );
    for (const account of accounts)
      await database.db
        .update(subscriptions)
        .set({ status: "enabled" })
        .where(eq(subscriptions.id, account.id));
    const secretPeer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const key =
          new URL(request.url).pathname
            .split("/")
            .at(-1)
            ?.replace("OTTO_ACCOUNT_", "")
            .replaceAll("_", "-") ?? "";
        if (!records.has(key)) return new Response(null, { status: 404 });
        if (request.method !== "GET") {
          records.set(
            key,
            ACCOUNT_AUTH.parse(
              JSON.parse(
                z
                  .object({ secretValue: z.string() })
                  .parse(await request.json()).secretValue,
              ),
            ),
          );
          await Bun.sleep(25);
        }
        return Response.json({
          secret: { secretValue: JSON.stringify(records.get(key)) },
        });
      },
    });
    const concurrent = createSubscriptionLogin(
      database.db,
      createInfisicalAccounts({
        endpoint: secretPeer.url.origin,
        allowLoopbackHttp: true,
        bindings: [
          {
            workspaceId,
            projectId: "controlled-project",
            environment: "controlled",
            secretPath: "/otto",
          },
        ],
        getAccessToken: async () => "controlled-peer-capability",
      }),
      database.pool,
    );
    const endpoint = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const account = accounts.find((account) =>
          new URL(request.url).pathname.endsWith(account.id),
        );
        if (!account) return new Response(null, { status: 404 });
        const current = records.get(account.id);
        if (!current) throw new Error("Missing controlled account");
        return concurrent
          .refresh(
            account.id,
            credentialFingerprint(current.credential),
            current.authenticatedAt,
            credential(account.id, 2),
            request.signal,
          )
          .then(Response.json);
      },
    });
    try {
      const responses = await Promise.all(
        accounts.map((account) =>
          fetch(`${endpoint.url.origin}/${account.id}`, { method: "PUT" }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      for (const account of accounts) {
        const [row] = await database.db
          .select({ status: subscriptions.status })
          .from(subscriptions)
          .where(eq(subscriptions.id, account.id));
        expect(row?.status).toBe("enabled");
      }
    } finally {
      await concurrent.close();
      await endpoint.stop(true);
      await secretPeer.stop(true);
    }
  }, 12000);
  async function withOAuth(
    work: () => Promise<void>,
    hook?: (request: Request) => Promise<Response>,
  ) {
    const nativeFetch = globalThis.fetch;
    let device = 0;
    oauthHook =
      hook ??
      (async (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/usercode"))
          return Response.json({
            device_auth_id: `device-${++device}`,
            user_code: "CONTROLLED",
            interval: 0,
          });
        if (path.endsWith("/deviceauth/token"))
          return Response.json({
            authorization_code: "controlled-code",
            code_verifier: "controlled-verifier",
          });
        if (path.endsWith("/oauth/token"))
          return Response.json({
            access_token: credential().accessToken,
            refresh_token: credential().refreshToken,
            expires_in: 3600,
          });
        throw new Error("Unexpected OAuth endpoint");
      });
    const scopedFetch: typeof fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.hostname === "auth.openai.com") {
          url.protocol = "http:";
          url.host = new URL(peer.url).host;
          url.pathname = `/oauth-peer${url.pathname}`;
          return nativeFetch(url, init);
        }
        if (![new URL(origin).host, new URL(peer.url).host].includes(url.host))
          throw new Error("External request denied in fixture");
        return nativeFetch(input, init);
      },
      { preconnect: nativeFetch.preconnect },
    );
    vi.stubGlobal("fetch", scopedFetch);
    try {
      await work();
    } finally {
      vi.unstubAllGlobals();
      oauthHook = undefined;
    }
  }
  async function login() {
    return fetch(
      `${origin}/api/workspaces/${workspaceId}/subscriptions/${id}/login`,
      { method: "POST", headers: { cookie, origin } },
    );
  }
  it("runs the published public SDK device flow through HTTP and confirms Infisical before connected", async () => {
    await enabled();
    const previousAt = stored.authenticatedAt;
    await withOAuth(async () => {
      const response = await login();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/x-ndjson");
      const lines = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toEqual([
        {
          type: "device_code",
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "CONTROLLED",
          expiresInSeconds: 300,
        },
        { type: "connected", provider: "codex" },
      ]);
      expect(await status()).toBe("enabled");
      expect(stored.authenticatedAt > previousAt).toBe(true);
      expect((await callback()).status).toBe(200);
    });
  });
  it("a lost login persistence acknowledgement produces only sanitized failure and needs_auth", async () => {
    await enabled();
    writeHook = async () => new Response(null, { status: 503 });
    await withOAuth(async () => {
      const response = await login();
      const lines = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines.at(-1)).toEqual({ type: "error", code: "login_failed" });
      expect(lines.some((line) => line.type === "connected")).toBe(false);
      expect(await status()).toBe("needs_auth");
    });
  });
  it("a stale login failure cannot disable a newer successful authentication from another server", async () => {
    await enabled();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let device = 0;
    await withOAuth(
      async () => {
        const first = login();
        await pending;
        const secrets = createInfisicalAccounts({
          endpoint: peer.url.origin,
          allowLoopbackHttp: true,
          bindings: [
            {
              workspaceId,
              projectId: "controlled-project",
              environment: "controlled",
              secretPath: "/otto",
            },
          ],
          getAccessToken: async () => "controlled-peer-capability",
        });
        const second = createSubscriptionLogin(
          database.db,
          secrets,
          database.pool,
        );
        const events: string[] = [];
        try {
          await second.login(
            workspaceId,
            { userId },
            id,
            (event) => events.push(event.type),
            new AbortController().signal,
          );
          expect(events).toEqual(["device_code", "connected"]);
          expect(await status()).toBe("enabled");
          const newer = stored.authenticatedAt;
          release();
          const response = await first;
          expect(
            (await response.text()).includes('"code":"login_failed"'),
          ).toBe(true);
          expect(await status()).toBe("enabled");
          expect(stored.authenticatedAt).toBe(newer);
        } finally {
          release();
          await second.close();
        }
      },
      async (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/usercode"))
          return Response.json({
            device_auth_id: `device-${++device}`,
            user_code: "CONTROLLED",
            interval: 0,
          });
        if (path.endsWith("/deviceauth/token")) {
          const value = z
            .object({ device_auth_id: z.string() })
            .parse(await request.json());
          if (value.device_auth_id === "device-1") {
            entered();
            await gate;
          }
          return Response.json({
            authorization_code: "controlled-code",
            code_verifier: "controlled-verifier",
          });
        }
        if (path.endsWith("/oauth/token"))
          return Response.json({
            access_token: credential().accessToken,
            refresh_token: credential().refreshToken,
            expires_in: 3600,
          });
        throw new Error("Unexpected OAuth endpoint");
      },
    );
  });
});
