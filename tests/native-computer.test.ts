import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopObserve } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createComputer } from "../apps/server/src/computer";
import { readConfig } from "../apps/server/src/config";
import { startServer } from "../apps/server/src/lifecycle";
import { startQueue } from "../apps/server/src/queue";
import { environments } from "../packages/environments/src/schema";
import { runs } from "../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
} from "./fixtures/native-model";
import { startS3Peer } from "./fixtures/s3-peer";
import { startPostgres } from "./postgres";

const image = process.env.OTTO_TEST_COMPUTER_IMAGE;
const socketPath = process.env.OTTO_TEST_COMPUTER_SOCKET;
const configured = Boolean(image && socketPath);
const options = () => ({
  image: image ?? "",
  socketPath: socketPath ?? "",
  ownerId: `test-${crypto.randomUUID()}`,
});
const identity = () => ({
  runId: crypto.randomUUID(),
  agentId: crypto.randomUUID(),
  attempt: 1,
  launchKey: crypto.randomUUID(),
});

function computation(
  provider = createComputer(options()),
  authorize = async () => {},
  attempt = identity(),
) {
  const abort = new AbortController();
  const tool = provider.tool(attempt, abort.signal, authorize);
  return {
    provider,
    attempt,
    abort,
    run: (code: string, toolCallId = crypto.randomUUID()) =>
      tool.execute?.(
        { code },
        {
          observe: noopObserve,
          agent: {
            agentId: attempt.agentId,
            toolCallId,
            messages: [],
            suspend: async () => {
              throw new Error("Unexpected suspension");
            },
          },
        },
      ),
    cleanup: () => provider.cleanup(attempt),
  };
}

