import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSpool,
  PayloadTooLarge,
  receiveToFile,
} from "../apps/server/src/spool";
import { processStartTicks } from "./fixtures/storage";

describe("transfer spool ownership and admission", () => {
  const bases: string[] = [];
  afterEach(async () => {
    for (const base of bases.splice(0))
      await rm(base, { recursive: true, force: true });
  });
  const base = async () => {
    const dir = await mkdtemp(join(tmpdir(), "otto-spool-unit-"));
    bases.push(dir);
    return dir;
  };
  it("reserves disk before allocation, shares one budget and frees it on release", async () => {
    const dir = await base();
    const spool = await createSpool({ baseDir: dir, budgetBytes: 100 });
    const first = spool.lease(60);
    expect(() => spool.lease(60)).toThrow("Transfer capacity busy");
    const path = first.path();
    await writeFile(path, "x");
    await first.release();
    await first.release();
    expect(existsSync(path)).toBe(false);
    expect(spool.reservedBytes).toBe(0);
    spool.lease(100);
    await spool.close();
  });

  it("returns capacity only after files are deleted, joins concurrent releases and stays held when deletion fails", async () => {
    const dir = await base();
    const spool = await createSpool({ baseDir: dir, budgetBytes: 100 });
    const lease = spool.lease(60);
    const path = lease.path();
    await writeFile(path, "x");
    const first = lease.release();
    const second = lease.release();
    expect(spool.reservedBytes).toBe(60);
    expect(() => spool.lease(60)).toThrow("Transfer capacity busy");
    await Promise.all([first, second]);
    expect(existsSync(path)).toBe(false);
    expect(spool.reservedBytes).toBe(0);
    await lease.release();
    expect(spool.reservedBytes).toBe(0);

    const stuck = spool.lease(70);
    const blocked = stuck.path();
    // A non-empty directory cannot be removed by a file delete, so cleanup fails.
    await mkdir(blocked);
    await writeFile(join(blocked, "x"), "x");
    await expect(stuck.release()).rejects.toThrow();
    expect(spool.reservedBytes).toBe(70);
    await rm(blocked, { recursive: true });
    await stuck.release();
    expect(spool.reservedBytes).toBe(0);
    await spool.close();
  });

  it("removes only instance directories whose recorded owner is gone and never touches anything else", async () => {
    const dir = await base();
    await mkdir(join(dir, "unrelated"));
    await writeFile(join(dir, "unrelated", "keep.txt"), "mine");
    await writeFile(join(dir, "plain-file"), "mine");
    // Dead owner: a PID far above any live process.
    const dead = join(dir, "inst-4194303-aaaaaaaaaaaa");
    await mkdir(dead);
    await writeFile(
      join(dead, "owner.json"),
      JSON.stringify({ pid: 4194303, start: "1" }),
    );
    await writeFile(join(dead, "abandoned.part"), "stale");
    // Live PID with a different start time: a recycled PID (for example PID 1 in a restarted container).
    const recycled = join(dir, `inst-${process.pid}-bbbbbbbbbbbb`);
    await mkdir(recycled);
    await writeFile(
      join(recycled, "owner.json"),
      JSON.stringify({ pid: process.pid, start: "0" }),
    );
    // Live owner with a matching start time and an unreadable-owner directory are both left alone.
    const live = join(dir, `inst-${process.pid}-cccccccccccc`);
    const start = processStartTicks(process.pid);
    await mkdir(live);
    await writeFile(
      join(live, "owner.json"),
      JSON.stringify({ pid: process.pid, start }),
    );
    const unknown = join(dir, "inst-1-dddddddddddd");
    await mkdir(unknown);
    const spool = await createSpool({ baseDir: dir, budgetBytes: 10 });
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(recycled)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(unknown)).toBe(true);
    expect(await readFile(join(dir, "unrelated", "keep.txt"), "utf8")).toBe(
      "mine",
    );
    expect(await readFile(join(dir, "plain-file"), "utf8")).toBe("mine");
    await spool.close();
  });

  it("preserves live legacy owners and refuses invalid or directory-mismatched owner identities", async () => {
    const dir = await base();
    const entries = [
      { name: `inst-${process.pid}-eeeeeeeeeeee`, owner: { pid: process.pid } },
      {
        name: "inst-4194303-ffffffffffff",
        owner: { pid: process.pid, start: processStartTicks(process.pid) },
      },
      { name: "inst-0-111111111111", owner: { pid: 0, start: "0" } },
      { name: "inst-1-222222222222", owner: { pid: "1", start: "0" } },
      {
        name: `inst-${process.pid}-333333333333`,
        owner: { pid: process.pid, start: 0 },
      },
    ];
    for (const { name, owner } of entries) {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, "owner.json"), JSON.stringify(owner));
      await writeFile(join(dir, name, "retained.part"), "must survive");
    }
    const spool = await createSpool({ baseDir: dir, budgetBytes: 10 });
    try {
      for (const { name } of entries)
        expect(await readFile(join(dir, name, "retained.part"), "utf8")).toBe(
          "must survive",
        );
    } finally {
      await spool.close();
    }
  });

  it("ends a body that stalls or overruns its total deadline, removes nothing it does not own and reports honestly", async () => {
    const dir = await base();
    const spool = await createSpool({ baseDir: dir, budgetBytes: 10_000_000 });
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
    const lease = spool.lease(1_000_000);
    // No byte for longer than the idle limit.
    await expect(
      receiveToFile(trickle(5, 1500), lease.path(), {
        maxBytes: 1_000_000,
        idleMs: 300,
        signal: AbortSignal.timeout(20000),
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    // Steady bytes, but past the total deadline.
    const started = performance.now();
    await expect(
      receiveToFile(trickle(200, 50), lease.path(), {
        maxBytes: 1_000_000,
        idleMs: 5000,
        signal: AbortSignal.timeout(400),
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(performance.now() - started).toBeLessThan(3000);
    // Over the maximum, and a body that differs from its declared length.
    await expect(
      receiveToFile(trickle(5, 1), lease.path(), {
        maxBytes: 2048,
        idleMs: 5000,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLarge);
    await expect(
      receiveToFile(trickle(2, 1), lease.path(), {
        maxBytes: 100000,
        declaredBytes: 5000,
        idleMs: 5000,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await lease.release();
    expect(spool.reservedBytes).toBe(0);
    await spool.close();
  });
});
