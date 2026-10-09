import { dlopen, FFIType, ptr } from "bun:ffi";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
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
  if (process.platform === "darwin") {
    const canonicalBase = realpathSync(baseDir);
    const result = Bun.spawnSync(
      [
        "/usr/sbin/lsof",
        "-n",
        "-P",
        "-a",
        "-p",
        String(pid === "self" ? process.pid : pid),
        "-Fn",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0)
      throw new Error("Cannot inspect process open descriptors");
    return result.stdout
      .toString()
      .split("\n")
      .filter((line) => line.startsWith(`n${canonicalBase}/`))
      .map((line) => line.slice(1));
  }
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

export function processStartTicks(pid: number) {
  if (process.platform === "darwin") {
    const result = Bun.spawnSync(
      ["/bin/ps", "-p", String(pid), "-o", "lstart="],
      { env: { ...process.env, LC_ALL: "C" }, stdout: "pipe", stderr: "pipe" },
    );
    const start = result.stdout.toString().trim();
    if (result.exitCode !== 0 || !start)
      throw new Error("Cannot inspect process start time");
    return start;
  }
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (!start) throw new Error("Cannot inspect process start time");
  return start;
}

export function processMemory(pid: number) {
  if (process.platform === "darwin") {
    const view = darwinUsage(pid);
    return {
      peakKb: Number(view.getBigUint64(240, true)) / 1024,
      currentKb: Number(view.getBigUint64(64, true)) / 1024,
      peakMetric: "kernel_lifetime_max_physical_footprint" as const,
      currentMetric: "kernel_resident_size" as const,
    };
  }
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const pick = (name: string) => {
    const value = new RegExp(`${name}:\\s+(\\d+)`).exec(status)?.[1];
    if (!value) throw new Error("Cannot inspect process memory counter");
    return Number(value);
  };
  return {
    peakKb: pick("VmHWM"),
    currentKb: pick("VmRSS"),
    peakMetric: "kernel_resident_high_water" as const,
    currentMetric: "kernel_resident_size" as const,
  };
}

function darwinUsage(pid: number) {
  const library = dlopen("/usr/lib/libproc.dylib", {
    proc_pid_rusage: {
      args: [FFIType.i32, FFIType.i32, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  try {
    const bytes = new Uint8Array(296);
    if (library.symbols.proc_pid_rusage(pid, 4, ptr(bytes)) !== 0)
      throw new Error("Cannot inspect process kernel usage");
    return new DataView(bytes.buffer);
  } finally {
    library.close();
  }
}
