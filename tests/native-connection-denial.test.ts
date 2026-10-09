import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { readConfig } from "../apps/server/src/config";
import { connectionService } from "../apps/server/src/connections";
import { startServer } from "../apps/server/src/lifecycle";
import { startQueue } from "../apps/server/src/queue";
import { MCP_PROTOCOL_VERSION } from "../packages/connections/src/server";
import { runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
} from "./fixtures/native-model";
import { startS3Peer } from "./fixtures/s3-peer";
import { startPostgres } from "./postgres";

it("authorizes exact human Connection decisions and execution against native selected-message attachments over real HTTP", async () => {
  const database = await startPostgres();
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  await boss.stop();
  const s3 = await startS3Peer();
  const spool = await mkdtemp(join(tmpdir(), "otto-native-denial-"));
  let writes = 0;
  const peer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      const input = z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.number().optional(),
          method: z.string(),
        })
        .parse(await request.json());
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
        result = { resources: [{ uri: "fixture://selected" }] };
      else if (input.method === "tools/call") {
        writes++;
        result = { content: [{ type: "text", text: "Controlled result" }] };
      } else return new Response(null, { status: 400 });
      return Response.json(
        { jsonrpc: "2.0", id: input.id, result },
        { headers: { "Mcp-Session-Id": "controlled-denial-session" } },
      );
    },
  });
  const native = await openNativeStorage({
    connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
  });
  const origin = "http://localhost:43101";
  const verification = new Map<string, string>();
  const connections = {
    secrets: { resolve: async () => "controlled-peer-not-a-real-credential" },
    http: {
      allowedOrigins: [peer.url.origin],
      allowLoopbackHttp: true,
      timeoutMs: 1000,
    },
  };
  let prompted = false;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(
      readConfig({
        DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
        BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
        ENCRYPTION_KEY: fixtureEncryptionKey.toString("base64"),
        OTTO_ORIGIN: origin,
        HOST: "127.0.0.1",
        PORT: "0",
        S3_ENDPOINT: s3.endpoint,
        S3_BUCKET: s3.bucket,
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "controlled-peer",
        S3_SECRET_ACCESS_KEY: "controlled-peer-not-a-real-credential",
        UPLOAD_SPOOL_DIR: spool,
      }),
      {
        connections,
        execution: {
          resolveModel: async (_attempt, signal) =>
            controlledModel({
              hold: true,
              signal,
              onPrompt: () => {
                prompted = true;
              },
            }),
        },
        mail: {
          async send(message) {
            if (message.subject === "Verify your Otto email")
              verification.set(
                message.to,
                message.text.slice("Verify your email: ".length),
              );
          },
        },
      },
    );
    const apiOrigin = server.server.url.origin;
    const authRequest = (path: string, body?: unknown) =>
      fetch(`${apiOrigin}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        redirect: "manual",
        headers: { origin, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const signup = async () => {
      const email = `${crypto.randomUUID()}@example.test`;
      const password = randomBytes(32).toString("base64");
      expect(
        (
          await authRequest("/sign-up/email", {
            name: "Fictional operator",
            email,
            password,
          })
        ).status,
      ).toBe(200);
      const url = new URL(verification.get(email) ?? "");
      expect(url.origin).toBe(origin);
      expect(
        (
          await fetch(`${apiOrigin}${url.pathname}${url.search}`, {
            redirect: "manual",
            headers: { origin },
          })
        ).status,
      ).toBe(302);
      const response = await authRequest("/sign-in/email", { email, password });
      expect(response.status).toBe(200);
      return {
        id: z
          .object({ user: z.object({ id: z.string() }) })
          .parse(await response.json()).user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    };
    const owner = await signup();
    const other = await signup();
    const workspaceId = (
      await claimInstallation(database.db, owner.id, "Native denial fixture")
    ).id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other.id, role: "contributor" });
    const request = (
      path: string,
      body?: unknown,
      cookie = owner.cookie,
      method = body ? "POST" : "GET",
    ) =>
      fetch(`${apiOrigin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: { cookie, origin, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const json = async (path: string, body?: unknown, method?: string) => {
      const response = await request(path, body, owner.cookie, method);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    };
    const subscriptionId = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      controlledSubscription,
    );
    const agent = z.object({ agent: z.object({ id: z.uuid() }) }).parse(
      await json("/agents", {
        title: "Native operator",
        instructions: "Controlled transport fixture",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      }),
    ).agent;
    const chat = z.object({ id: z.uuid() }).parse(
      await json("/chats", {
        title: "Selected source",
        visibility: "workspace",
      }),
    );
    await json(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const project = z
      .object({ id: z.uuid() })
      .parse(await json("/projects", { title: "Attachment audience" }));
    await json(`/projects/${project.id}/members`, {
      userId: other.id,
      role: "contributor",
    });
    const file = z.object({ id: z.uuid() }).parse(
      await json("/files", {
        requestId: crypto.randomUUID(),
        title: "Selected attachment",
        projectId: project.id,
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
        bytes: Buffer.from("Controlled attachment bytes").toString("base64"),
      }),
    );
    const message = z.object({ id: z.uuid() }).parse(
      await json(`/chats/${chat.id}/messages`, {
        requestId: crypto.randomUUID(),
        body: "Native selected source",
        fileIds: [file.id],
      }),
    );
    const connection = z.object({ id: z.uuid(), editToken: z.number() }).parse(
      await json("/connections", {
        title: "Controlled MCP",
        type: "mcp",
        accountRef: "controlled-peer",
        visibility: "workspace",
      }),
    );
    await json(
      `/connections/${connection.id}`,
      {
        editToken: connection.editToken,
        credentialRef: "controlled-reference",
        config: {
          type: "mcp",
          endpoint: peer.url.href,
          tools: [
            { name: "write", targetArgument: "resource", readOnly: false },
          ],
          resources: ["fixture://selected"],
        },
      },
      "PATCH",
    );
    await json(`/connections/${connection.id}/connect`, {});
    await json(`/connections/${connection.id}/grants`, {
      agentId: agent.id,
      audience: { humans: [owner.id, other.id], agents: [agent.id] },
      resources: ["fixture://selected"],
      operations: { "tool.write": "confirmation" },
    });
    const run = z.object({ id: z.uuid() }).parse(
      await json("/runs", {
        requestId: crypto.randomUUID(),
        agentId: agent.id,
        chatId: chat.id,
        type: "prompt",
        body: "Hold for human decisions",
        messageIds: [message.id],
      }),
    );
    await expect.poll(() => prompted, { timeout: 15000 }).toBe(true);
    const accepted = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    if (!accepted) throw new Error("Missing running native attempt");
    expect(accepted.state).toBe("running");
    expect(accepted.inputs.context?.messages[0]?.fileIds).toEqual([file.id]);
    expect(s3.stats.gets).toBeGreaterThan(0);
    const service = connectionService(
      database.db,
      workspaceId,
      { userId: owner.id, agentId: agent.id },
      { ...connections, native },
    );
    const operation = () =>
      service.requestOperation({
        runId: run.id,
        launchKey: accepted.launchKey,
        attempt: accepted.attempt,
        environmentGeneration: accepted.environmentGeneration,
        connectionId: connection.id,
        requestId: crypto.randomUUID(),
        action: "tool.write",
        target: "fixture://selected",
        arguments: { resource: "fixture://selected" },
      });
    const denied = await operation();
    const decision = { identity: denied.identity };
    const path = `/operations/${denied.id}/deny`;
    expect((await request(path, decision, "")).status).toBe(401);
    expect((await request(path, decision, other.cookie)).status).toBe(403);
    expect((await request(path, { identity: "0".repeat(64) })).status).toBe(
      409,
    );
    expect(
      (await request(path, { ...decision, agentId: agent.id })).status,
    ).toBe(400);
    const first = await json(path, decision);
    expect(first).toMatchObject({
      state: "denied",
      deniedBy: owner.id,
      deniedAt: expect.any(String),
    });
    expect(await json(path, decision)).toEqual(first);
    expect((await json(`/operations/${denied.id}/execute`, {})).state).toBe(
      "denied",
    );
    expect((await request(`/operations/${denied.id}/retry`, {})).status).toBe(
      409,
    );
    expect(writes).toBe(0);
    const approved = await operation();
    expect(
      (
        await json(`/operations/${approved.id}/approve`, {
          identity: approved.identity,
        })
      ).state,
    ).toBe("approved");
    expect((await json(`/operations/${approved.id}/execute`, {})).state).toBe(
      "succeeded",
    );
    expect(writes).toBe(1);
    const pending = await operation();
    const ready = await operation();
    const executable = await operation();
    await json(`/operations/${executable.id}/approve`, {
      identity: executable.identity,
    });
    await json(
      `/projects/${project.id}/members/${other.id}`,
      undefined,
      "DELETE",
    );
    expect(
      (
        await request(`/operations/${pending.id}/deny`, {
          identity: pending.identity,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/operations/${ready.id}/approve`, {
          identity: ready.identity,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/operations/${executable.id}/execute`, {})).status,
    ).toBe(403);
    expect(writes).toBe(1);
  } finally {
    await server?.stop();
    await native.close();
    await peer.stop(true);
    await s3.stop();
    await rm(spool, { recursive: true, force: true });
    await database.stop();
  }
}, 45000);
