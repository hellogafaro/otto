import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "../../apps/server/src/auth";
import { startQueue } from "../../apps/server/src/queue";
import { claimInstallation } from "../../packages/workspaces/src";
import { members } from "../../packages/workspaces/src/schema";
import type { startPostgres } from "../postgres";
import { startS3Peer } from "./s3-peer";
import { openSpoolFds } from "./storage";

const root = new URL("../../", import.meta.url).pathname;

/** Deterministic large body: bounded memory, incrementally hashed, 1 MiB chunks. */
export function patternBody(bytes: number, seed = 1) {
  const block = new Uint8Array(1024 * 1024);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < block.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    block[i] = state >>> 24;
  }
  const hash = createHash("sha256");
  let sent = 0;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const size = Math.min(block.length, bytes - sent);
      const chunk = block.slice(0, size);
      new DataView(chunk.buffer).setUint32(0, index++);
      hash.update(chunk);
      sent += size;
      controller.enqueue(chunk);
    },
  });
  return { stream, digest: () => hash.copy().digest("hex") };
}
/** Expected digest of `patternBody` without sending it. */
export async function patternDigest(bytes: number, seed = 1) {
  const body = patternBody(bytes, seed);
  const reader = body.stream.getReader();
  while (!(await reader.read()).done);
  return body.digest();
}

/**
 * The real server entry (`apps/server/src/index.ts`) in its own process, against a private PostgreSQL and a
 * controlled S3-compatible HTTP peer reached through the real AWS adapter. Session cookies come from a
 * same-secret in-process Auth because production sign-up is disabled without mail.
 */
