import { describe, expect, it } from "vitest";
import { createSettingsAttempt } from "./creation-attempt";

const decode = async (response: Response) => {
  if (!response.ok) throw new Error(`Rejected ${response.status}`);
  return response.json() as Promise<{ id: string }>;
};
const record = () => Response.json({ id: "returned-record" });

describe("settings creation acknowledgment guard", () => {
  it("does not dispatch again after a lost response, even after reset", async () => {
    const attempt = createSettingsAttempt();
    let calls = 0;
    const request = async () => {
      calls++;
      throw new TypeError("Connection closed after server commit");
    };
    await expect(attempt.send(request, decode)).rejects.toThrow(
      "Unable to confirm creation",
    );
    attempt.reset();
    await expect(attempt.send(request, decode)).rejects.toThrow(
      "Creation cannot be repeated",
    );
    expect(calls).toBe(1);
    expect(attempt.blocked).toBe(true);
  });

  it("blocks another POST while an acknowledgment is pending", async () => {
    const attempt = createSettingsAttempt();
    let finish: (response: Response) => void = () => {};
    const pending = attempt.send(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      decode,
    );
    let duplicate = false;
    await expect(
      attempt.send(async () => {
        duplicate = true;
        return record();
      }, decode),
    ).rejects.toThrow("Creation cannot be repeated");
    finish(record());
    expect(await pending).toEqual({ id: "returned-record" });
    expect(duplicate).toBe(false);
  });

  it("permits correction after a definite server rejection", async () => {
    const attempt = createSettingsAttempt();
    await expect(
      attempt.send(async () => new Response(null, { status: 403 }), decode),
    ).rejects.toThrow("Rejected 403");
    expect(attempt.blocked).toBe(false);
    expect(await attempt.send(async () => record(), decode)).toEqual({
      id: "returned-record",
    });
  });

  it("keeps server errors uncertain rather than assuming rollback", async () => {
    const attempt = createSettingsAttempt();
    await expect(
      attempt.send(async () => new Response(null, { status: 500 }), decode),
    ).rejects.toThrow("Unable to confirm creation");
    expect(attempt.blocked).toBe(true);
  });

  it("keeps an undecodable successful ACK uncertain without echoing its body", async () => {
    const attempt = createSettingsAttempt();
    const failure = await attempt
      .send(
        async () => new Response("fixture-private-marker", { status: 200 }),
        decode,
      )
      .catch((cause: unknown) => cause);
    expect(failure).toEqual(
      new Error(
        "Unable to confirm creation. Check the current records; the request may already have created one.",
      ),
    );
    expect(attempt.blocked).toBe(true);
  });

  it("requires completed-form reset after decoded success", async () => {
    const attempt = createSettingsAttempt();
    await attempt.send(async () => record(), decode);
    expect(attempt.blocked).toBe(true);
    await expect(attempt.send(async () => record(), decode)).rejects.toThrow(
      "Creation cannot be repeated",
    );
    attempt.reset();
    expect(attempt.blocked).toBe(false);
    expect(await attempt.send(async () => record(), decode)).toEqual({
      id: "returned-record",
    });
  });
});
