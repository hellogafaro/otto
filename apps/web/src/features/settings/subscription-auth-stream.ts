import { z } from "zod";
import type { LoginEvent } from "../../../../server/src/subscription-login";

const loginEvent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("device_code"),
      verificationUri: z.url().max(2048),
      userCode: z.string().min(1).max(200),
      expiresInSeconds: z.number().int().positive().max(3600),
    })
    .strict(),
  z
    .object({ type: z.literal("connected"), provider: z.literal("codex") })
    .strict(),
  z
    .object({ type: z.literal("error"), code: z.literal("login_failed") })
    .strict(),
]);
function parseEvent(line: string): LoginEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("The authentication service returned an invalid event.");
  }
  const parsed = loginEvent.safeParse(value);
  if (!parsed.success)
    throw new Error("The authentication service returned an invalid event.");
  const event = parsed.data;
  if (event.type === "device_code") {
    const uri = new URL(event.verificationUri);
    if (uri.protocol !== "https:" || uri.username || uri.password)
      throw new Error(
        "The authentication service returned an unsafe verification link.",
      );
  }
  return event;
}

/** Consume the server's bounded NDJSON contract; only its connected event confirms authentication. */
export async function consumeLoginEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: LoginEvent) => void | Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let events = 0;
  let connected = false;
  let deviceReceived = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        buffer += decoder.decode();
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > 65536)
        throw new Error("The authentication response exceeded its limit.");
      buffer += decoder.decode(part.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
          if (++events > 8 || connected)
            throw new Error("The authentication stream was invalid.");
          const event = parseEvent(line);
          if (event.type === "error")
            throw new Error("Authentication failed. Retry with this account.");
          if (event.type === "device_code") {
            if (deviceReceived)
              throw new Error(
                "The authentication stream repeated its device code.",
              );
            deviceReceived = true;
          } else connected = true;
          await onEvent(event);
        }
        newline = buffer.indexOf("\n");
      }
    }
    if (buffer.trim() || !connected)
      throw new Error(
        "Authentication ended without confirmation. Check the account status before retrying.",
      );
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
