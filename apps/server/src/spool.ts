import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "@otto/shared";

/** Explicit transfer bounds: a fixed allowance plus time for the size at a minimum acceptable rate. */
export interface TransferLimits {
  baseMs: number;
  minBytesPerSecond: number;
}
export const DEFAULT_TRANSFER: TransferLimits = {
  baseMs: 60000,
  minBytesPerSecond: 256 * 1024,
};
export const deadlineMs = (limits: TransferLimits, bytes: number) =>
  limits.baseMs + Math.ceil((bytes / limits.minBytesPerSecond) * 1000);
/** No progress for this long ends a transfer, replacing Bun's idle timeout which is disabled per route. */
export const idleMs = (limits: TransferLimits) =>
  Math.min(30000, limits.baseMs);
/**
 * Bun's idle timeout (default 30 s) would cut a transfer that is legitimately waiting on storage. An admitted transfer
 * disables it for its connection and is bounded by the explicit total and stall deadlines instead. Bun cannot re-arm the
 * timeout afterwards, so every response of an admitted transfer carries `Connection: close`. A no-op without Bun.
 */
export function admitTransfer(c: {
  env: unknown;
  req: { raw: Request };
  header(name: string, value: string): void;
}) {
  (
    c.env as
      | { timeout?: (request: Request, seconds: number) => void }
      | undefined
  )?.timeout?.(c.req.raw, 0);
  c.header("Connection", "close");
}
/** Raised when a body is larger than its allowed or declared size. */
export class PayloadTooLarge extends Error {}

