import { DomainError, withCleanup } from "@otto/shared";

export const MAX_OUTPUT_BYTES = 256 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
export interface HttpOptions {
  /** Exact origins are deployment configuration, never supplied by a tool call. */
  allowedOrigins: readonly string[];
  /** Only explicit test/private-service composition may opt into loopback HTTP. */
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export class ProviderError extends Error {
  constructor(readonly status: number | null = null) {
    super("Connection provider request failed");
  }
}
export function checkEndpoint(url: URL, options: HttpOptions) {
  if (
    url.username ||
    url.password ||
    url.hash ||
    !options.allowedOrigins.includes(url.origin) ||
    (url.protocol !== "https:" &&
      !(
        options.allowLoopbackHttp &&
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new DomainError("forbidden", "Connection endpoint is not allowed");
}
/** One bounded request; redirects and automatic retries would change credential scope or repeat writes. */
export async function requestHttp<T>(
  url: URL,
  init: RequestInit,
  options: HttpOptions,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  checkEndpoint(url, options);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(options.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
  );
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted || options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(response.status);
    }
    return await consume(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // Never attach request/response bodies, headers, URLs, secrets or raw provider errors.
    throw new ProviderError();
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
    options.signal?.removeEventListener("abort", abort);
  }
}
export async function readText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  await withCleanup(
    async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_OUTPUT_BYTES) throw new ProviderError();
        chunks.push(value);
      }
    },
    async () => {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    },
  );
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await readText(response));
}
