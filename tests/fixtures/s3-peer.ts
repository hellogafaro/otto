import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Controlled S3-compatible HTTP peer for path-style object PUT/GET/HEAD and HeadBucket, backed by a private
 * temporary directory and Node's HTTP server (exact Content-Length control). It proves the real AWS SDK adapter
 * and failure handling only; it does not model Garage durability, authentication, multipart or listing.
 * Behaviors are switched per test through `behavior`.
 */
export async function startS3Peer(bucket = "otto-test") {
  const dir = await mkdtemp(join(tmpdir(), "otto-s3-peer-"));
  const objects = new Map<
    string,
    { path: string; length: number; meta: Record<string, string> }
  >();
  const behavior = {
    /** Fail this many upcoming PUTs with 500 before storing anything. */
    failPuts: 0,
    /** Store the next PUT, then answer 500 (a lost acknowledgement). */
    losePutAck: false,
    /** Flip one byte in the middle of every GET body. */
    corruptGet: false,
    /** Close the GET body halfway while the headers declare the full length. */
    truncateGet: false,
    /** Store the next PUT with one flipped byte in the middle (same length, same metadata): silent corruption. */
    corruptStoredPut: false,
    /** Reset the connection of this many upcoming PUTs as soon as they start. */
    dropPuts: 0,
    /** Wait between 256 KiB chunks of GET bodies and while receiving PUT bodies. */
    chunkDelayMs: 0,
    /** Called once when the next PUT starts receiving its body. */
    onPutStart: undefined as (() => void) | undefined,
    /** Awaited before each GET starts (e.g. to revoke authority while storage I/O is pending). */
    beforeGet: undefined as (() => Promise<void>) | undefined,
  };
  const stats = { puts: 0, gets: 0, heads: 0, activePuts: 0, peakPuts: 0 };
  let seq = 0;
  const server = createServer(async (request, response) => {
    const fail = (status: number, code?: string) => {
      response.writeHead(status, { "content-type": "application/xml" });
      response.end(code ? `<Error><Code>${code}</Code></Error>` : undefined);
    };
    try {
      const parts = decodeURIComponent((request.url ?? "").split("?")[0] ?? "")
        .split("/")
        .slice(1);
      if (parts[0] !== bucket) return fail(404, "NoSuchBucket");
      const key = parts.slice(1).join("/");
      if (!key) {
        response.writeHead(200);
        response.end();
        return;
      }
      const meta = (source: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(source).map(([k, v]) => [`x-amz-meta-${k}`, v]),
        );
      if (request.method === "PUT") {
        if (behavior.dropPuts > 0) {
          behavior.dropPuts--;
          request.socket.destroy();
          return;
        }
        if (behavior.failPuts > 0) {
          behavior.failPuts--;
          request.resume();
          return fail(500, "InternalError");
        }
        if (request.headers["if-none-match"] === "*" && objects.has(key)) {
          request.resume();
          return fail(412, "PreconditionFailed");
        }
        stats.puts++;
        stats.activePuts++;
        stats.peakPuts = Math.max(stats.peakPuts, stats.activePuts);
        behavior.onPutStart?.();
        behavior.onPutStart = undefined;
        const path = join(dir, String(seq++));
        let length = 0;
        try {
          await pipeline(
            request,
            async function* (source: AsyncIterable<Buffer>) {
              for await (const chunk of source) {
                length += chunk.byteLength;
                if (behavior.chunkDelayMs)
                  await Bun.sleep(behavior.chunkDelayMs);
                yield chunk;
              }
            },
            createWriteStream(path),
          );
        } finally {
          stats.activePuts--;
        }
        if (behavior.corruptStoredPut) {
          behavior.corruptStoredPut = false;
          const handle = await open(path, "r+");
          const at = Math.floor(length / 2);
          const byte = Buffer.alloc(1);
          await handle.read(byte, 0, 1, at);
          byte[0] = (byte[0] ?? 0) ^ 0xff;
          await handle.write(byte, 0, 1, at);
          await handle.close();
        }
        const stored: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers))
          if (name.startsWith("x-amz-meta-") && typeof value === "string")
            stored[name.slice("x-amz-meta-".length)] = value;
        objects.set(key, { path, length, meta: stored });
        if (behavior.losePutAck) {
          behavior.losePutAck = false;
          return fail(500, "InternalError");
        }
        response.writeHead(200, { etag: '"peer"' });
        response.end();
        return;
      }
      const found = objects.get(key);
      if (request.method === "HEAD") {
        stats.heads++;
        if (!found) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          "content-length": String(found.length),
          ...meta(found.meta),
        });
        response.end();
        return;
      }
      if (request.method === "GET") {
        stats.gets++;
        await behavior.beforeGet?.();
        if (!found) return fail(404, "NoSuchKey");
        const size = (await stat(found.path)).size;
        response.writeHead(200, {
          "content-length": String(found.length),
          ...meta(found.meta),
        });
        let sent = 0;
        for await (const chunk of createReadStream(found.path, {
          highWaterMark: 256 * 1024,
        }) as AsyncIterable<Buffer>) {
          if (behavior.chunkDelayMs) await Bun.sleep(behavior.chunkDelayMs);
          if (behavior.truncateGet && sent + chunk.byteLength > size / 2) {
            response.destroy();
            return;
          }
          let out = chunk;
          if (
            behavior.corruptGet &&
            sent <= size / 2 &&
            sent + chunk.byteLength > size / 2
          ) {
            out = Buffer.from(chunk);
            const index = Math.floor(size / 2) - sent;
            out[index] = (out[index] ?? 0) ^ 0xff;
          }
          sent += chunk.byteLength;
          if (!response.write(out))
            await new Promise((resolve) => response.once("drain", resolve));
        }
        response.end();
        return;
      }
      response.writeHead(405);
      response.end();
    } catch {
      if (!response.headersSent) fail(500, "InternalError");
      else response.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bucket,
    objects,
    behavior,
    stats,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
