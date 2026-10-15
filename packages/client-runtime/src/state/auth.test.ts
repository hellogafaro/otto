import { AuthSessionId } from "@otto/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { applyAuthAccessStreamEvent, EMPTY_AUTH_ACCESS_SNAPSHOT } from "./auth.ts";

const clientSession = (sessionId: string, label: string) =>
  ({
    sessionId: AuthSessionId.make(sessionId),
    subject: "subject",
    scopes: ["orchestration:read"],
    method: "browser-session-cookie",
    client: {
      label,
      deviceType: "mobile",
    },
    issuedAt: DateTime.makeUnsafe("2036-04-07T00:00:00.000Z"),
    expiresAt: DateTime.makeUnsafe("2036-05-07T00:00:00.000Z"),
    lastConnectedAt: null,
    connected: true,
    current: false,
  }) as const;

describe("applyAuthAccessStreamEvent", () => {
  it("accumulates rapid client updates into one snapshot", () => {
    const phone = clientSession("session-phone", "Phone");

    const laptop = clientSession("session-laptop", "Laptop");

    const withPhone = applyAuthAccessStreamEvent(EMPTY_AUTH_ACCESS_SNAPSHOT, {
      version: 1,
      revision: 1,
      type: "clientUpserted",
      payload: phone,
    });

    const withBoth = applyAuthAccessStreamEvent(withPhone, {
      version: 1,
      revision: 2,
      type: "clientUpserted",
      payload: laptop,
    });

    expect(withBoth).toEqual({ clientSessions: [phone, laptop] });
  });

  it("applies removals without disturbing unrelated access state", () => {
    const laptop = clientSession("session-laptop", "Laptop");

    const snapshot = applyAuthAccessStreamEvent(
      { clientSessions: [clientSession("session-phone", "Phone"), laptop] },
      {
        version: 1,
        revision: 2,
        type: "clientRemoved",
        payload: { sessionId: AuthSessionId.make("session-phone") },
      },
    );

    expect(snapshot).toEqual({ clientSessions: [laptop] });
  });
});