/** Kernel start time distinguishes this process from an earlier one that reused its PID (containers). */
async function processStart(pid: number) {
  try {
    if (process.platform === "darwin") {
      const child = Bun.spawn(["/bin/ps", "-p", String(pid), "-o", "lstart="], {
        env: { LC_ALL: "C" },
        stdout: "pipe",
        stderr: "ignore",
      });
      const start = (await new Response(child.stdout).text()).trim();
      return (await child.exited) === 0 && start ? start : undefined;
    }
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Private disk for transfers in flight. Each server instance owns one 0700 subdirectory of the
 * configured base, and one byte budget covers uploads and download verification together.
 */
export async function createSpool(options: {
  baseDir?: string;
  budgetBytes: number;
}) {
  const base = options.baseDir ?? join(tmpdir(), "otto-spool");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const name = `inst-${process.pid}-${randomBytes(6).toString("hex")}`;
  const dir = join(base, name);
  await mkdir(dir, { mode: 0o700 });
  await writeFile(
    join(dir, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      start: await processStart(process.pid),
    }),
    { mode: 0o600 },
  );
  // Only instance directories this program created, whose recorded owner is demonstrably gone, are removed.
  for (const entry of await readdir(base)) {
    if (entry === name || !/^inst-\d+-[0-9a-f]{12}$/.test(entry)) continue;
    try {
      const owner = JSON.parse(
        await readFile(join(base, entry, "owner.json"), "utf8"),
      ) as { pid: number; start?: string };
      if (
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        !entry.startsWith(`inst-${owner.pid}-`) ||
        (owner.start !== undefined && typeof owner.start !== "string")
      )
        continue;
      const start = await processStart(owner.pid);
      const running =
        alive(owner.pid) &&
        (owner.start === undefined ||
          start === undefined ||
          start === owner.start);
      if (!running) await rm(join(base, entry), { recursive: true });
    } catch {
      // Unknown or unreadable ownership is left alone.
    }
  }
  let reserved = 0;
  /** Reserve disk before any byte is written; held until the transfer fully completes or is cancelled. */
  function lease(bytes: number, ceiling = options.budgetBytes) {
    // `ceiling` lets anonymous traffic use only part of the budget so authenticated transfers keep headroom.
    if (reserved + bytes > Math.min(ceiling, options.budgetBytes))
      throw new DomainError("unavailable", "Transfer capacity busy");
    reserved += bytes;
    const paths: string[] = [];
    let releasing: Promise<void> | undefined;
    let released = false;
    return {
      path() {
        const path = join(dir, `${crypto.randomUUID()}.part`);
        paths.push(path);
        return path;
      },
      /** Capacity returns only after the files are gone; concurrent callers join one cleanup and a failed one stays held. */
      release() {
        if (released) return Promise.resolve();
        releasing ??= Promise.all(
          paths.map((path) => rm(path, { force: true })),
        ).then(
          () => {
            released = true;
            reserved -= bytes;
          },
          (error: unknown) => {
            releasing = undefined;
            throw error;
          },
        );
        return releasing;
      },
    };
  }
  return {
    lease,
    budgetBytes: options.budgetBytes,
    get reservedBytes() {
      return reserved;
    },
    async close() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export type Spool = Awaited<ReturnType<typeof createSpool>>;
export type SpoolLease = ReturnType<Spool["lease"]>;

/**
 * Copy a web stream into a new private file while counting and hashing. Whatever the outcome — success, overrun,
 * deadline, stall, write error or abort — the source is cancelled and the file closed and joined before this returns,
 * so a released lease never hides detached I/O.
 */
export async function copyToFile(
  source: ReadableStream<Uint8Array> | null,
  path: string,
  limits: {
    maxBytes: number;
    signal: AbortSignal;
    /** Abort when no byte arrives for this long. */
    idleMs: number;
    /** Open flags; only tests change the default exclusive create (for example to reach /dev/full). */
    flags?: string;
  },
) {
  const reader = source?.getReader();
  const hash = createHash("sha256");
  let byteLength = 0;
  let writeError: Error | undefined;
  let stalled = false;
  const out = createWriteStream(path, {
    flags: limits.flags ?? "wx",
    mode: 0o600,
  });
  out.on("error", (error) => {
    writeError = error;
  });
  const cancel = () => {
    void reader?.cancel().catch(() => undefined);
  };
  let idle = setTimeout(() => {
    stalled = true;
    cancel();
  }, limits.idleMs);
  limits.signal.addEventListener("abort", cancel, { once: true });
  let failure: unknown;
  try {
    if (reader)
      for (;;) {
        if (writeError) throw writeError;
        const next = await reader.read();
        if (limits.signal.aborted || stalled)
          throw new DomainError("unavailable", "Transfer timed out");
        if (next.done) break;
        clearTimeout(idle);
        idle = setTimeout(() => {
          stalled = true;
          cancel();
        }, limits.idleMs);
        byteLength += next.value.byteLength;
        if (byteLength > limits.maxBytes) throw new PayloadTooLarge();
        hash.update(next.value);
        if (!out.write(next.value))
          await new Promise<void>((resolve, reject) => {
            const drained = () => {
              out.off("error", failed);
              resolve();
            };
            const failed = (error: Error) => {
              out.off("drain", drained);
              reject(error);
            };
            out.once("drain", drained);
            out.once("error", failed);
          });
      }
    await new Promise<void>((resolve, reject) => {
      if (writeError) return reject(writeError);
      out.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(idle);
    limits.signal.removeEventListener("abort", cancel);
    await reader?.cancel().catch(() => undefined);
    if (!out.closed)
      await new Promise<void>((resolve) => {
        out.once("close", () => resolve());
        out.destroy();
      });
  }
  if (failure) {
    if ((failure as NodeJS.ErrnoException).code === "ENOSPC")
      throw new DomainError("unavailable", "Transfer storage full");
    throw failure;
  }
  return { byteLength, sha256: hash.digest("hex") };
}

/** Stream a request body to a private file; the digest is server-computed and a declared length must match. */
export async function receiveToFile(
  body: ReadableStream<Uint8Array> | null,
  path: string,
  limits: {
    maxBytes: number;
    declaredBytes?: number;
    signal: AbortSignal;
    idleMs: number;
    flags?: string;
  },
) {
  const received = await copyToFile(body, path, limits);
  if (
    limits.declaredBytes !== undefined &&
    limits.declaredBytes !== received.byteLength
  )
    throw new DomainError("invalid", "Body length differs from Content-Length");
  return received;
}
