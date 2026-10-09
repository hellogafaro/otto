import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiveToFile } from "../apps/server/src/spool";
import {
  patternBody,
  rawUpload,
  startServerProcess,
} from "./fixtures/server-process";
import { startPostgres } from "./postgres";

const MB = 1_000_000;
const MAX = 100 * MB;
const record = (name: string, value: unknown) => {
  if (process.env.OTTO_UPLOAD_EVIDENCE)
    appendFileSync(
      process.env.OTTO_UPLOAD_EVIDENCE,
      `${JSON.stringify({ name, ...(value as object) })}\n`,
    );
};

describe("binary upload and verified download through the real server entry, AWS adapter and S3-compatible peer", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServerProcess>>;
  let contributor: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  beforeAll(async () => {
    database = await startPostgres();
    server = await startServerProcess(database);
    contributor = await server.member("contributor", "contributor");
    viewer = await server.member("viewer", "viewer");
    record("idle server", server.memory());
  }, 90000);
  afterAll(async () => {
    await server?.stop();
    await database?.stop();
  });
  const rows = async (table = "files") =>
    (await database.pool.query(`select count(*)::int as n from ${table}`))
      .rows[0]?.n as number;
  async function digestOf(response: Response) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      size += chunk.byteLength;
    }
    return { size, sha256: hash.digest("hex") };
  }
  async function put(bytes: number, seed = 1, headers = true) {
    const body = patternBody(bytes, seed);
    const requestId = crypto.randomUUID();
    const response = await server.upload(server.owner, requestId, body.stream, {
      ...(headers ? { length: bytes } : {}),
    });
    // Every caller expects success; fail here with the server's answer rather than later on a missing id.
    expect(response.status, await response.clone().text()).toBe(200);
    return { requestId, response, digest: body.digest() };
  }
  const idle = async () => {
    for (let i = 0; i < 50 && (await server.spoolEntries()).length; i++)
      await Bun.sleep(100);
    return server.spoolEntries();
  };

  for (const size of [50, 100]) {
    it(`round-trips ${size} MB with bounded server memory, one storage put and a clean spool`, async () => {
      const objectsBefore = server.peer.objects.size;
      const putsBefore = server.peer.stats.puts;
      const started = performance.now();
      const { response, digest } = await put(size * MB);
      const text = await response.text();
      expect(response.status, text).toBe(200);
      const uploadMs = Math.round(performance.now() - started);
      const saved = JSON.parse(text);
      expect(saved).toMatchObject({
        byteLength: size * MB,
        sha256: digest,
        visibility: "workspace",
        folderId: null,
      });
      expect(server.peer.stats.puts - putsBefore).toBe(1);
      expect(server.peer.objects.size - objectsBefore).toBe(1);
      const downloadStart = performance.now();
      const download = await server.request(
        server.owner,
        `/files/${saved.id}/file`,
      );
      expect(download.status).toBe(200);
      expect(await digestOf(download)).toEqual({
        size: size * MB,
        sha256: digest,
      });
      const downloadMs = Math.round(performance.now() - downloadStart);
      const memory = server.memory();
      record(`${size}MB roundtrip`, { uploadMs, downloadMs, ...memory });
      // Fixture scope: peak resident memory of the server process stays far below the transferred size.
      expect(memory.peakKb).toBeLessThan(300_000);
      expect(await idle()).toEqual([]);
    }, 180000);
  }

  it("refuses 100 MB + 1 by header and by chunked stream with no object, row or spool left", async () => {
    const files = await rows();
    const objects = server.peer.objects.size;
    // fetch cannot declare a length it does not send, so the declared-size refusal uses a raw request.
    const declared = await rawUpload(server, {
      cookie: server.owner.cookie,
      requestId: crypto.randomUUID(),
      declared: MAX + 1,
      after: "idle",
    });
    expect(declared.status).toBe(413);
    expect(declared.answeredMs ?? 99999).toBeLessThan(2500);
    const overrun = patternBody(MAX + 1);
    const chunked = await server.upload(
      server.owner,
      crypto.randomUUID(),
      overrun.stream,
    );
    expect(chunked.status).toBe(413);
    expect(await rows()).toBe(files);
    expect(server.peer.objects.size).toBe(objects);
    expect(await idle()).toEqual([]);
  }, 120000);

  it("accepts a chunked upload with no Content-Length and rejects a lying or abandoned body", async () => {
    const chunked = await put(5 * MB, 7, false);
    expect(chunked.response.status).toBe(200);
    expect((await chunked.response.json()).sha256).toBe(chunked.digest);
    const files = await rows();
    // Declared 10 MB but only 1 MB sent, then the connection ends.
    const short = await rawUpload(server, {
      cookie: server.owner.cookie,
      requestId: crypto.randomUUID(),
      declared: 10 * MB,
      send: new Uint8Array(MB),
      after: "close",
    });
    expect([null, 400]).toContain(short.status);
    // Mid-body disconnect.
    await rawUpload(server, {
      cookie: server.owner.cookie,
      requestId: crypto.randomUUID(),
      declared: 50 * MB,
      send: new Uint8Array(10 * MB),
      after: "close",
    });
    await Bun.sleep(500);
    expect(await rows()).toBe(files);
    expect(await idle()).toEqual([]);
  }, 60000);

  it("denies before reading the body: unauthenticated, foreign origin, viewer and non-member", async () => {
    const outsider = await server.member("outsider", "contributor");
    await database.pool.query(
      'delete from workspace_members where "userId"=$1',
      [outsider.id],
    );
    for (const [label, options, status] of [
      ["unauthenticated", {}, 401],
      [
        "foreign origin",
        { cookie: server.owner.cookie, origin: "http://evil.example" },
        403,
      ],
      ["viewer", { cookie: viewer.cookie }, 403],
      ["non-member", { cookie: outsider.cookie }, 403],
      [
        "invalid metadata",
        { cookie: server.owner.cookie, query: "title=&type=x&mediaType=x" },
        400,
      ],
      [
        "unknown folder",
        {
          cookie: server.owner.cookie,
          query: `title=T&type=x&mediaType=x&folderId=${crypto.randomUUID()}`,
        },
        404,
      ],
    ] as const) {
      // A body of 100 MB is declared but never sent: the answer must not wait for it.
      const result = await rawUpload(server, {
        requestId: crypto.randomUUID(),
        declared: MAX,
        after: "idle",
        ...options,
      });
      expect(result.status, label).toBe(status);
      expect(result.answeredMs ?? 99999, label).toBeLessThan(2500);
    }
    expect(await idle()).toEqual([]);
  }, 60000);

  it("retries exactly: same File, one put; changed bytes or metadata conflict; concurrent retries converge", async () => {
    const first = await put(8 * MB, 11);
    const saved = await first.response.json();
    const puts = server.peer.stats.puts;
    const again = await server.upload(
      server.owner,
      first.requestId,
      patternBody(8 * MB, 11).stream,
      { length: 8 * MB },
    );
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(saved.id);
    expect(server.peer.stats.puts).toBe(puts);
    const changedBytes = await server.upload(
      server.owner,
      first.requestId,
      patternBody(8 * MB, 12).stream,
      { length: 8 * MB },
    );
    expect(changedBytes.status).toBe(409);
    const changedLength = await server.upload(
      server.owner,
      first.requestId,
      patternBody(9 * MB, 11).stream,
      { length: 9 * MB },
    );
    expect(changedLength.status).toBe(409);
    const changedMetadata = await server.upload(
      server.owner,
      first.requestId,
      patternBody(8 * MB, 11).stream,
      { length: 8 * MB, query: { title: "Different" } },
    );
    expect(changedMetadata.status).toBe(409);
    expect(server.peer.stats.puts).toBe(puts);
    const requestId = crypto.randomUUID();
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        server.upload(server.owner, requestId, patternBody(6 * MB, 21).stream, {
          length: 6 * MB,
        }),
      ),
    );
    if (!a || !b) throw new Error("Missing responses");
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(
      (
        await database.pool.query(
          'select count(*)::int n from files where "requestId"=$1',
          [requestId],
        )
      ).rows[0]?.n,
    ).toBe(1);
  }, 120000);

  it("keeps an honest pending intent through storage failure and a lost acknowledgement, then resumes on retry", async () => {
    const list = async () =>
      (
        (await (await server.request(server.owner, "/files?limit=100")).json())
          .items as { title: string }[]
      ).filter((item) => item.title === "Resilient").length;
    for (const failure of ["failPuts", "losePutAck"] as const) {
      const requestId = crypto.randomUUID();
      const objects = server.peer.objects.size;
      if (failure === "failPuts") server.peer.behavior.failPuts = 1;
      else server.peer.behavior.losePutAck = true;
      const bytes = 3 * MB;
      const query = { title: "Resilient" };
      const failed = await server.upload(
        server.owner,
        requestId,
        patternBody(bytes, 31).stream,
        { length: bytes, query },
      );
      expect(failed.status, failure).toBeGreaterThanOrEqual(500);
      const before = await list();
      const pending = (
        await database.pool.query(
          'select state from files where "requestId"=$1',
          [requestId],
        )
      ).rows;
      expect(pending, failure).toEqual([{ state: "pending" }]);
      const retried = await server.upload(
        server.owner,
        requestId,
        patternBody(bytes, 31).stream,
        { length: bytes, query },
      );
      expect(retried.status, failure).toBe(200);
      expect(await list(), failure).toBe(before + 1);
      // One immutable object per accepted request, even after the acknowledgement was lost.
      expect(server.peer.objects.size - objects, failure).toBe(1);
      expect(await idle()).toEqual([]);
    }
  }, 60000);

  it("never discloses unverified bytes: a corrupt or truncated store yields no body at all", async () => {
    const { response } = await put(12 * MB, 41);
    const saved = await response.json();
    for (const mode of ["corruptGet", "truncateGet"] as const) {
      server.peer.behavior[mode] = true;
      const download = await server.request(
        server.owner,
        `/files/${saved.id}/file`,
      );
      server.peer.behavior[mode] = false;
      expect(download.status, mode).not.toBe(200);
      expect(download.headers.get("connection"), mode).toBe("close");
      expect((await download.arrayBuffer()).byteLength, mode).toBeLessThan(200);
    }
    expect(await idle()).toEqual([]);
    const healthy = await server.request(
      server.owner,
      `/files/${saved.id}/file`,
    );
    expect(healthy.status).toBe(200);
    expect((await digestOf(healthy)).size).toBe(12 * MB);
  }, 60000);

  it("re-checks authority after storage I/O and during delivery", async () => {
    const { response } = await put(24 * MB, 51);
    const saved = await response.json();
    // Visible to the contributor first.
    expect(
      (await server.request(contributor, `/files/${saved.id}/file`)).status,
    ).toBe(200);
    // Revocation committed while the storage read is pending.
    server.peer.behavior.beforeGet = async () => {
      server.peer.behavior.beforeGet = undefined;
      await server.json(server.owner, `/files/${saved.id}`, "PATCH", {
        visibility: "user",
      });
    };
    const racing = await server.request(contributor, `/files/${saved.id}/file`);
    expect(racing.status).toBe(403);
    expect((await racing.text()).includes("sha")).toBe(false);
    await server.json(server.owner, `/files/${saved.id}`, "PATCH", {
      visibility: "workspace",
    });
    // Revocation after verification, while the response is being delivered slowly.
    const delivery = await server.request(
      contributor,
      `/files/${saved.id}/file`,
    );
    expect(delivery.status).toBe(200);
    const reader = (delivery.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await server.json(server.owner, `/files/${saved.id}`, "PATCH", {
      visibility: "user",
    });
    await Bun.sleep(5500);
    let failed = false;
    let received = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
      }
    } catch {
      failed = true;
    }
    expect(failed || received < 24 * MB).toBe(true);
    expect(await idle()).toEqual([]);
  }, 90000);

  it("releases the disk lease when the client abandons a download", async () => {
    const { response } = await put(40 * MB, 61);
    const saved = await response.json();
    const delivery = await server.request(
      server.owner,
      `/files/${saved.id}/file`,
    );
    expect(delivery.status).toBe(200);
    const reader = (delivery.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    expect((await server.spoolEntries()).length).toBe(1);
    await reader.cancel();
    expect(await idle()).toEqual([]);
  }, 60000);

  it("serves unrelated requests and stays within memory bounds during simultaneous large transfers", async () => {
    const seeded = await put(60 * MB, 71);
    const seededFile = await seeded.response.json();
    const slowest = { value: 0 };
    let running = true;
    const probe = (async () => {
      while (running) {
        const started = performance.now();
        const ready = await fetch(`${server.origin}/ready`);
        const listing = await server.request(server.owner, "/files?limit=5");
        expect(ready.status).toBe(200);
        expect(listing.status).toBe(200);
        slowest.value = Math.max(slowest.value, performance.now() - started);
        await Bun.sleep(25);
      }
    })();
    const [upload, download] = await Promise.all([
      put(80 * MB, 72),
      server
        .request(server.owner, `/files/${seededFile.id}/file`)
        .then(digestOf),
    ]);
    running = false;
    await probe;
    expect(upload.response.status).toBe(200);
    expect(download.size).toBe(60 * MB);
    const memory = server.memory();
    record("simultaneous 80MB upload + 60MB download", {
      slowestUnrelatedMs: Math.round(slowest.value),
      ...memory,
    });
    expect(slowest.value).toBeLessThan(1500);
    expect(memory.peakKb).toBeLessThan(300_000);
  }, 120000);

  it("keeps large files out of small consumers and streams public frozen downloads with revocation checks", async () => {
    const bytes = 12 * MB;
    const body = patternBody(bytes, 81);
    const upload = await server.upload(
      server.owner,
      crypto.randomUUID(),
      body.stream,
      {
        length: bytes,
        query: { mediaType: "text/html", visibility: "workspace" },
      },
    );
    const saved = await upload.json();
    // The 8 MiB bound for Skill materialization applies regardless of the 100 MB storage maximum.
    const skill = await (
      await server.json(server.owner, "/skills", "POST", {
        title: "large-file-skill",
        instructions: "x",
        whenToUse: "never",
        visibility: "workspace",
      })
    ).json();
    expect(
      (
        await server.json(server.owner, `/skills/${skill.id}/files`, "PUT", {
          editToken: 0,
          files: [{ path: "assets/large.bin", fileId: saved.id }],
        })
      ).status,
    ).toBe(400);
    const publish = async () => {
      const share = await (
        await server.json(server.owner, "/shares/preview", "POST", {
          selection: { type: "file", targetId: saved.id, includeFile: true },
        })
      ).json();
      expect(
        (
          await server.json(
            server.owner,
            `/shares/${share.id}/publish`,
            "POST",
            {
              editToken: share.editToken,
            },
          )
        ).status,
      ).toBe(200);
      return share.id as string;
    };
    const shareId = await publish();
    // The sandboxed HTML preview is a bounded in-memory consumer: too large is refused, not buffered.
    expect(
      (await fetch(`${server.origin}/api/shares/${shareId}/preview`)).status,
    ).toBe(400);
    const frozen = await fetch(`${server.origin}/api/shares/${shareId}/file`);
    expect(frozen.status).toBe(200);
    expect(await digestOf(frozen)).toEqual({
      size: bytes,
      sha256: body.digest(),
    });
    // Revocation committed while the storage read is pending closes the public download.
    server.peer.behavior.beforeGet = async () => {
      server.peer.behavior.beforeGet = undefined;
      await server.json(server.owner, `/shares/${shareId}/revoke`, "POST", {});
    };
    const revoked = await fetch(`${server.origin}/api/shares/${shareId}/file`);
    expect(revoked.status).toBe(404);
    expect((await fetch(`${server.origin}/api/shares/${shareId}`)).status).toBe(
      404,
    );
    expect(await idle()).toEqual([]);
  }, 90000);

  it("answers HEAD with authorized metadata only: no storage read, spool, lease or leaked descriptor", async () => {
    const bytes = 30 * MB;
    const { response } = await put(bytes, 91);
    const saved = await response.json();
    const share = await (
      await server.json(server.owner, "/shares/preview", "POST", {
        selection: { type: "file", targetId: saved.id, includeFile: true },
      })
    ).json();
    await server.json(server.owner, `/shares/${share.id}/publish`, "POST", {
      editToken: share.editToken,
    });
    const gets = server.peer.stats.gets;
    for (const url of [
      `${server.origin}/api/shares/${share.id}/file`,
      `${server.origin}/api/shares/${share.id}/file`,
      `${server.origin}/api/shares/${share.id}/file`,
      `${server.origin}/api/shares/${share.id}/file`,
      `${server.origin}/api/shares/${share.id}/file`,
    ]) {
      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("x-file-size")).toBe(String(bytes));
      expect(head.headers.get("content-type")).toBe("application/octet-stream");
      expect(await head.text()).toBe("");
    }
    const own = await server.request(server.owner, `/files/${saved.id}/file`, {
      method: "HEAD",
    });
    expect(own.status).toBe(200);
    expect(own.headers.get("x-file-size")).toBe(String(bytes));
    expect(server.peer.stats.gets).toBe(gets);
    expect(await server.spoolEntries()).toEqual([]);
    expect(server.spoolFds()).toEqual([]);
    // Missing and revoked targets answer like GET would, and the full budget is still usable.
    expect(
      (
        await fetch(`${server.origin}/api/shares/${crypto.randomUUID()}/file`, {
          method: "HEAD",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await server.request(contributor, `/files/${saved.id}/file`, {
          method: "HEAD",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await digestOf(
          await server.request(server.owner, `/files/${saved.id}/file`),
        )
      ).size,
    ).toBe(bytes);
  }, 90000);

  it("leaks no descriptor or spool file when storage fails, resets or the SDK errors", async () => {
    for (let i = 0; i < 6; i++) {
      server.peer.behavior.failPuts = 1;
      const failed = await server.upload(
        server.owner,
        crypto.randomUUID(),
        patternBody(3 * MB, 100 + i).stream,
        {
          length: 3 * MB,
        },
      );
      expect(failed.status).toBeGreaterThanOrEqual(500);
    }
    for (let i = 0; i < 4; i++) {
      server.peer.behavior.dropPuts = 1;
      const dropped = await server.upload(
        server.owner,
        crypto.randomUUID(),
        patternBody(3 * MB, 200 + i).stream,
        {
          length: 3 * MB,
        },
      );
      expect(dropped.status).toBeGreaterThanOrEqual(500);
    }
    expect(await idle()).toEqual([]);
    expect(server.spoolFds()).toEqual([]);
  }, 60000);

  it("verifies stored bytes, never metadata: silent corruption and a lost acknowledgement over it are never published", async () => {
    const bytes = 5 * MB;
    const requestId = crypto.randomUUID();
    const query = { title: "Corrupt candidate" };
    server.peer.behavior.corruptStoredPut = true;
    const corrupt = await server.upload(
      server.owner,
      requestId,
      patternBody(bytes, 301).stream,
      { length: bytes, query },
    );
    expect(corrupt.status).toBeGreaterThanOrEqual(500);
    const state = async (id: string) =>
      (
        await database.pool.query(
          'select state from files where "requestId"=$1',
          [id],
        )
      ).rows;
    expect(await state(requestId)).toEqual([{ state: "pending" }]);
    // Reconciling the same request later reads the stored object back and still refuses it.
    const retried = await server.upload(
      server.owner,
      requestId,
      patternBody(bytes, 301).stream,
      { length: bytes, query },
    );
    expect(retried.status).toBeGreaterThanOrEqual(500);
    expect(await state(requestId)).toEqual([{ state: "pending" }]);
    // The same with a lost acknowledgement over a corrupt object.
    const lost = crypto.randomUUID();
    server.peer.behavior.corruptStoredPut = true;
    server.peer.behavior.losePutAck = true;
    const first = await server.upload(
      server.owner,
      lost,
      patternBody(bytes, 302).stream,
      { length: bytes, query },
    );
    expect(first.status).toBeGreaterThanOrEqual(500);
    const second = await server.upload(
      server.owner,
      lost,
      patternBody(bytes, 302).stream,
      { length: bytes, query },
    );
    expect(second.status).toBeGreaterThanOrEqual(500);
    expect(await state(lost)).toEqual([{ state: "pending" }]);
    const listed = await (
      await server.request(server.owner, "/files?limit=100")
    ).json();
    expect(
      listed.items.some(
        (item: { title: string }) => item.title === "Corrupt candidate",
      ),
    ).toBe(false);
    // Healthy requests are unaffected.
    expect((await put(bytes, 303)).response.status).toBe(200);
    expect(await idle()).toEqual([]);
    expect(server.spoolFds()).toEqual([]);
  }, 90000);

  it("finishes a download whose storage verification outlasts Bun's 30 second idle timeout, then closes the connection", async () => {
    const bytes = 8 * MB;
    const { response, digest } = await put(bytes, 401);
    const saved = await response.json();
    server.peer.behavior.chunkDelayMs = 1150; // 32 chunks of 256 KiB, about 37 s before the first byte
    const started = performance.now();
    // Raw socket, keep-alive request: nothing may cut it before the first byte, and the connection must end with it.
    let firstByte = -1;
    let closed = -1;
    let received = 0;
    let status = "";
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(_s, data) {
          if (firstByte < 0) firstByte = performance.now() - started;
          status ||=
            /^HTTP\/1\.1 (\d+)/.exec(
              Buffer.from(data).toString("latin1"),
            )?.[1] ?? "";
          received += data.byteLength;
        },
        close() {
          closed = performance.now() - started;
        },
        open() {},
        error() {},
      },
    });
    socket.write(
      `GET /api/workspaces/${server.workspaceId}/files/${saved.id}/file HTTP/1.1\r\nHost: x\r\nCookie: ${server.owner.cookie}\r\nOrigin: ${server.origin}\r\n\r\n`,
    );
    while (closed < 0 && performance.now() - started < 80000)
      await Bun.sleep(250);
    server.peer.behavior.chunkDelayMs = 0;
    socket.terminate();
    expect(status).toBe("200");
    expect(firstByte).toBeGreaterThan(30000);
    expect(received).toBeGreaterThan(bytes);
    expect(closed).toBeGreaterThan(firstByte);
    record("slow storage verification", {
      firstByteAfterMs: Math.round(firstByte),
      closedAfterMs: Math.round(closed),
    });
    // The same read through a client library is digest-exact.
    const again = await server.request(server.owner, `/files/${saved.id}/file`);
    expect(await digestOf(again)).toEqual({ size: bytes, sha256: digest });
    expect(await idle()).toEqual([]);
  }, 140000);

  it("anonymous HEADs of 100 MB cannot hold the budget, and revocation discloses a bounded number of bytes", async () => {
    const bytes = 100 * MB;
    const { response, digest } = await put(bytes, 501);
    const saved = await response.json();
    const share = await (
      await server.json(server.owner, "/shares/preview", "POST", {
        selection: { type: "file", targetId: saved.id, includeFile: true },
      })
    ).json();
    await server.json(server.owner, `/shares/${share.id}/publish`, "POST", {
      editToken: share.editToken,
    });
    for (let i = 0; i < 6; i++)
      expect(
        (
          await fetch(`${server.origin}/api/shares/${share.id}/file`, {
            method: "HEAD",
          })
        ).status,
      ).toBe(200);
    expect(await server.spoolEntries()).toEqual([]);
    // Everything still works at full size right away.
    expect(
      await digestOf(
        await server.request(server.owner, `/files/${saved.id}/file`),
      ),
    ).toEqual({ size: bytes, sha256: digest });
    // Revocation during a fast delivery: count the bytes that still arrive after it is committed.
    const delivery = await server.request(
      contributor,
      `/files/${saved.id}/file`,
    );
    expect(delivery.status).toBe(200);
    const reader = (delivery.body as ReadableStream<Uint8Array>).getReader();
    let received = 0;
    let revokedAt = -1;
    let failed = false;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        if (revokedAt < 0 && received >= 8 * MB) {
          await server.json(server.owner, `/files/${saved.id}`, "PATCH", {
            visibility: "user",
          });
          revokedAt = received;
        }
      }
    } catch {
      failed = true;
    }
    await server.json(server.owner, `/files/${saved.id}`, "PATCH", {
      visibility: "workspace",
    });
    expect(failed).toBe(true);
    const after = received - revokedAt;
    record("revocation disclosure", {
      revokedAtBytes: revokedAt,
      bytesAfterRevocation: after,
    });
    // Bounded by the 4 MiB / 2 s re-check interval plus socket buffers; far below the file size.
    expect(after).toBeLessThan(24 * MB);
    expect(await idle()).toEqual([]);
    expect(server.spoolFds()).toEqual([]);
  }, 120000);

  it("verifies a client-asserted digest without trusting it, and closes a share republished during delivery setup", async () => {
    const bytes = 4 * MB;
    const body = patternBody(bytes, 701);
    const wrong = await server.upload(
      server.owner,
      crypto.randomUUID(),
      body.stream,
      {
        length: bytes,
        headers: { "x-content-sha256": "0".repeat(64) },
      },
    );
    expect(wrong.status).toBe(400);
    expect(await idle()).toEqual([]);
    // The true digest of the same pattern, computed up front.
    const expected = await (async () => {
      const probe = patternBody(bytes, 701);
      const reader = probe.stream.getReader();
      while (!(await reader.read()).done);
      return probe.digest();
    })();
    const ok = await server.upload(
      server.owner,
      crypto.randomUUID(),
      patternBody(bytes, 701).stream,
      {
        length: bytes,
        headers: { "x-content-sha256": expected },
      },
    );
    expect(ok.status).toBe(200);
    const saved = await ok.json();
    const selection = { type: "file", targetId: saved.id, includeFile: true };
    const share = await (
      await server.json(server.owner, "/shares/preview", "POST", { selection })
    ).json();
    const published = await (
      await server.json(server.owner, `/shares/${share.id}/publish`, "POST", {
        editToken: share.editToken,
      })
    ).json();
    // Re-previewing and publishing again changes the share's edit token while storage is being read.
    server.peer.behavior.beforeGet = async () => {
      server.peer.behavior.beforeGet = undefined;
      const again = await (
        await server.json(server.owner, "/shares/preview", "POST", {
          selection,
          existing: { id: share.id, editToken: published.editToken },
        })
      ).json();
      await server.json(server.owner, `/shares/${share.id}/publish`, "POST", {
        editToken: again.editToken,
      });
    };
    const racing = await fetch(`${server.origin}/api/shares/${share.id}/file`);
    expect(racing.status).toBe(404);
    expect(await idle()).toEqual([]);
    const settledAgain = await fetch(
      `${server.origin}/api/shares/${share.id}/file`,
    );
    expect(settledAgain.status).toBe(200);
    expect((await digestOf(settledAgain)).sha256).toBe(expected);
  }, 60000);

  it("exempts only the binary upload route from the 1 MiB JSON cap", async () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    // Another PUT, and the upload path with the wrong method, keep the small cap.
    const skill = await (
      await server.json(server.owner, "/skills", "POST", {
        title: "cap-skill",
        instructions: "x",
        whenToUse: "never",
        visibility: "workspace",
      })
    ).json();
    expect(
      (
        await server.request(server.owner, `/skills/${skill.id}/files`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: big,
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await server.request(
          server.owner,
          `/files/${crypto.randomUUID()}/content?title=T&type=b&mediaType=x`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: big,
          },
        )
      ).status,
    ).toBe(413);
    expect(await idle()).toEqual([]);
  }, 30000);

  it("never leaves a keep-alive connection open forever: the idle timeout is lifted only for an admitted transfer, whose connection then closes", async () => {
    const small = await put(2 * MB, 801);
    const file = await small.response.json();
    const open: {
      name: string;
      closedAt: () => number;
      status: () => string;
    }[] = [];
    const started = performance.now();
    const connect = async (name: string, head: string, body?: Uint8Array) => {
      let closed = -1;
      let status = "";
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          data(_s, data) {
            status ||=
              /^HTTP\/1\.1 (\d+)/.exec(
                Buffer.from(data).toString("latin1"),
              )?.[1] ?? "";
          },
          close() {
            closed = performance.now() - started;
          },
          open() {},
          error() {},
        },
      });
      socket.write(head);
      if (body) socket.write(body);
      open.push({ name, closedAt: () => closed, status: () => status });
      return socket;
    };
    const cookie = `Cookie: ${server.owner.cookie}`;
    const origin = `Origin: ${server.origin}`;
    const base = `/api/workspaces/${server.workspaceId}`;
    // 1 completed download, 2 completed tiny upload, 3 unknown download (404), all keep-alive.
    await connect(
      "completed download",
      `GET ${base}/files/${file.id}/file HTTP/1.1\r\nHost: x\r\n${cookie}\r\n${origin}\r\n\r\n`,
    );
    await connect(
      "completed upload",
      `PUT ${base}/files/${crypto.randomUUID()}/content?title=T&type=b&mediaType=text/plain&visibility=workspace HTTP/1.1\r\nHost: x\r\n${cookie}\r\n${origin}\r\nContent-Length: 5\r\n\r\nhello`,
    );
    await connect(
      "unknown download",
      `GET ${base}/files/${crypto.randomUUID()}/file HTTP/1.1\r\nHost: x\r\n${cookie}\r\n${origin}\r\n\r\n`,
    );
    await connect(
      "anonymous unknown share",
      `GET /api/shares/${crypto.randomUUID()}/file HTTP/1.1\r\nHost: x\r\n\r\n`,
    );
    // A denied upload with an unread body must close at once rather than wait for an idle timeout.
    const denied = await connect(
      "viewer-denied upload",
      `PUT ${base}/files/${crypto.randomUUID()}/content?title=T&type=b&mediaType=x HTTP/1.1\r\nHost: x\r\nCookie: ${viewer.cookie}\r\n${origin}\r\nContent-Length: ${MAX}\r\n\r\n`,
      new Uint8Array(MB),
    );
    await Bun.sleep(4000);
    const deniedEntry = open.at(-1);
    expect(deniedEntry?.status()).toBe("403");
    expect(deniedEntry?.closedAt() ?? -1).toBeGreaterThan(0);
    denied.terminate();
    // Bun cannot re-arm a lifted idle timeout, so an admitted transfer's connection is closed with its response.
    for (const entry of open.slice(0, 2)) {
      expect(entry.status(), entry.name).toBe("200");
      expect(entry.closedAt(), entry.name).toBeGreaterThan(0);
    }
    // Requests refused before admission keep Bun's idle timeout (30 s) and are gone shortly after it.
    const deadline = performance.now() + 45000;
    while (
      open.slice(2, 4).some((entry) => entry.closedAt() < 0) &&
      performance.now() < deadline
    )
      await Bun.sleep(500);
    for (const entry of open.slice(2, 4))
      expect(entry.closedAt(), entry.name).toBeGreaterThan(0);
    expect(await idle()).toEqual([]);
  }, 80000);

  it("maps a full disk to a retryable unavailable error without leaving a partial file", async () => {
    await expect(
      receiveToFile(patternBody(MB).stream, "/dev/full", {
        maxBytes: MAX,
        signal: AbortSignal.timeout(5000),
        idleMs: 5000,
        flags: "w",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("transfer capacity is admitted before disk is allocated", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServerProcess>>;
  beforeAll(async () => {
    database = await startPostgres();
    // One maximum-size transfer fits the whole budget.
    server = await startServerProcess(database, { spoolBytes: MAX });
  }, 90000);
  afterAll(async () => {
    await server?.stop();
    await database?.stop();
  });
  it("answers busy while one slow upload holds the budget and recovers when it ends", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(new Uint8Array(1024));
        await gate;
        controller.close();
      },
    });
    const first = server.upload(server.owner, crypto.randomUUID(), slow);
    for (let i = 0; i < 50 && !(await server.spoolEntries()).length; i++)
      await Bun.sleep(50);
    const busy = await server.upload(
      server.owner,
      crypto.randomUUID(),
      new Uint8Array(10),
      { length: 10 },
    );
    expect(busy.status).toBe(503);
    release?.();
    expect((await first).status).toBe(200);
    const after = await server.upload(
      server.owner,
      crypto.randomUUID(),
      new Uint8Array(10),
      { length: 10 },
    );
    expect(after.status).toBe(200);
  }, 60000);
});

