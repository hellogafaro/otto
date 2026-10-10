import { createHash } from "node:crypto";
import { open, readdir, unlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { deliverFile, type Located } from "../apps/server/src/file-delivery";
import type { FileStorage } from "../packages/library/src";
import { openSpoolFds, testSpool } from "./fixtures/storage";

const CHUNK = 64 * 1024;
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("verified-before-first-byte delivery: checks, deadlines and lease release", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });
  it("detects a held spool descriptor before and after unlink, then proves it closes", async () => {
    const transfers = await testSpool(100);
    closers.push(transfers.close);
    const lease = transfers.spool.lease(100);
    const path = lease.path();
    await writeFile(path, "descriptor probe");
    const handle = await open(path, "r");
    try {
      expect(openSpoolFds(transfers.baseDir)).toHaveLength(1);
      await unlink(path);
      expect(openSpoolFds(transfers.baseDir)).toHaveLength(1);
    } finally {
      await handle.close();
      await lease.release();
    }
    expect(openSpoolFds(transfers.baseDir)).toEqual([]);
  });
  async function setup(
    size: number,
    behavior: {
      corrupt?: boolean;
      declaredLength?: number;
      chunkDelayMs?: number;
    } = {},
  ) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 251;
    const stored = new Uint8Array(bytes);
    if (behavior.corrupt)
      stored[Math.floor(size / 2)] = (stored[Math.floor(size / 2)] ?? 0) ^ 0xff;
    const transfers = await testSpool(10 * size);
    closers.push(transfers.close);
    const storage: FileStorage = {
      async put() {},
      async get() {
        return stored;
      },
      async open() {
        let offset = 0;
        return {
          byteLength: behavior.declaredLength ?? stored.byteLength,
          stream: new ReadableStream<Uint8Array>({
            async pull(output) {
              if (behavior.chunkDelayMs) await Bun.sleep(behavior.chunkDelayMs);
              if (offset >= stored.byteLength) return output.close();
              output.enqueue(stored.slice(offset, offset + CHUNK));
              offset += CHUNK;
            },
          }),
        };
      },
    };
    const located: Located & Record<string, unknown> = {
      objectKey: "ws/object/key",
      sha256: sha(bytes),
      byteLength: size,
    };
    let calls = 0;
    // `forbidAt` makes the Nth authority check fail: 1 is the initial lookup, 2 follows spool verification,
    // later calls are the delivery re-checks and the final-chunk check.
    const script = { forbidAt: Number.POSITIVE_INFINITY };
    const locate = async () => {
      calls++;
      if (calls >= script.forbidAt)
        throw new (await import("@otto/shared")).DomainError("forbidden");
      return { ...located };
    };
    const files = async () =>
      (
        await Promise.all(
          (
            await readdir(transfers.baseDir)
          ).map((name) => readdir(`${transfers.baseDir}/${name}`)),
        )
      )
        .flat()
        .filter((name) => name.endsWith(".part"));
    return {
      bytes,
      storage,
      locate,
      script,
      transfers,
      files,
      calls: () => calls,
    };
  }
  const drain = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    let received = 0;
    let error: unknown;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
      }
    } catch (caught) {
      error = caught;
    }
    return { received, error };
  };
  const limits = { baseMs: 60000, minBytesPerSecond: 256 * 1024 };

  it("serves digest-exact bytes and releases the lease and spool file at the end", async () => {
    const fixture = await setup(1_000_000);
    const delivery = await deliverFile({
      spool: fixture.transfers.spool,
      storage: fixture.storage,
      locate: fixture.locate,
      transfer: limits,
    });
    expect(fixture.transfers.spool.reservedBytes).toBe(1_000_000);
    const result = await drain(delivery.body);
    expect(result).toEqual({ received: 1_000_000, error: undefined });
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
    expect(await fixture.files()).toEqual([]);
    expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
  });

  it("refuses corrupt or wrong-length storage before any byte and frees the lease", async () => {
    for (const behavior of [{ corrupt: true }, { declaredLength: 10 }]) {
      const fixture = await setup(500_000, behavior);
      await expect(
        deliverFile({
          spool: fixture.transfers.spool,
          storage: fixture.storage,
          locate: fixture.locate,
          transfer: limits,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(fixture.transfers.spool.reservedBytes).toBe(0);
      expect(await fixture.files()).toEqual([]);
      expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
    }
  });

  it("checks authority before the final chunk is disclosed", async () => {
    const fixture = await setup(1_000_000);
    // Periodic re-checks are out of reach, so only the initial, post-verification and final checks run.
    fixture.script.forbidAt = 3;
    const delivery = await deliverFile({
      spool: fixture.transfers.spool,
      storage: fixture.storage,
      locate: fixture.locate,
      transfer: limits,
      recheck: {
        bytes: Number.POSITIVE_INFINITY,
        ms: Number.POSITIVE_INFINITY,
      },
    });
    const result = await drain(delivery.body);
    expect(result.error).toMatchObject({ code: "forbidden" });
    // Everything except the withheld final chunk may have been sent; the final chunk never is.
    expect(result.received).toBeLessThan(1_000_000);
    // The withheld piece is at most one read chunk (Bun reads the spool in 256 KiB pieces).
    expect(1_000_000 - result.received).toBeLessThanOrEqual(256 * 1024);
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
  });

  it("re-checks before disclosing beyond the interval, not after", async () => {
    const fixture = await setup(2_000_000);
    fixture.script.forbidAt = 3;
    const delivery = await deliverFile({
      spool: fixture.transfers.spool,
      storage: fixture.storage,
      locate: fixture.locate,
      transfer: limits,
      recheck: { bytes: 4 * CHUNK, ms: Number.POSITIVE_INFINITY },
    });
    const result = await drain(delivery.body);
    expect(result.error).toMatchObject({ code: "forbidden" });
    // Revocation at the first periodic check discloses at most the interval (plus the one chunk in flight).
    expect(result.received).toBeLessThanOrEqual(5 * CHUNK);
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
  });

  it("ends a slow but steady reader at the total deadline and frees the lease", async () => {
    const fixture = await setup(4_000_000);
    const delivery = await deliverFile({
      spool: fixture.transfers.spool,
      storage: fixture.storage,
      locate: fixture.locate,
      // Deadline about 0.4 s: 300 ms plus the size at 1 GB/s.
      transfer: { baseMs: 300, minBytesPerSecond: 1_000_000_000 },
      recheck: {
        bytes: Number.POSITIVE_INFINITY,
        ms: Number.POSITIVE_INFINITY,
      },
    });
    const reader = delivery.body.getReader();
    const started = performance.now();
    let received = 0;
    let error: unknown;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        await Bun.sleep(60); // steady, never idle for the stall limit
      }
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "unavailable" });
    expect(received).toBeLessThan(4_000_000);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
    expect(await fixture.files()).toEqual([]);
    expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
  });

  it("releases a stalled reader and an unconsumed body after the stall limit", async () => {
    for (const consume of [true, false]) {
      const fixture = await setup(4_000_000);
      const delivery = await deliverFile({
        spool: fixture.transfers.spool,
        storage: fixture.storage,
        locate: fixture.locate,
        // Stall limit 400 ms while the total deadline is minutes away (4 MB at 100 kB/s).
        transfer: { baseMs: 400, minBytesPerSecond: 100_000 },
      });
      const reader = delivery.body.getReader();
      if (consume) await reader.read();
      for (let i = 0; i < 40 && fixture.transfers.spool.reservedBytes; i++)
        await Bun.sleep(100);
      expect(fixture.transfers.spool.reservedBytes, `consume=${consume}`).toBe(
        0,
      );
      expect(await fixture.files()).toEqual([]);
      expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
    }
  });

  it("releases the lease immediately when the client cancels, and bounds anonymous callers by their ceiling", async () => {
    const fixture = await setup(1_000_000);
    const delivery = await deliverFile({
      spool: fixture.transfers.spool,
      storage: fixture.storage,
      locate: fixture.locate,
      transfer: limits,
    });
    const reader = delivery.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
    expect(await fixture.files()).toEqual([]);
    expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
    await expect(
      deliverFile({
        spool: fixture.transfers.spool,
        storage: fixture.storage,
        locate: fixture.locate,
        transfer: limits,
        ceiling: 500_000,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
  });

  it("bounds the storage fill by the deadline and joins its cleanup", async () => {
    const fixture = await setup(2_000_000, { chunkDelayMs: 150 });
    await expect(
      deliverFile({
        spool: fixture.transfers.spool,
        storage: fixture.storage,
        locate: fixture.locate,
        transfer: { baseMs: 300, minBytesPerSecond: 1_000_000_000 },
      }),
    ).rejects.toBeDefined();
    expect(fixture.transfers.spool.reservedBytes).toBe(0);
    expect(await fixture.files()).toEqual([]);
    expect(openSpoolFds(fixture.transfers.baseDir)).toEqual([]);
  });

  it("lifts per-connection limits only once admitted, after authority and before any storage read", async () => {
    const events: string[] = [];
    const admitted = await setup(500_000);
    const delivery = await deliverFile({
      spool: admitted.transfers.spool,
      storage: admitted.storage,
      locate: admitted.locate,
      transfer: limits,
      onAdmitted: () => events.push("admitted"),
    });
    expect(events).toEqual(["admitted"]);
    await delivery.body.cancel();
    // Denied before admission: nothing was lifted.
    const denied = await setup(500_000);
    denied.script.forbidAt = 1;
    await expect(
      deliverFile({
        spool: denied.transfers.spool,
        storage: denied.storage,
        locate: denied.locate,
        transfer: limits,
        onAdmitted: () => events.push("denied-admitted"),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(events).toEqual(["admitted"]);
  });
});
