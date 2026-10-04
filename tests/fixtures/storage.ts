import { mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpool } from "../../apps/server/src/spool";
import type { FileStorage } from "../../packages/files/src";

/** Adapts a bytes-only fixture to the streamed storage contract; controlled in-memory peer, not S3. */
export function fixtureStorage(base: {
  put(key: string, bytes: Uint8Array, sha256: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}): FileStorage {
  return {
    async put(key, body, sha256) {
      await base.put(
        key,
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await Bun.file(body.path).arrayBuffer()),
        sha256,
      );
    },
    get: base.get,
    async open(key) {
      const bytes = await base.get(key);
      return {
        byteLength: bytes.byteLength,
        stream: new ReadableStream<Uint8Array>({
          start(output) {
            output.enqueue(bytes);
            output.close();
          },
        }),
      };
    },
  };
}
/** A private spool in its own temporary base; the caller closes it. */
export async function testSpool(budgetBytes = 500_000_000) {
  const baseDir = mkdtempSync(join(tmpdir(), "otto-test-spool-"));
  const spool = await createSpool({ baseDir, budgetBytes });
  process.once("exit", () => rmSync(baseDir, { recursive: true, force: true }));
  return {
    spool,
    baseDir,
    async close() {
      await spool.close();
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

/** Open file descriptors of this process (or another) that point into a spool directory, including deleted files. */
export function openSpoolFds(baseDir: string, pid: number | "self" = "self") {
  const dir = `/proc/${pid}/fd`;
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    try {
      const target = readlinkSync(`${dir}/${name}`);
      if (target.startsWith(baseDir)) found.push(target);
    } catch {
      // descriptor closed while scanning
    }
  }
  return found;
}