describe("explicit transfer deadlines abort and join the underlying I/O", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServerProcess>>;
  beforeAll(async () => {
    database = await startPostgres();
    // About 1.5 s allowance (+ the size at 1 GB/s) and a 1.5 s stall limit.
    server = await startServerProcess(database, {
      spoolBytes: MAX,
      env: {
        TRANSFER_BASE_MS: "1500",
        TRANSFER_MIN_BYTES_PER_SECOND: "1000000000",
      },
    });
  }, 90000);
  afterAll(async () => {
    await server?.stop();
    await database?.stop();
  });
  const settled = async () => {
    for (
      let i = 0;
      i < 40 &&
      ((await server.spoolEntries()).length || server.spoolFds().length);
      i++
    )
      await Bun.sleep(100);
    return { entries: await server.spoolEntries(), fds: server.spoolFds() };
  };
  it("cuts a steady slow reader at the total deadline and a non-reading client at the stall limit", async () => {
    // Larger than the socket buffers, so the server cannot simply finish into them before the deadline.
    const bytes = 60 * MB;
    const body = patternBody(bytes, 601);
    const saved = await (
      await server.upload(server.owner, crypto.randomUUID(), body.stream, {
        length: bytes,
      })
    ).json();
    const slow = await server.request(server.owner, `/files/${saved.id}/file`);
    expect(slow.status).toBe(200);
    const reader = (slow.body as ReadableStream<Uint8Array>).getReader();
    const started = performance.now();
    let received = 0;
    let failed = false;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        await Bun.sleep(150);
      }
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(received).toBeLessThan(bytes);
    expect(performance.now() - started).toBeLessThan(8000);
    expect(await settled()).toEqual({ entries: [], fds: [] });
    // A client that never reads is released by the stall detector, so the spool is free again.
    const idleClient = await server.request(
      server.owner,
      `/files/${saved.id}/file`,
    );
    expect(idleClient.status).toBe(200);
    expect(await settled()).toEqual({ entries: [], fds: [] });
    void idleClient.body?.cancel();
  }, 60000);

  it("aborts an upload that trickles past the deadline or goes silent, saving nothing", async () => {
    const before = (
      await database.pool.query("select count(*)::int n from files")
    ).rows[0]?.n;
    const trickle = (pieces: number, gapMs: number) => {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (sent++ >= pieces) return controller.close();
          await Bun.sleep(gapMs);
          controller.enqueue(new Uint8Array(1024));
        },
      });
    };
    const started = performance.now();
    // Steady bytes past the total allowance (about 1.5 s + the declared size).
    const slow = await server
      .upload(server.owner, crypto.randomUUID(), trickle(300, 50), {
        length: 300 * 1024,
      })
      .catch(() => null);
    expect(slow === null || slow.status >= 400).toBe(true);
    expect(performance.now() - started).toBeLessThan(9000);
    // Silence beyond the stall limit.
    const silent = await server
      .upload(server.owner, crypto.randomUUID(), trickle(3, 4000), {
        length: 3 * 1024,
      })
      .catch(() => null);
    expect(silent === null || silent.status >= 400).toBe(true);
    expect(
      (await database.pool.query("select count(*)::int n from files")).rows[0]
        ?.n,
    ).toBe(before);
    expect(await settled()).toEqual({ entries: [], fds: [] });
  }, 60000);

  it("answers a steady chunked upload that outlives the deadline with 503 and closes the connection", async () => {
    let status = "";
    let closedAt = -1;
    const started = performance.now();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(_socket, data) {
          status ||=
            /^HTTP\/1\.1 (\d+)/.exec(
              Buffer.from(data).toString("latin1"),
            )?.[1] ?? "";
        },
        close() {
          closedAt = performance.now() - started;
        },
        open() {},
        error() {},
      },
    });
    socket.write(
      `PUT /api/workspaces/${server.workspaceId}/files/${crypto.randomUUID()}/content?title=T&type=b&mediaType=application/octet-stream&visibility=workspace HTTP/1.1\r\nHost: x\r\nCookie: ${server.owner.cookie}\r\nOrigin: ${server.origin}\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n`,
    );
    const piece = Buffer.alloc(1024, 120);
    while (closedAt < 0 && performance.now() - started < 15000) {
      socket.write(`400\r\n`);
      socket.write(piece);
      socket.write("\r\n");
      await Bun.sleep(100);
    }
    socket.terminate();
    expect(status).toBe("503");
    expect(closedAt).toBeGreaterThan(0);
    // Allowance 1.5 s plus 100 MB at 1 GB/s: cut near 1.6 s, not left open until the client stops.
    expect(closedAt).toBeLessThan(9000);
    expect(await settled()).toEqual({ entries: [], fds: [] });
  }, 40000);
});

