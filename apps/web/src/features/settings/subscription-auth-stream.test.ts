import { describe, expect, it } from "vitest";
import { consumeLoginEvents } from "./subscription-auth-stream";

const device = {
  type: "device_code",
  verificationUri: "https://auth.example.test/device",
  userCode: "FIXTURE-CODE",
  expiresInSeconds: 120,
};
const connected = { type: "connected", provider: "codex" };
function stream(parts: string[], cancel?: () => void) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
    cancel,
  });
}
describe("Subscription device authentication transport", () => {
  it("consumes split NDJSON and confirms only the exact Codex connected event", async () => {
    const text = `${JSON.stringify(device)}\n${JSON.stringify(connected)}\n`;
    const observed: unknown[] = [];
    await consumeLoginEvents(
      stream([text.slice(0, 13), text.slice(13, 83), text.slice(83)]),
      (event) => {
        observed.push(event);
      },
    );
    expect(observed).toEqual([device, connected]);
  });
  it("refuses a closed stream without server confirmation", async () => {
    await expect(
      consumeLoginEvents(stream([`${JSON.stringify(device)}\n`]), () => {}),
    ).rejects.toThrow("without confirmation");
  });
  it("refuses a different provider and credential-bearing unexpected fields without echoing them", async () => {
    for (const value of [
      { ...connected, provider: "another-provider" },
      { ...connected, credential: "FIXTURE-PRIVATE" },
    ]) {
      await expect(
        consumeLoginEvents(stream([`${JSON.stringify(value)}\n`]), () => {}),
      ).rejects.toThrow("invalid event");
    }
  });
  it("does not echo a malformed upstream body in its error", async () => {
    try {
      await consumeLoginEvents(stream(["FIXTURE-PRIVATE\n"]), () => {});
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("invalid event");
      expect(String(error)).not.toContain("FIXTURE-PRIVATE");
    }
  });
  it("refuses unsafe verification URLs before displaying a device code", async () => {
    for (const verificationUri of [
      "javascript:alert(1)",
      "http://auth.example.test/device",
      "https://user:password@auth.example.test/device",
    ]) {
      const observed: unknown[] = [];
      await expect(
        consumeLoginEvents(
          stream([`${JSON.stringify({ ...device, verificationUri })}\n`]),
          (event) => {
            observed.push(event);
          },
        ),
      ).rejects.toThrow("unsafe verification link");
      expect(observed).toEqual([]);
    }
  });
  it("reports the server login failure instead of a successful connection", async () => {
    await expect(
      consumeLoginEvents(
        stream(['{"type":"error","code":"login_failed"}\n']),
        () => {},
      ),
    ).rejects.toThrow("Authentication failed");
  });
  it("refuses duplicated codes and events after confirmation", async () => {
    for (const values of [
      [device, device],
      [connected, connected],
    ])
      await expect(
        consumeLoginEvents(
          stream([
            `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
          ]),
          () => {},
        ),
      ).rejects.toThrow();
  });
  it("bounds bytes and cancels a rejected stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65537));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(consumeLoginEvents(body, () => {})).rejects.toThrow(
      "exceeded its limit",
    );
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
