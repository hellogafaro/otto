import { isDeepStrictEqual } from "node:util";
import type { FileStorage } from "@otto/library";
import { DomainError } from "@otto/shared";
import {
  copyToFile,
  deadlineMs,
  idleMs,
  PayloadTooLarge,
  type Spool,
  type TransferLimits,
} from "./spool";

/** Current authority plus the stored object identity; every call re-authorizes. */
export interface Located {
  objectKey: string;
  sha256: string;
  byteLength: number;
}
// Bytes already handed to the kernel or network cannot be recalled, so disclosure after a revocation is bounded by
// these intervals plus the socket buffers, not by them alone. Reads are demand-driven (no read-ahead).
const RECHECK_BYTES = 4 * 1024 * 1024;
const RECHECK_MS = 2000;

/**
 * Verified-before-first-byte delivery: the stored object is streamed to a private spool while its length and
 * digest are checked against the saved record, authority is re-checked, and only then are bytes served.
 * Authority is checked again before each further RECHECK interval and before the final chunk is disclosed.
 * Every phase has an explicit deadline; the disk lease is held until the response is fully sent, fails, stalls,
 * times out or is cancelled, even if the response is never consumed.
 */
export async function deliverFile(options: {
  spool: Spool;
  storage: FileStorage;
  locate: () => Promise<Located & Record<string, unknown>>;
  signal?: AbortSignal;
  transfer: TransferLimits;
  /** Largest share of the spool budget this caller may hold (anonymous callers get a fraction). */
  ceiling?: number;
  /** Called once the disk lease is held: the caller may now lift per-connection limits for this transfer. */
  onAdmitted?: () => void;
  /** Authority re-check interval during delivery; production uses the defaults. */
  recheck?: { bytes: number; ms: number };
}) {
  const interval = options.recheck ?? { bytes: RECHECK_BYTES, ms: RECHECK_MS };
  const located = await options.locate();
  const lease = options.spool.lease(located.byteLength, options.ceiling);
  const path = lease.path();
  options.onAdmitted?.();
  const total = deadlineMs(options.transfer, located.byteLength);
  const timers: Timer[] = [];
  try {
    const fill = AbortSignal.any([
      AbortSignal.timeout(total),
      ...(options.signal ? [options.signal] : []),
    ]);
    const opened = await options.storage.open(located.objectKey, total);
    if (opened.byteLength !== located.byteLength)
      throw new DomainError(
        "conflict",
        "Stored bytes do not match the saved file",
      );
    const stored = await copyToFile(opened.stream, path, {
      maxBytes: located.byteLength,
      signal: fill,
      idleMs: idleMs(options.transfer),
    }).catch((error: unknown) => {
      if (error instanceof PayloadTooLarge)
        throw new DomainError(
          "conflict",
          "Stored bytes do not match the saved file",
        );
      throw error;
    });
    if (
      stored.byteLength !== located.byteLength ||
      stored.sha256 !== located.sha256
    )
      throw new DomainError(
        "conflict",
        "Stored bytes do not match the saved file",
      );
    const same = async () => {
      if (!isDeepStrictEqual(await options.locate(), located))
        throw new DomainError("forbidden");
    };
    await same();
    const reader = Bun.file(path).stream().getReader();
    let held: Uint8Array | undefined;
    let sent = 0;
    let checked = { bytes: 0, at: Date.now() };
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      await reader.cancel().catch(() => undefined);
      await lease.release();
    };
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let lastPull = Date.now();
    // Total delivery deadline and stall detection run from now, whether or not anything ever reads the body.
    const expire = (message: string) => () => {
      if (finished) return;
      const error = new DomainError("unavailable", message);
      void finish().then(() => {
        try {
          controller?.error(error);
        } catch {
          // already closed or errored
        }
      });
    };
    timers.push(setTimeout(expire("Delivery deadline exceeded"), total));
    const stall = setInterval(
      () => {
        if (!finished && Date.now() - lastPull > idleMs(options.transfer))
          expire("Delivery stalled")();
      },
      Math.max(250, Math.floor(idleMs(options.transfer) / 4)),
    );
    timers.push(stall);
    const body = new ReadableStream<Uint8Array>(
      {
        start(output) {
          controller = output;
        },
        async pull(output) {
          lastPull = Date.now();
          try {
            // Demand-driven (no read-ahead): keep reading until one chunk can be disclosed, because with a zero
            // high-water mark the stream calls pull again only after something was enqueued.
            for (;;) {
              if (finished) return;
              const next = await reader.read();
              // An expiry or cancel that raced this read has already ended the transfer: never disclose or close cleanly.
              if (finished) return;
              if (next.done) {
                // Final authority check passes before the last chunk is disclosed.
                await same();
                // The lease is released (files gone, capacity returned) before the stream can end for the consumer.
                await finish();
                if (held) output.enqueue(held);
                held = undefined;
                output.close();
                return;
              }
              if (!held) {
                held = next.value;
                continue;
              }
              // Check before disclosing anything beyond the interval, not after.
              if (
                sent - checked.bytes >= interval.bytes ||
                Date.now() - checked.at >= interval.ms
              ) {
                await same();
                checked = { bytes: sent, at: Date.now() };
              }
              output.enqueue(held);
              sent += held.byteLength;
              held = next.value;
              return;
            }
          } catch (error) {
            await finish();
            throw error;
          }
        },
        async cancel() {
          await finish();
        },
      },
      { highWaterMark: 0 },
    );
    return { byteLength: located.byteLength, body, located };
  } catch (error) {
    for (const timer of timers) clearTimeout(timer);
    await lease.release();
    throw error;
  }
}
