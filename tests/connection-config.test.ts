import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAuth } from "../apps/server/src/auth";
import { readConfig } from "../apps/server/src/config";
import { createConnectionOptions } from "../apps/server/src/connection-config";
import { startQueue } from "../apps/server/src/queue";
import { createConnection } from "../packages/connections/src";
import { readJson, requestHttp } from "../packages/connections/src/http";
import { operations } from "../packages/connections/src/schema";
import { MCP_PROTOCOL_VERSION } from "../packages/connections/src/server";
import { runs } from "../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

const baseEnv = () => ({
  DATABASE_URL: "postgresql://unused",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  OTTO_ORIGIN: "http://127.0.0.1:43001",
});
const binding = () => ({
  workspaceId: crypto.randomUUID(),
  connectionId: crypto.randomUUID(),
  credentialRef: "controlled-reference",
  tokenEnv: "OTTO_MCP_TOKEN_FIXTURE",
});
const configuredEnv = () => ({
  ...baseEnv(),
  MCP_ORIGIN: "https://controlled.vendor.com",
  MCP_CREDENTIAL_BINDINGS: JSON.stringify([binding()]),
});

describe("trusted process-injected MCP composition", () => {
  it("keeps computer deployment opt-in and validates all-or-none immutable configuration", () => {
    expect(readConfig(baseEnv()).COMPUTER_DOCKER_IMAGE).toBeUndefined();
    const computer = {
      COMPUTER_DOCKER_IMAGE: `sha256:${"a".repeat(64)}`,
      COMPUTER_DOCKER_SOCKET: "/private/controlled/docker.sock",
      COMPUTER_OWNER_ID: "otto-controlled_1",
    };
    expect(readConfig({ ...baseEnv(), ...computer })).toMatchObject(computer);
    for (const patch of [
      { COMPUTER_DOCKER_IMAGE: undefined },
      { COMPUTER_DOCKER_SOCKET: undefined },
      { COMPUTER_OWNER_ID: undefined },
      { COMPUTER_DOCKER_IMAGE: "mutable:latest" },
      { COMPUTER_DOCKER_SOCKET: "relative.sock" },
      { COMPUTER_DOCKER_SOCKET: "/private/\0docker.sock" },
      { COMPUTER_DOCKER_SOCKET: "https://docker.vendor.com" },
      { COMPUTER_OWNER_ID: "model-controlled/owner" },
      { COMPUTER_OWNER_ID: "a".repeat(81) },
    ])
      expect(() => readConfig({ ...baseEnv(), ...computer, ...patch })).toThrow(
        /^Invalid configuration fields: COMPUTER_/,
      );
  });
  it("leaves MCP unavailable without explicit deployment configuration", () => {
    const env = { ...baseEnv(), OTTO_MCP_TOKEN_UNBOUND: "ignored" };
    expect(createConnectionOptions(readConfig(env), env)).toBeUndefined();
  });
  it("rejects incomplete, noncanonical, multiple-origin, plaintext and GitHub configuration", () => {
    for (const patch of [
      { MCP_ORIGIN: undefined },
      { MCP_CREDENTIAL_BINDINGS: undefined },
      { MCP_ORIGIN: "https://controlled.vendor.com/" },
      { MCP_ORIGIN: "https://controlled.vendor.com https://other.vendor.com" },
      { MCP_ORIGIN: "https://api.github.com" },
      { MCP_ORIGIN: "http://127.0.0.1:12345" },
      {
        MCP_ORIGIN: "http://public.vendor.com",
        MCP_ALLOW_LOOPBACK_HTTP: "true",
      },
      { MCP_ORIGIN: "http://localhost:12345", MCP_ALLOW_LOOPBACK_HTTP: "true" },
      { MCP_ALLOW_LOOPBACK_HTTP: "false" },
    ])
      expect(() => readConfig({ ...configuredEnv(), ...patch })).toThrow(
        /^Invalid configuration fields: MCP_/,
      );
    expect(() =>
      readConfig({ ...baseEnv(), MCP_ALLOW_LOOPBACK_HTTP: "true" }),
    ).toThrow("MCP_ORIGIN");
    for (const origin of ["http://127.0.0.1:12345", "http://[::1]:12345"])
      expect(
        readConfig({
          ...configuredEnv(),
          MCP_ORIGIN: origin,
          MCP_ALLOW_LOOPBACK_HTTP: "true",
        }).MCP_ORIGIN,
      ).toBe(origin);
  });
  it("rejects unknown fields, duplicates, unbounded bindings and arbitrary environment names without exposing values", () => {
    const row = binding();
    for (const value of [
      "not-json-private-marker",
      JSON.stringify([]),
      JSON.stringify([row, row]),
      JSON.stringify(Array.from({ length: 101 }, binding)),
      JSON.stringify([{ ...row, tokenEnv: "BETTER_AUTH_SECRET" }]),
      JSON.stringify([{ ...row, endpoint: "https://untrusted.vendor.com" }]),
      JSON.stringify([{ ...row, workspaceId: "private-invalid-id" }]),
    ]) {
      expect(() =>
        readConfig({ ...configuredEnv(), MCP_CREDENTIAL_BINDINGS: value }),
      ).toThrow(/^Invalid configuration fields: MCP_CREDENTIAL_BINDINGS/);
      try {
        readConfig({ ...configuredEnv(), MCP_CREDENTIAL_BINDINGS: value });
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    }
  });
  it("captures only named injected credentials and isolates every reference field", async () => {
    const row = binding();
    const token = randomBytes(32).toString("hex");
    const env: NodeJS.ProcessEnv = {
      ...configuredEnv(),
      MCP_CREDENTIAL_BINDINGS: JSON.stringify([row]),
      [row.tokenEnv]: token,
    };
    const config = readConfig(env);
    expect(JSON.stringify(config)).not.toContain(token);
    const options = createConnectionOptions(config, env);
    expect(options).toBeDefined();
    env[row.tokenEnv] = "changed-after-composition";
    expect(
      await options?.secrets.resolve(row, new AbortController().signal),
    ).toBe(token);
    for (const field of [
      "workspaceId",
      "connectionId",
      "credentialRef",
    ] as const)
      await expect(
        options?.secrets.resolve(
          { ...row, [field]: crypto.randomUUID() },
          new AbortController().signal,
        ),
      ).rejects.toThrow("Credential scope is not configured");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      options?.secrets.resolve(row, aborted.signal),
    ).rejects.toThrow();
    for (const missing of [undefined, "", "line\nbreak", "x".repeat(65537)])
      expect(() =>
        createConnectionOptions(config, { [row.tokenEnv]: missing }),
      ).toThrow("Invalid configuration fields: MCP_CREDENTIAL_BINDINGS");
  });
  it("rejects a missing injected credential at the real entrypoint before acquiring services", async () => {
    const env = {
      ...configuredEnv(),
      OTTO_MCP_TOKEN_UNBOUND: randomBytes(32).toString("hex"),
    };
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "apps/server/src/index.ts"],
      {
        cwd: new URL("../", import.meta.url).pathname,
        env: { ...env, PATH: process.env.PATH },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain(
      "Invalid configuration fields: MCP_CREDENTIAL_BINDINGS",
    );
    expect(output).toContain("configuration rejected");
    expect(output).not.toContain("server startup failed");
    for (const value of [
      env.OTTO_MCP_TOKEN_UNBOUND,
      env.BETTER_AUTH_SECRET,
      env.ENCRYPTION_KEY,
      env.MCP_CREDENTIAL_BINDINGS,
    ])
      expect(output).not.toContain(value);
  });
  it("refuses another origin and redirects before a credential can reach the other peer", async () => {
    let otherRequests = 0;
    const other = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        otherRequests++;
        return Response.json({});
      },
    });
    const peer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.redirect(other.url, 307),
    });
    try {
      const env = {
        ...configuredEnv(),
        MCP_ORIGIN: peer.url.origin,
        MCP_ALLOW_LOOPBACK_HTTP: "true",
        OTTO_MCP_TOKEN_FIXTURE: randomBytes(32).toString("hex"),
      };
      const options = createConnectionOptions(readConfig(env), env);
      if (!options) throw new Error("Missing controlled options");
      await expect(
        requestHttp(other.url, {}, options.http, readJson),
      ).rejects.toThrow("Connection endpoint is not allowed");
      await expect(
        requestHttp(
          peer.url,
          {
            headers: { Authorization: `Bearer ${env.OTTO_MCP_TOKEN_FIXTURE}` },
          },
          options.http,
          readJson,
        ),
      ).rejects.toThrow("Connection provider request failed");
      expect(otherRequests).toBe(0);
    } finally {
      await peer.stop(true);
      await other.stop(true);
    }
  });
});

