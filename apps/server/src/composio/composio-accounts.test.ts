import { COMPOSIO_BOT_ACCESS_DEFAULT } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composioAccountServesBot, type ComposioAccountRecord } from "./composio-accounts.ts";

const account = (
  visibility: "user" | "organization",
  botAccess: Record<string, boolean> = {},
): ComposioAccountRecord => ({
  connectionId: "gmail",
  createdBy: "ana",
  createdByName: "Ana",
  label: null,
  visibility,
  botAccess,
});

describe("composioAccountServesBot", () => {
  it("keeps an older team account on and an older personal account with its owner", () => {
    expect(
      composioAccountServesBot(account("organization"), {
        botId: "bot-1",
        ownerPersonId: "ben",
      }),
    ).toBe(true);
    expect(
      composioAccountServesBot(account("user"), { botId: "bot-1", ownerPersonId: "ana" }),
    ).toBe(true);
    expect(
      composioAccountServesBot(account("user"), { botId: "bot-1", ownerPersonId: "ben" }),
    ).toBe(false);
  });

  it("starts a new account off for every bot until someone turns it on", () => {
    const added = account("organization", { [COMPOSIO_BOT_ACCESS_DEFAULT]: false });
    const personal = account("user", { [COMPOSIO_BOT_ACCESS_DEFAULT]: false });

    expect(composioAccountServesBot(added, { botId: "bot-1", ownerPersonId: "ana" })).toBe(false);
    expect(composioAccountServesBot(personal, { botId: "bot-1", ownerPersonId: "ana" })).toBe(
      false,
    );
    expect(
      composioAccountServesBot(
        account("organization", { [COMPOSIO_BOT_ACCESS_DEFAULT]: false, "bot-1": true }),
        { botId: "bot-1", ownerPersonId: "ben" },
      ),
    ).toBe(true);
  });
});
