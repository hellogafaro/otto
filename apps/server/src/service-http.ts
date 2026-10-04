import { DomainError, withCleanup } from "@otto/shared";

/** Private service responses are bounded before parsing; errors never include credential/provider bodies. */
export async function readServiceJson(
  response: Response,
  maxBytes = 65536,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new DomainError("unavailable", "Service response unavailable");
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return withCleanup(
    async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes)
            throw new DomainError("unavailable", "Service response limit");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return JSON.parse(text);
      } catch {
        throw new DomainError(
          "unavailable",
          "Service response unavailable or invalid",
        );
      }
    },
    async () => {
      try {
        await reader.cancel();
      } catch {
        throw new DomainError(
          "unavailable",
          "Service response cleanup unconfirmed",
        );
      } finally {
        reader.releaseLock();
      }
    },
  );
}
export function privateEndpoint(value: string, allowLoopbackHttp = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        allowLoopbackHttp &&
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new DomainError("invalid", "Invalid private service endpoint");
  return url;
}