it("runs the real index.ts, native connection.request, human approval and revocation against isolated controlled peers", async () => {
  expect(process.versions.bun).toBe("1.4.2");
  const database = await startPostgres();
  const directory = await mkdtemp(join(tmpdir(), "otto-mcp-composition-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let peer: ReturnType<typeof Bun.serve> | undefined;
  let otherPeer: ReturnType<typeof Bun.serve> | undefined;
  let output = "";
  try {
    const queue = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await queue.stop();
    const probe = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    });
    const origin = probe.url.origin;
    const port = String(probe.port);
    await probe.stop(true);
    const env = {
      ...baseEnv(),
      OTTO_ORIGIN: origin,
      PORT: port,
      HOST: "127.0.0.1",
      DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    };
    const auth = createAuth(database.db, env.BETTER_AUTH_SECRET, origin);
    async function human() {
      const response = await auth.api.signUpEmail({
        body: {
          name: "Fictional MCP operator",
          email: `${crypto.randomUUID()}@example.test`,
          password: randomBytes(32).toString("hex"),
        },
        asResponse: true,
      });
      const cookie = response.headers.get("set-cookie") ?? "";
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      if (!session) throw new Error("Missing fixture session");
      return { id: session.user.id, cookie };
    }
    const owner = await human();
    const other = await human();
    const viewer = await human();
    const workspaceId = (
      await claimInstallation(database.db, owner.id, "MCP composition fixture")
    ).id;
    await database.db.insert(members).values([
      { workspaceId, userId: other.id, role: "contributor" },
      { workspaceId, userId: viewer.id, role: "viewer" },
    ]);
    const connection = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      (c) =>
        createConnection(c, {
          title: "Controlled MCP",
          type: "mcp",
          accountRef: "controlled-peer",
          visibility: "workspace",
        }),
    );
    const token = randomBytes(32).toString("hex");
    const modelToken = randomBytes(32).toString("hex");
    let writes = 0;
    let requests = 0;
    peer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests++;
        if (request.headers.get("authorization") !== `Bearer ${token}`)
          return new Response(null, { status: 401 });
        if (request.method === "DELETE")
          return new Response(null, { status: 204 });
        const input = (await request.json()) as { id?: number; method: string };
        if (input.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        let result: unknown;
        if (input.method === "initialize")
          result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "controlled-peer", version: "1" },
          };
        else if (input.method === "tools/list")
          result = {
            tools: [{ name: "write", inputSchema: { type: "object" } }],
          };
        else if (input.method === "resources/list")
          result = { resources: [{ uri: "fixture://record" }] };
        else if (input.method === "tools/call") {
          writes++;
          result = {
            content: [{ type: "text", text: "Controlled saved result" }],
          };
        } else return new Response(null, { status: 400 });
        return Response.json(
          { jsonrpc: "2.0", id: input.id, result },
          { headers: { "Mcp-Session-Id": "controlled-session" } },
        );
      },
    });
    const preload = join(directory, "controlled-native-model.ts");
    await writeFile(
      preload,
      `
      Bun.plugin({
        name: "isolated-deterministic-model-fixture",
        setup(build) {
          build.onLoad({ filter: /native-provider-model\\.ts$/ }, () => ({
            loader: "ts",
            contents: ${JSON.stringify(`
              import { controlledModel } from ${JSON.stringify(new URL("./fixtures/native-model.ts", import.meta.url).pathname)};
              export function createNativeModel() {
                return controlledModel({ toolRequests: [{ toolName: "connection_request", input: { connectionId: ${JSON.stringify(connection.id)}, action: "tool.write", target: "fixture://record", arguments: { resource: "fixture://record" } } }] });
              }
            `)},
          }));
        },
      });
    `,
    );
    const childEnv = {
      ...env,
      PATH: process.env.PATH,
      MCP_ORIGIN: peer.url.origin,
      MCP_ALLOW_LOOPBACK_HTTP: "true",
      MCP_CREDENTIAL_BINDINGS: JSON.stringify([
        {
          workspaceId,
          connectionId: connection.id,
          credentialRef: "controlled-reference",
          tokenEnv: "OTTO_MCP_TOKEN_FIXTURE",
        },
      ]),
      OTTO_MCP_TOKEN_FIXTURE: token,
    };
    child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        preload,
        "apps/server/src/index.ts",
      ],
      {
        cwd: new URL("../", import.meta.url).pathname,
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      },
    );
    const stdout = new Response(child.stdout as ReadableStream)
      .text()
      .then((text) => {
        output += text;
      });
    const stderr = new Response(child.stderr as ReadableStream)
      .text()
      .then((text) => {
        output += text;
      });
    await expect
      .poll(
        async () => (await fetch(`${origin}/ready`).catch(() => null))?.status,
        { timeout: 20000 },
      )
      .toBe(200);
    const request = (
      path: string,
      body?: unknown,
      who = owner,
      method = body === undefined ? "GET" : "POST",
    ) =>
      fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: {
          cookie: who.cookie,
          origin,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const json = async (path: string, body?: unknown, method?: string) => {
      const response = await request(path, body, owner, method);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    };
    const config = {
      type: "mcp",
      endpoint: peer.url.href,
      tools: [{ name: "write", targetArgument: "resource", readOnly: false }],
      resources: ["fixture://record"],
    };
    await json(
      `/connections/${connection.id}`,
      {
        editToken: connection.editToken,
        credentialRef: "controlled-reference",
        config,
      },
      "PATCH",
    );
    const before = requests;
    expect(
      (
        await request(
          `/connections/${connection.id}/connect`,
          {},
          { id: "", cookie: "" },
        )
      ).status,
    ).toBe(401);
    expect(
      (await request(`/connections/${connection.id}/connect`, {}, other))
        .status,
    ).toBe(403);
    expect(
      (await request(`/connections/${connection.id}/connect`, {}, viewer))
        .status,
    ).toBe(403);
    expect(requests).toBe(before);
    expect(
      await json(`/connections/${connection.id}/connect`, {}),
    ).toMatchObject({ connected: true });
    expect(await json(`/connections/${connection.id}/discover`, {})).toEqual({
      actions: ["tool.write", "resource.read"],
      resources: ["fixture://record"],
    });
    let otherRequests = 0;
    otherPeer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        otherRequests++;
        return Response.json({});
      },
    });
    const changed = await json(
      `/connections/${connection.id}`,
      {
        editToken: (await json(`/connections/${connection.id}`)).editToken,
        config: { ...config, endpoint: otherPeer.url.href },
      },
      "PATCH",
    );
    expect(
      (await request(`/connections/${connection.id}/connect`, {})).status,
    ).toBe(403);
    expect(otherRequests).toBe(0);
    await json(
      `/connections/${connection.id}`,
      { editToken: changed.editToken, config },
      "PATCH",
    );
    await json(`/connections/${connection.id}/connect`, {});
    const publicView = await json(`/connections/${connection.id}`);
    expect(publicView).not.toHaveProperty("credentialRef");
    expect(publicView).not.toHaveProperty("config");
    const unbound = await json("/connections", {
      title: "Unbound",
      type: "mcp",
      accountRef: "controlled",
      visibility: "workspace",
    });
    await json(
      `/connections/${unbound.id}`,
      {
        editToken: unbound.editToken,
        credentialRef: "controlled-reference",
        config,
      },
      "PATCH",
    );
    const prior = requests;
    expect(
      (await request(`/connections/${unbound.id}/connect`, {})).status,
    ).toBe(503);
    expect(requests).toBe(prior);
    const subscription = await json("/subscriptions", {
      title: "Controlled native model",
      provider: "openai-compatible",
      protocol: "chat-completions",
      baseUrl: "https://controlled.vendor.com/v1",
      models: ["fixture"],
      visibility: "workspace",
    });
    await json(
      `/subscriptions/${subscription.id}/api-key`,
      { apiKey: modelToken },
      "PUT",
    );
    const agent = (
      await json("/agents", {
        title: "Controlled agent",
        instructions: "Controlled MCP composition fixture",
        model: "fixture",
        subscriptionId: subscription.id,
        visibility: "workspace",
      })
    ).agent;
    await json(`/connections/${connection.id}/grants`, {
      agentId: agent.id,
      audience: { humans: [owner.id], agents: [agent.id] },
      resources: ["fixture://record"],
      operations: { "tool.write": "confirmation" },
    });
    async function startRun() {
      const chat = await json("/chats", {
        title: "Controlled MCP run",
        visibility: "participants",
      });
      await json(`/chats/${chat.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
      const run = await json("/runs", {
        requestId: crypto.randomUUID(),
        chatId: chat.id,
        agentId: agent.id,
        type: "prompt",
        body: "Controlled MCP tool request",
      });
      await expect
        .poll(
          async () => {
            const operation = (
              await database.db
                .select()
                .from(operations)
                .where(eq(operations.runId, run.id))
            )[0];
            if (operation) return operation.state;
            const state = (
              await database.db.select().from(runs).where(eq(runs.id, run.id))
            )[0];
            return `${state?.state}:${state?.outcome}`;
          },
          { timeout: 20000 },
        )
        .toBe("awaiting_approval");
      const operation = (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.runId, run.id))
      )[0];
      if (!operation) throw new Error("Missing native tool operation");
      return { run, operation };
    }
    const first = await startRun();
    expect(writes).toBe(0);
    expect(
      (
        await request(
          `/operations/${first.operation.id}/approve`,
          { identity: first.operation.identity },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/operations/${first.operation.id}/approve`, {
          identity: "0".repeat(64),
        })
      ).status,
    ).toBe(409);
    await json(`/operations/${first.operation.id}/approve`, {
      identity: first.operation.identity,
    });
    await expect
      .poll(
        async () => (await json(`/operations/${first.operation.id}`)).state,
        { timeout: 15000 },
      )
      .toBe("succeeded");
    expect(writes).toBe(1);
    await expect
      .poll(
        async () =>
          (
            await database.db
              .select()
              .from(runs)
              .where(eq(runs.id, first.run.id))
          )[0]?.state,
        { timeout: 15000 },
      )
      .toBe("finished");
    const saved = await json(`/operations/${first.operation.id}`);
    expect(saved.result).toBeUndefined();
    expect(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, first.operation.id))
      )[0]?.result,
    ).toBeTruthy();
    const second = await startRun();
    await json(
      `/connections/${connection.id}/grants/${agent.id}`,
      undefined,
      "DELETE",
    );
    expect([403, 409]).toContain(
      (
        await request(`/operations/${second.operation.id}/approve`, {
          identity: second.operation.identity,
        })
      ).status,
    );
    expect([403, 409]).toContain(
      (await request(`/operations/${second.operation.id}/execute`, {})).status,
    );
    expect(writes).toBe(1);
    await expect
      .poll(
        async () =>
          (
            await database.db
              .select()
              .from(runs)
              .where(eq(runs.id, second.run.id))
          )[0]?.state,
        { timeout: 15000 },
      )
      .toBe("interrupted");
    await json(`/connections/${connection.id}/disconnect`, {});
    expect((await json(`/connections/${connection.id}`)).connected).toBe(false);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    await Promise.all([stdout, stderr]);
    const priorResult = (
      await database.db
        .select()
        .from(operations)
        .where(eq(operations.id, first.operation.id))
    )[0]?.result;
    child = Bun.spawn(
      [process.execPath, "--no-env-file", "apps/server/src/index.ts"],
      {
        cwd: new URL("../", import.meta.url).pathname,
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      },
    );
    const restartedOut = new Response(child.stdout as ReadableStream).text();
    const restartedErr = new Response(child.stderr as ReadableStream).text();
    await expect
      .poll(
        async () => (await fetch(`${origin}/ready`).catch(() => null))?.status,
        { timeout: 20000 },
      )
      .toBe(200);
    expect((await json(`/operations/${first.operation.id}`)).state).toBe(
      "succeeded",
    );
    expect(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, first.operation.id))
      )[0]?.result,
    ).toEqual(priorResult);
    expect((await json(`/connections/${connection.id}`)).connected).toBe(false);
    await json(`/connections/${connection.id}/connect`, {});
    expect((await json(`/connections/${connection.id}`)).connected).toBe(true);
    expect(writes).toBe(1);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    output += (await restartedOut) + (await restartedErr);
    expect(output).not.toContain(token);
    expect(output).not.toContain(modelToken);
    expect(output).not.toContain("server startup failed");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    await peer?.stop(true);
    await otherPeer?.stop(true);
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