export async function startServerProcess(
  database: Awaited<ReturnType<typeof startPostgres>>,
  options: { spoolBytes?: number; env?: Record<string, string> } = {},
) {
  const peer = await startS3Peer();
  const spoolBase = await mkdtemp(join(tmpdir(), "otto-spool-test-"));
  const queue = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  await queue.stop();
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port as number;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const child = Bun.spawn([process.execPath, "apps/server/src/index.ts"], {
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      PATH: process.env.PATH,
      HOST: "127.0.0.1",
      PORT: String(port),
      OTTO_ORIGIN: origin,
      DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
      BETTER_AUTH_SECRET: secret,
      S3_ENDPOINT: peer.endpoint,
      S3_BUCKET: peer.bucket,
      S3_ACCESS_KEY_ID: "fixture-access",
      S3_SECRET_ACCESS_KEY: "fixture-secret-fixture-secret",
      UPLOAD_SPOOL_DIR: spoolBase,
      UPLOAD_SPOOL_BYTES: String(options.spoolBytes ?? 500_000_000),
      ...options.env,
    },
  });
  for (let attempt = 0; ; attempt++) {
    if ((await fetch(`${origin}/ready`).catch(() => null))?.status === 200)
      break;
    if (attempt > 200) throw new Error("Server process did not become ready");
    await Bun.sleep(100);
  }
  const auth = createAuth(database.db, secret, origin);
  async function human(label: string) {
    const response = await auth.api.signUpEmail({
      body: {
        name: label,
        email: `${label}-${crypto.randomUUID()}@example.test`,
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      asResponse: true,
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing session");
    return { id: session.user.id, cookie };
  }
  const owner = await human("owner");
  const workspaceId = (
    await claimInstallation(database.db, owner.id, "Transfers")
  ).id;
  async function member(label: string, role: "contributor" | "viewer") {
    const user = await human(label);
    await database.db
      .insert(members)
      .values({ workspaceId, userId: user.id, role });
    return user;
  }
  const request = (
    who: { cookie: string } | null,
    path: string,
    init: RequestInit & { duplex?: "half" } = {},
  ) =>
    fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      ...init,
      headers: {
        ...(who ? { cookie: who.cookie } : {}),
        origin,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const json = (
    who: { cookie: string },
    path: string,
    method: string,
    body?: unknown,
  ) =>
    request(who, path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const upload = (
    who: { cookie: string } | null,
    requestId: string,
    body: BodyInit | null,
    options: {
      length?: number;
      query?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const query = new URLSearchParams({
      title: "Upload",
      type: "binary",
      mediaType: "application/octet-stream",
      visibility: "workspace",
      ...options.query,
    });
    return request(who, `/files/${requestId}/content?${query}`, {
      method: "PUT",
      body,
      duplex: "half",
      headers: {
        "content-type": "application/octet-stream",
        ...(options.length === undefined
          ? {}
          : { "content-length": String(options.length) }),
        ...options.headers,
      },
    });
  };
  /** Peak and current resident memory of the server process (kB) from the kernel. */
  const memory = () => {
    const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
    const pick = (name: string) =>
      Number(new RegExp(`${name}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
    return { peakKb: pick("VmHWM"), currentKb: pick("VmRSS") };
  };
  /** Files currently held by this server instance's private spool. */
  const spoolEntries = async () => {
    const instances = (await readdir(spoolBase)).filter((n) =>
      n.startsWith("inst-"),
    );
    const out: string[] = [];
    for (const instance of instances)
      for (const name of await readdir(join(spoolBase, instance)))
        if (name.endsWith(".part")) out.push(name);
    return out;
  };
  async function stop() {
    child.kill("SIGTERM");
    await Promise.race([child.exited, Bun.sleep(8000)]);
    child.kill("SIGKILL");
    await peer.stop();
    await rm(spoolBase, { recursive: true, force: true });
  }
  return {
    origin,
    port,
    pid: child.pid,
    workspaceId,
    owner,
    member,
    peer,
    request,
    json,
    upload,
    memory,
    spoolEntries,
    /** Descriptors the server process still holds on its spool, including deleted files. */
    spoolFds: () => openSpoolFds(spoolBase, child.pid),
    spoolBase,
    stop,
    exited: child.exited,
  };
}

/**
 * Hand-written HTTP/1.1 exchange for cases a client library refuses to produce: a body that is shorter than
 * its declared Content-Length, a body never sent, or a connection dropped mid-body.
 */
export async function rawUpload(
  server: { port: number; origin: string; workspaceId: string },
  options: {
    cookie?: string;
    origin?: string;
    requestId: string;
    query?: string;
    declared: number;
    send?: Uint8Array;
    /** "close" ends the socket after sending; "idle" leaves it open (waiting for the server to answer). */
    after: "close" | "idle";
    waitMs?: number;
  },
) {
  const head = [
    `PUT /api/workspaces/${server.workspaceId}/files/${options.requestId}/content?${options.query ?? "title=Raw&type=binary&mediaType=application/octet-stream&visibility=workspace"} HTTP/1.1`,
    `Host: 127.0.0.1:${server.port}`,
    ...(options.cookie ? [`Cookie: ${options.cookie}`] : []),
    `Origin: ${options.origin ?? server.origin}`,
    "Content-Type: application/octet-stream",
    `Content-Length: ${options.declared}`,
    "",
    "",
  ].join("\r\n");
  let received = "";
  let closed = false;
  const started = performance.now();
  let answeredAt: number | undefined;
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data(_socket, data) {
        received += Buffer.from(data).toString("latin1");
        answeredAt ??= performance.now();
      },
      close() {
        closed = true;
      },
      open() {},
      error() {},
    },
  });
  socket.write(head);
  if (options.send) socket.write(options.send);
  if (options.after === "close") socket.end();
  const deadline = Date.now() + (options.waitMs ?? 3000);
  while (!closed && answeredAt === undefined && Date.now() < deadline)
    await Bun.sleep(20);
  socket.terminate();
  const status = /^HTTP\/1\.1 (\d+)/.exec(received)?.[1];
  return {
    status: status ? Number(status) : null,
    answeredMs: answeredAt === undefined ? null : answeredAt - started,
    closed,
  };
}