describe("the stall limit ends a silent upload even when the total allowance is long", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServerProcess>>;
  beforeAll(async () => {
    database = await startPostgres();
    // Allowance of hours (chunked uploads are sized at the maximum at 1 kB/s) but a 1.5 s stall limit.
    server = await startServerProcess(database, {
      spoolBytes: MAX,
      env: { TRANSFER_BASE_MS: "1500", TRANSFER_MIN_BYTES_PER_SECOND: "1024" },
    });
  }, 90000);
  afterAll(async () => {
    await server?.stop();
    await database?.stop();
  });
  it("answers 503 within seconds of the last byte, keeps nothing and releases the lease", async () => {
    const silent = new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(new Uint8Array(1024));
        await Bun.sleep(8000);
        controller.close();
      },
    });
    const started = performance.now();
    const response = await server
      .upload(server.owner, crypto.randomUUID(), silent)
      .catch(() => null);
    expect(response === null || response.status === 503).toBe(true);
    expect(performance.now() - started).toBeLessThan(6000);
    for (let i = 0; i < 40 && (await server.spoolEntries()).length; i++)
      await Bun.sleep(100);
    expect(await server.spoolEntries()).toEqual([]);
    expect(server.spoolFds()).toEqual([]);
    expect(
      (await database.pool.query("select count(*)::int n from files")).rows[0]
        ?.n,
    ).toBe(0);
  }, 40000);
});
