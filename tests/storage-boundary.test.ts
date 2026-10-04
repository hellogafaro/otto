import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createS3Storage } from "../packages/files/src/storage";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const missing = () =>
  new Response("<Error><Code>NoSuchKey</Code></Error>", {
    status: 404,
    headers: { "Content-Type": "application/xml" },
  });
/** HTTP S3 protocol fixture, not Garage, storage durability or access-control proof. */
describe("S3 adapter against a local protocol fixture", () => {
  let server: Bun.Server<undefined> | undefined;
  let storage: ReturnType<typeof createS3Storage> | undefined;
  afterEach(async () => {
    storage?.close?.();
    await server?.stop(true);
  });
  function start(handler: (request: Request) => Promise<Response> | Response) {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
    storage = createS3Storage({
      endpoint: server.url.origin,
      region: "garage",
      bucket: "test",
      accessKeyId: crypto.randomUUID(),
      secretAccessKey: crypto.randomUUID(),
    });
    return storage;
  }
  it("preserves bytes when a store ignores conditional writes, including lost-ack retries", async () => {
    const bytes = new TextEncoder().encode("immutable result");
    const key = `intent/${hash(bytes)}`;
    let stored: Uint8Array | undefined;
    let digest = "";
    let writes = 0;
    let loseAcknowledgement = true;
    const adapter = start(async (request) => {
      if (request.method === "PUT") {
        // Deliberately overwrite, ignoring If-None-Match like pinned Garage source.
        writes++;
        stored = new Uint8Array(await request.arrayBuffer());
        digest = request.headers.get("x-amz-meta-sha256") ?? "";
        return loseAcknowledgement
          ? new Response("<Error><Code>ServiceUnavailable</Code></Error>", {
              status: 503,
              headers: { "Content-Type": "application/xml" },
            })
          : new Response(null);
      }
      return stored
        ? new Response(Buffer.from(stored), {
            headers: { "x-amz-meta-sha256": digest },
          })
        : missing();
    });
    await expect(adapter.put(key, bytes, hash(bytes))).rejects.toThrow();
    const lostWrites = writes;
    loseAcknowledgement = false;
    await adapter.put(key, bytes, hash(bytes));
    expect(writes).toBe(lostWrites);
    expect(hash(await adapter.get(key))).toBe(hash(bytes));
    const changed = new TextEncoder().encode("different result");
    await expect(adapter.put(key, changed, hash(changed))).rejects.toThrow(
      "Immutable object conflict",
    );
    expect(writes).toBe(lostWrites);
    // Metadata and length remain plausible while bytes are corrupted.
    stored = new TextEncoder().encode("x".repeat(bytes.byteLength));
    await expect(adapter.put(key, bytes, hash(bytes))).rejects.toThrow(
      "integrity",
    );
    expect(writes).toBe(lostWrites);
  });
  it("rejects different valid bytes for one saved digest key before an overwrite", async () => {
    const original = new TextEncoder().encode("saved bytes");
    const changed = new TextEncoder().encode("other bytes");
    let writes = 0;
    const adapter = start((request) => {
      if (request.method === "PUT") {
        writes++;
        return new Response(null);
      }
      return new Response(Buffer.from(original), {
        headers: { "x-amz-meta-sha256": hash(original) },
      });
    });
    await expect(
      adapter.put(`intent/${hash(original)}`, changed, hash(changed)),
    ).rejects.toThrow("Immutable object conflict");
    expect(writes).toBe(0);
  });
  it("writes and verifies a new digest key with a non-conditional store", async () => {
    const bytes = new TextEncoder().encode("new result");
    let stored: Uint8Array | undefined;
    const adapter = start(async (request) => {
      if (request.method === "PUT") {
        stored = new Uint8Array(await request.arrayBuffer());
        return new Response(null);
      }
      return stored
        ? new Response(Buffer.from(stored), {
            headers: { "x-amz-meta-sha256": hash(bytes) },
          })
        : missing();
    });
    await adapter.put(`intent/${hash(bytes)}`, bytes, hash(bytes));
    expect(hash(await adapter.get(`intent/${hash(bytes)}`))).toBe(hash(bytes));
  });
  it("reconciles existing legacy bytes, refuses absent legacy keys, and never overwrites them", async () => {
    const bytes = new TextEncoder().encode("legacy result");
    let writes = 0;
    const adapter = start((request) => {
      if (request.method === "PUT") {
        writes++;
        return new Response(null);
      }
      return new URL(request.url).pathname.endsWith("/existing")
        ? new Response(Buffer.from(bytes), {
            headers: { "x-amz-meta-sha256": hash(bytes) },
          })
        : missing();
    });
    await adapter.put("existing", bytes, hash(bytes));
    expect(hash(await adapter.get("existing"))).toBe(hash(bytes));
    await expect(adapter.put("absent", bytes, hash(bytes))).rejects.toThrow(
      "Legacy object missing",
    );
    expect(writes).toBe(0);
  });
  it("rejects oversized objects and mismatched hashes before publication", async () => {
    let calls = 0;
    const adapter = start(() => {
      calls++;
      return new Response(new Uint8Array(8 * 1024 * 1024 + 1));
    });
    await expect(
      adapter.put("invalid", new Uint8Array(1), "wrong"),
    ).rejects.toThrow("Invalid object bytes");
    expect(calls).toBe(0);
    await expect(adapter.get("oversized")).rejects.toThrow(
      "Invalid object size",
    );
  });
  it("propagates permission denial and does not try a second account", async () => {
    let calls = 0;
    const adapter = start(() => {
      calls++;
      return new Response("<Error><Code>AccessDenied</Code></Error>", {
        status: 403,
        headers: { "Content-Type": "application/xml" },
      });
    });
    await expect(adapter.get("private")).rejects.toMatchObject({
      name: "AccessDenied",
    });
    expect(calls).toBe(1);
  });
});