async function controlledDocker() {
  if (!socketPath) throw new Error("Owned Docker socket required");
  const directory = await mkdtemp(join(tmpdir(), "otto-computer-docker-"));
  const path = join(directory, "proxy.sock");
  const sockets = new Set<Socket>();
  const state = {
    denyDelete: false,
    delayCreateMs: 0,
    creates: 0,
    deletes: 0,
    pulls: 0,
    collision: false,
    createConflict: false,
    imageDisappears: false,
    starts: 0,
  };
  const proxy = createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => {});
    let pending = Buffer.alloc(0);
    const headers = (bytes: Buffer) => {
      pending = Buffer.concat([pending, bytes]);
      if (pending.length > 65536) {
        client.destroy();
        return;
      }
      const end = pending.indexOf("\r\n\r\n");
      if (end === -1) return;
      const header = pending.subarray(0, end + 4).toString();
      const contentLength = Number(
        header.match(/^Content-Length: (\d+)\r?$/im)?.[1] ?? 0,
      );
      if (pending.length < end + 4 + contentLength) return;
      client.off("data", headers);
      client.pause();
      const line = header.split("\r\n")[0] ?? "";
      if (!/^Connection:.*upgrade/im.test(header)) {
        const closed = header
          .replace(/^Connection:[^\r]*\r\n/gim, "")
          .replace(/\r\n\r\n$/, "\r\nConnection: close\r\n\r\n");
        pending = Buffer.concat([
          Buffer.from(closed),
          pending.subarray(end + 4),
        ]);
      }
      const create =
        line.startsWith("POST ") && line.includes("/containers/create");
      if (create) state.creates++;
      if (line.startsWith("POST ") && /\/containers\/[^/]+\/start/.test(line))
        state.starts++;
      if (create && (state.createConflict || state.imageDisappears)) {
        const status = state.createConflict ? "409 Conflict" : "404 Not Found";
        client.end(
          `HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      if (line.startsWith("POST ") && line.includes("/images/create"))
        state.pulls++;
      if (line.startsWith("DELETE ")) {
        state.deletes++;
        if (state.denyDelete) {
          client.end(
            "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
          );
          return;
        }
      }
      if (
        state.collision &&
        line.startsWith("GET ") &&
        decodeURIComponent(line).includes("otto.computer.id")
      ) {
        const body = JSON.stringify([
          { Id: "foreign-preexisting", State: "exited" },
        ]);
        client.end(
          `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        return;
      }
      const forward = () => {
        const upstream = createConnection(socketPath, () => {
          upstream.write(pending);
          if (client.destroyed) {
            upstream.resume();
            return;
          }
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
        });
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());
      };
      if (create && state.delayCreateMs)
        setTimeout(forward, state.delayCreateMs);
      else forward();
    };
    client.on("data", headers);
  });
  await new Promise<void>((resolve) => proxy.listen(path, resolve));
  return {
    path,
    state,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function ownedContainers(ownerId: string) {
  const query = new URLSearchParams({
    all: "1",
    filters: JSON.stringify({ label: [`otto.computer.owner=${ownerId}`] }),
  });
  const response = await fetch(`http://docker/containers/json?${query}`, {
    unix: socketPath,
  });
  expect(response.status).toBe(200);
  return z
    .array(z.object({ Id: z.string(), State: z.string() }))
    .parse(await response.json());
}

describe.skipIf(!configured)(
  "confined native offline computers on owned Docker",
  () => {
    it("never pulls missing images or reconnects a preexisting identity", async () => {
      const proxy = await controlledDocker();
      try {
        const missing = computation(
          createComputer({
            ...options(),
            socketPath: proxy.path,
            image: `sha256:${"0".repeat(64)}`,
          }),
        );
        await expect(
          missing.run("console.log('denied')"),
        ).rejects.toBeDefined();
        await missing.cleanup();
        expect(proxy.state.pulls).toBe(0);
        expect(proxy.state.creates).toBe(0);
        proxy.state.collision = true;
        const collision = computation(
          createComputer({ ...options(), socketPath: proxy.path }),
        );
        await expect(
          collision.run("console.log('denied')"),
        ).rejects.toBeDefined();
        await collision.cleanup();
        expect(proxy.state.creates).toBe(0);
        expect(proxy.state.deletes).toBe(0);
      } finally {
        await proxy.close();
      }
    });

    it("never pulls or touches another container when image or name changes after preflight", async () => {
      for (const mode of ["imageDisappears", "createConflict"] as const) {
        const proxy = await controlledDocker();
        const config = { ...options(), socketPath: proxy.path };
        const work = computation(createComputer(config));
        proxy.state[mode] = true;
        try {
          await expect(
            work.run("console.log('must not execute')"),
          ).rejects.toMatchObject({ code: "unavailable" });
          await work.cleanup();
          expect(proxy.state.creates).toBe(1);
          expect(proxy.state.pulls).toBe(0);
          expect(proxy.state.starts).toBe(0);
          expect(proxy.state.deletes).toBe(0);
          expect(await ownedContainers(config.ownerId)).toEqual([]);
        } finally {
          await proxy.close();
        }
      }
    });

    it("joins a cancelled provisioning request and removes the late container", async () => {
      const proxy = await controlledDocker();
      const config = { ...options(), socketPath: proxy.path };
      proxy.state.delayCreateMs = 500;
      const work = computation(createComputer(config));
      try {
        const running = work.run("console.log('must not execute')");
        const cancelled = Promise.resolve(running).then(
          () => false,
          () => true,
        );
        await expect.poll(() => proxy.state.creates).toBe(1);
        work.abort.abort();
        expect(await cancelled).toBe(true);
        await work.cleanup();
        expect(await ownedContainers(config.ownerId)).toEqual([]);
      } finally {
        await proxy.close();
      }
    });

    it("retains uncertainty when create commits after its request timed out", async () => {
      const proxy = await controlledDocker();
      const config = { ...options(), socketPath: proxy.path };
      const provider = createComputer(config);
      const work = computation(provider);
      proxy.state.delayCreateMs = 3200;
      try {
        await expect(
          work.run("console.log('must not execute')"),
        ).rejects.toMatchObject({
          errors: [{ code: "unavailable" }, { code: "unavailable" }],
        });
        await expect(work.cleanup()).rejects.toMatchObject({
          code: "unavailable",
        });
        await expect
          .poll(async () => (await ownedContainers(config.ownerId)).length, {
            timeout: 3000,
          })
          .toBe(1);
        expect((await ownedContainers(config.ownerId))[0]?.State).toBe(
          "created",
        );
        await work.cleanup();
        expect(await ownedContainers(config.ownerId)).toEqual([]);
      } finally {
        await provider.prepare();
        await proxy.close();
      }
    });

    it("withholds a cleanup-failed result, enforces PID1 lifetime despite attacks, and removes only its stopped orphan", async () => {
      const proxy = await controlledDocker();
      const config = { ...options(), socketPath: proxy.path };
      const provider = createComputer(config);
      const work = computation(provider);
      proxy.state.denyDelete = true;
      const started = Date.now();
      try {
        await expect(
          work.run(`
          const fs = require('fs');
          try { fs.openSync('/proc/1/mem','r+'); process.exit(9); } catch {}
          for (const signal of ['SIGSTOP','SIGKILL','SIGTERM']) { try { process.kill(1,signal); } catch {} }
          require('child_process').spawn('node',['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'}).unref();
          console.log('must not be published');
        `),
        ).rejects.toMatchObject({ code: "unavailable" });
        await expect(work.cleanup()).rejects.toMatchObject({
          code: "unavailable",
        });
        expect(proxy.state.deletes).toBeGreaterThan(0);
        expect(
          (await ownedContainers(config.ownerId)).some(
            (container) => container.State === "running",
          ),
        ).toBe(true);
        await expect
          .poll(
            async () =>
              (await ownedContainers(config.ownerId)).every(
                (container) => container.State !== "running",
              ),
            { timeout: 65000, interval: 500 },
          )
          .toBe(true);
        expect(Date.now() - started).toBeLessThan(65000);
        proxy.state.denyDelete = false;
        const restarted = createComputer(config);
        await restarted.prepare();
        expect(await ownedContainers(config.ownerId)).toEqual([]);
      } finally {
        proxy.state.denyDelete = false;
        for (const container of await ownedContainers(config.ownerId))
          await fetch(`http://docker/containers/${container.Id}?force=true`, {
            unix: socketPath,
            method: "DELETE",
          });
        await proxy.close();
      }
    }, 75000);
    it("computes with no host mounts, network, privileges or ambient credentials and destroys before returning", async () => {
      const work = computation();
      try {
        const result = await work.run(`
        const fs = require('node:fs');
        if (process.getuid() !== 1000 || fs.existsSync('/var/run/docker.sock') || fs.existsSync('/Users')) process.exit(1);
        const allowed = ['HOME','PATH','NODE_VERSION','YARN_VERSION','HOSTNAME','PWD'];
        if (Object.keys(process.env).some(key => !allowed.includes(key))) process.exit(2);
        if (fs.readFileSync('/proc/self/status','utf8').match(/CapEff:\\s*(\\w+)/)?.[1] !== '0000000000000000') process.exit(3);
        fs.writeFileSync('/tmp/result', '42');
        let readonly=false; try { fs.writeFileSync('/host-write','x'); } catch { readonly=true; }
        if (!readonly) process.exit(4);
        const net = require('node:net');
        const socket = net.connect({host:'1.1.1.1',port:443});
        socket.on('connect',()=>process.exit(5));
        socket.on('error',()=>process.stdout.write(fs.readFileSync('/tmp/result')));
      `);
        expect(result).toMatchObject({ exitCode: 0, stdout: "42", stderr: "" });
      } finally {
        await work.cleanup();
      }
    });

    it("isolates simultaneous writers and never inherits earlier computer files", async () => {
      const provider = createComputer(options());
      const first = computation(provider);
      const second = computation(provider);
      try {
        const results = await Promise.all([
          first.run(
            "require('fs').writeFileSync('/tmp/private','writer-one'); setTimeout(()=>console.log('one'),300)",
          ),
          second.run(
            "console.log(require('fs').existsSync('/tmp/private') ? 'leaked' : 'isolated')",
          ),
        ]);
        expect(results[0]).toMatchObject({ stdout: "one\n" });
        expect(results[1]).toMatchObject({ stdout: "isolated\n" });
      } finally {
        await Promise.all([first.cleanup(), second.cleanup()]);
      }
    });

    it("joins cancellation including a daemonized child before reuse", async () => {
      const work = computation();
      const running = work.run(
        "require('child_process').spawn('node',['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'}).unref(); setInterval(()=>{},100)",
      );
      const stopped = expect(running).rejects.toMatchObject({
        code: "unavailable",
      });
      setTimeout(() => work.abort.abort(), 400);
      await stopped;
      await work.cleanup();
    });

    it("bounds flooding output and refuses a second or modified action", async () => {
      const flood = computation();
      try {
        await expect(
          flood.run(
            "setInterval(()=>process.stdout.write('x'.repeat(65536)),1)",
          ),
        ).rejects.toMatchObject({ code: "unavailable" });
      } finally {
        await flood.cleanup();
      }
      const work = computation();
      try {
        const callId = crypto.randomUUID();
        const result = await work.run("console.log(42)", callId);
        expect(await work.run("console.log(42)", callId)).toEqual(result);
        await expect(work.run("console.log(43)", callId)).rejects.toMatchObject(
          { code: "conflict" },
        );
        await expect(work.run("console.log(42)")).rejects.toMatchObject({
          code: "conflict",
        });
      } finally {
        await work.cleanup();
      }
    });

    it("caps combined stdout and stderr at sixteen KiB", async () => {
      const exact = computation();
      const result = await exact.run(
        "process.stdout.write('a'.repeat(8192)); process.stderr.write('b'.repeat(8192));",
      );
      expect(result).toMatchObject({
        stdout: "a".repeat(8192),
        stderr: "b".repeat(8192),
      });
      await exact.cleanup();
      const overflow = computation();
      await expect(
        overflow.run(
          "process.stdout.write('a'.repeat(9000)); process.stderr.write('b'.repeat(9000));",
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
      await overflow.cleanup();
      const invalidUtf8 = computation();
      await expect(
        invalidUtf8.run("process.stdout.write(Buffer.alloc(8192, 255));"),
      ).rejects.toMatchObject({ code: "unavailable" });
      await invalidUtf8.cleanup();
    });

    it("denies current authority before provision and withholds results after revocation", async () => {
      let authorized = false;
      const work = computation(createComputer(options()), async () => {
        if (!authorized) throw new Error("Fixture authority revoked");
      });
      await expect(work.run("console.log('not launched')")).rejects.toThrow(
        "Fixture authority revoked",
      );
      authorized = true;
      const running = work.run("setTimeout(()=>console.log('private'),400)");
      const denied = expect(running).rejects.toMatchObject({
        code: "unavailable",
      });
      setTimeout(() => {
        authorized = false;
      }, 300);
      await denied;
      await work.cleanup();
    });

    it("refuses an unavailable cached image without starting a sandbox", async () => {
      const provider = createComputer({
        ...options(),
        image: `sha256:${"0".repeat(64)}`,
      });
      await expect(provider.prepare()).rejects.toBeDefined();
      const work = computation(provider);
      await expect(
        work.run("console.log('not launched')"),
      ).rejects.toMatchObject({ code: "unavailable" });
      await work.cleanup();
    });

    it("uses authenticated admission, actual native result, File bytes and Chat attachment reload", async () => {
      const database = await startPostgres();
      const boss = await startQueue(database.db, database.pool, {
        workers: false,
        install: true,
      });
      await boss.stop();
      const s3 = await startS3Peer();
      const spool = await mkdtemp(join(tmpdir(), "otto-computer-native-"));
      const proxy = await controlledDocker();
      const computerConfig = { ...options(), socketPath: proxy.path };
      const origin = "http://localhost:47813";
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      const fileInput = {
        title: "Computed answer",
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
        text: "unset",
      };
      const messageInput = {
        body: "Computed artifact",
        fileIds: [] as string[],
      };
      let computed = false;
      let createdFile = "";
      let createdMessage = "";
      let mode: "normal" | "hold" | "cleanup-failure" = "normal";
      let modelStarts = 0;
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
            computer: computerConfig,
            execution: {
              resolveModel: async () => {
                modelStarts++;
                if (mode !== "normal")
                  return controlledModel({
                    toolRequests: [
                      {
                        toolName: "computer_execute",
                        input: {
                          code:
                            mode === "hold"
                              ? "setInterval(()=>{},100)"
                              : "console.log('withhold when cleanup fails')",
                        },
                      },
                    ],
                  });
                return controlledModel({
                  steps: [
                    {
                      toolRequests: [
                        {
                          toolName: "computer_execute",
                          input: { code: "process.stdout.write(String(6*7))" },
                        },
                      ],
                    },
                    {
                      toolRequests: [
                        { toolName: "file_create", input: fileInput },
                      ],
                    },
                    {
                      toolRequests: [
                        { toolName: "message_create", input: messageInput },
                      ],
                    },
                    { text: "Offline computation saved to this Chat." },
                  ],
                  onPrompt: (prompt) => {
                    const visit = (value: unknown) => {
                      if (!value || typeof value !== "object") return;
                      const record = value as Record<string, unknown>;
                      if (
                        record.toolName === "computer_execute" &&
                        record.type === "tool-result"
                      ) {
                        const output = record.output as
                          | { value?: unknown }
                          | undefined;
                        const result = z
                          .object({
                            stdout: z.string(),
                            exitCode: z.literal(0),
                          })
                          .parse(output?.value ?? record.result);
                        fileInput.text = result.stdout;
                        computed = true;
                      }
                      if (
                        record.toolName === "file_create" &&
                        record.type === "tool-result"
                      ) {
                        const output = record.output as
                          | { value?: unknown }
                          | undefined;
                        createdFile = z
                          .object({ id: z.uuid() })
                          .parse(output?.value ?? record.result).id;
                        messageInput.fileIds = [createdFile];
                      }
                      if (
                        record.toolName === "message_create" &&
                        record.type === "tool-result"
                      ) {
                        const output = record.output as
                          | { value?: unknown }
                          | undefined;
                        createdMessage = z
                          .object({ id: z.uuid() })
                          .parse(output?.value ?? record.result).id;
                      }
                      for (const child of Object.values(record)) visit(child);
                    };
                    visit(prompt);
                  },
                });
              },
            },
          },
        );
        const base = server.server.url.origin;
        const password = randomBytes(32).toString("base64");
        const email = `${crypto.randomUUID()}@example.test`;
        const auth = (path: string, body: unknown) =>
          fetch(`${base}/api/auth/${path}`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify(body),
          });
        expect(
          (
            await auth("sign-up/email", {
              name: "Computer fixture",
              email,
              password,
            })
          ).status,
        ).toBe(200);
        const login = await auth("sign-in/email", { email, password });
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie") ?? "";
        const userId = z
          .object({ user: z.object({ id: z.string() }) })
          .parse(await login.json()).user.id;
        const workspaceId = (
          await claimInstallation(database.db, userId, "Computer fixture")
        ).id;
        const request = (path: string, body?: unknown) =>
          fetch(`${base}/api/workspaces/${workspaceId}${path}`, {
            method: body ? "POST" : "GET",
            headers: { cookie, origin, "content-type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
        const json = async (path: string, body?: unknown) => {
          const response = await request(path, body);
          expect(response.status, await response.clone().text()).toBe(200);
          return response.json();
        };
        const subscriptionId = await inWorkspace(
          database.db,
          workspaceId,
          { userId },
          controlledSubscription,
        );
        const agent = z.object({ agent: z.object({ id: z.uuid() }) }).parse(
          await json("/agents", {
            title: "Offline compute",
            instructions: "Only controlled fixture computation",
            model: "fixture",
            subscriptionId,
            visibility: "workspace",
          }),
        ).agent;
        const chat = z.object({ id: z.uuid() }).parse(
          await json("/chats", {
            title: "Computed output",
            visibility: "workspace",
          }),
        );
        await json(`/chats/${chat.id}/participants`, {
          agentId: agent.id,
          role: "contributor",
        });
        const run = z.object({ id: z.uuid() }).parse(
          await json("/runs", {
            agentId: agent.id,
            chatId: chat.id,
            type: "prompt",
            body: "Compute six times seven, save the result and attach it here.",
            requestId: crypto.randomUUID(),
          }),
        );
        await expect
          .poll(
            async () =>
              (
                await database.db.select().from(runs).where(eq(runs.id, run.id))
              )[0]?.state,
            { timeout: 15000 },
          )
          .toBe("finished");
        expect(computed).toBe(true);
        expect(fileInput.text).toBe("42");
        expect(createdFile).not.toBe("");
        expect(createdMessage).not.toBe("");
        expect(await (await request(`/files/${createdFile}/file`)).text()).toBe(
          "42",
        );
        expect(await json(`/files/${createdFile}`)).toMatchObject({
          sourceRunId: run.id,
          creatorAgentId: agent.id,
        });
        const loaded = await json(`/chats/${chat.id}/messages`);
        expect(JSON.stringify(loaded)).toContain(createdFile);
        expect(
          JSON.stringify(await json(`/chats/${chat.id}/messages`)),
        ).toContain(createdMessage);
        mode = "hold";
        for (const fence of ["participant", "generation", "attempt"] as const) {
          const worker = z.object({ agent: z.object({ id: z.uuid() }) }).parse(
            await json("/agents", {
              title: `Fence ${fence}`,
              instructions: "Controlled fence",
              model: "fixture",
              subscriptionId,
              visibility: "workspace",
            }),
          ).agent;
          await json(`/chats/${chat.id}/participants`, {
            agentId: worker.id,
            role: "contributor",
          });
          const participant = z
            .object({
              items: z.array(
                z.object({ id: z.uuid(), agentId: z.uuid().nullable() }),
              ),
            })
            .parse(await json(`/chats/${chat.id}/participants`))
            .items.find((item) => item.agentId === worker.id);
          if (!participant) throw new Error("Missing fixture participant");
          const held = z.object({ id: z.uuid() }).parse(
            await json("/runs", {
              agentId: worker.id,
              chatId: chat.id,
              type: "prompt",
              body: "Hold the confined computation",
              requestId: crypto.randomUUID(),
            }),
          );
          await expect
            .poll(
              async () =>
                (await ownedContainers(computerConfig.ownerId)).some(
                  (container) => container.State === "running",
                ),
              { timeout: 10000 },
            )
            .toBe(true);
          if (fence === "participant") {
            const removed = await fetch(
              `${base}/api/workspaces/${workspaceId}/chats/${chat.id}/participants/${participant.id}`,
              {
                method: "DELETE",
                headers: { cookie, origin },
              },
            );
            expect(removed.status).toBe(200);
          } else if (fence === "generation") {
            await database.db
              .update(environments)
              .set({ generation: 1 })
              .where(eq(environments.agentId, worker.id));
          } else {
            await database.db
              .update(runs)
              .set({ attempt: 2 })
              .where(eq(runs.id, held.id));
          }
          await expect
            .poll(
              async () =>
                (await ownedContainers(computerConfig.ownerId)).length,
              { timeout: 10000 },
            )
            .toBe(0);
          const current = (
            await database.db.select().from(runs).where(eq(runs.id, held.id))
          )[0];
          if (fence === "attempt")
            expect(current).toMatchObject({ attempt: 2, state: "running" });
          else
            await expect
              .poll(
                async () =>
                  (
                    await database.db
                      .select()
                      .from(runs)
                      .where(eq(runs.id, held.id))
                  )[0]?.state,
              )
              .toBe("interrupted");
        }
        mode = "cleanup-failure";
        proxy.state.denyDelete = true;
        const uncertain = z.object({ id: z.uuid() }).parse(
          await json("/runs", {
            agentId: agent.id,
            chatId: chat.id,
            type: "prompt",
            body: "Exercise unconfirmed cleanup",
            requestId: crypto.randomUUID(),
          }),
        );
        await expect
          .poll(
            async () =>
              (
                await database.db
                  .select()
                  .from(runs)
                  .where(eq(runs.id, uncertain.id))
              )[0]?.state,
            { timeout: 10000 },
          )
          .toBe("uncertain");
        const starts = modelStarts;
        const blocked = z.object({ id: z.uuid() }).parse(
          await json("/runs", {
            agentId: agent.id,
            chatId: chat.id,
            type: "prompt",
            body: "Must not reuse an uncertain computer owner",
            requestId: crypto.randomUUID(),
          }),
        );
        await Bun.sleep(1000);
        expect(modelStarts).toBe(starts);
        expect(
          (
            await database.db.select().from(runs).where(eq(runs.id, blocked.id))
          )[0]?.state,
        ).toBe("queued");
      } finally {
        proxy.state.denyDelete = false;
        await server?.stop();
        for (const container of await ownedContainers(computerConfig.ownerId))
          await fetch(`http://docker/containers/${container.Id}?force=true`, {
            unix: socketPath,
            method: "DELETE",
          });
        await proxy.close();
        await s3.stop();
        await database.stop();
        await rm(spool, { recursive: true, force: true });
      }
    });
  },
);
