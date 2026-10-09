import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { DomainError } from "@otto/shared";
import {
  type NativeModelConfig,
  providerBaseUrl,
} from "./native-provider-config";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicProviderAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

export function providerRequestUrl(config: NativeModelConfig, value: string) {
  const base = providerBaseUrl(config.baseUrl);
  const url = new URL(value);
  const suffix =
    config.protocol === "responses"
      ? "/responses"
      : config.protocol === "chat-completions"
        ? "/chat/completions"
        : "/messages";
  if (url.href !== `${base}${suffix}`)
    throw new DomainError("forbidden", "Provider request endpoint mismatch");
  return url;
}

export function createProviderFetch(
  config: NativeModelConfig,
  parentSignal: AbortSignal,
  authorize: () => Promise<void>,
): typeof globalThis.fetch {
  return Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const source = input instanceof Request ? input : null;
      const url = providerRequestUrl(config, source?.url ?? String(input));
      const signal = AbortSignal.any([
        parentSignal,
        ...(init?.signal
          ? [init.signal]
          : source?.signal
            ? [source.signal]
            : []),
        AbortSignal.timeout(300000),
      ]);
      signal.throwIfAborted();
      await authorize();
      const addresses = await lookup(url.hostname, {
        all: true,
        verbatim: true,
      });
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicProviderAddress(address))
      )
        throw new DomainError(
          "forbidden",
          "Provider endpoint must resolve to public addresses",
        );
      signal.throwIfAborted();
      await authorize();
      const pinned = addresses[0];
      if (!pinned) throw new DomainError("unavailable");
      const method = init?.method ?? source?.method ?? "GET";
      if (method !== "POST")
        throw new DomainError("forbidden", "Provider request method mismatch");
      const headers = new Headers(init?.headers ?? source?.headers);
      headers.delete("host");
      const body = init?.body ?? (source ? await source.text() : undefined);
      if (body !== undefined && body !== null && typeof body !== "string")
        throw new DomainError("invalid", "Provider request body invalid");
      return new Promise<Response>((resolve, reject) => {
        const outgoing = request(
          url,
          {
            method,
            headers: Object.fromEntries(headers),
            signal,
            agent: false,
            family: pinned.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, pinned.address, pinned.family),
          },
          (incoming) => {
            const status = incoming.statusCode ?? 502;
            if (status < 200 || status >= 300) {
              incoming.destroy();
              resolve(
                new Response(
                  '{"error":{"message":"Provider request failed"}}',
                  {
                    status: status >= 300 && status <= 599 ? status : 502,
                    headers: { "content-type": "application/json" },
                  },
                ),
              );
              return;
            }
            const responseHeaders = new Headers();
            const contentType = incoming.headers["content-type"];
            if (typeof contentType === "string")
              responseHeaders.set("content-type", contentType);
            let bytes = 0;
            const responseBody = (
              Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
            ).pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  bytes += chunk.byteLength;
                  if (bytes > 16 * 1024 * 1024)
                    throw new DomainError(
                      "unavailable",
                      "Provider response size limit",
                    );
                  controller.enqueue(chunk);
                },
              }),
            );
            resolve(
              new Response(responseBody, { status, headers: responseHeaders }),
            );
          },
        );
        outgoing.on("error", () =>
          reject(new DomainError("unavailable", "Provider transport failed")),
        );
        outgoing.end(body);
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
}
