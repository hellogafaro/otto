import { SETTINGS_DEEP_LINK_IDS } from "@otto/client-runtime/settings-deep-link";
import { describe, expect, it } from "vite-plus/test";

import { parseSettingsDeepLink } from "./settings-deep-link";
import { SETTINGS_SECTIONS } from "./settings-dialog-store";

describe("settings deep links", () => {
  it.each([
    ["general", "general", null, "General"],
    ["usage", "usage", null, "Usage"],
    ["local-execution", "computer", "local-execution", "Computer > Local execution"],
    ["appearance", "appearance", null, "Appearance"],
    ["keybindings", "keybindings", null, "Shortcuts"],
    ["account", "account", null, "Profile"],
    ["organization", "organization", null, "Organization"],
    ["members", "members", null, "Members"],
    ["providers", "models", null, "Models"],
    ["channels", "channels", null, "Channels"],
    ["voice", "voice", null, "Voice"],
    ["image-generation", "models", "image-generation", "Models > Image generation"],
    ["browser", "computer", "browser", "Computer > Browser"],
    ["plugins", "customize", null, "Customize"],
    ["sandbox", "computer", null, "Computer"],
    ["privacy", "memory", null, "Memory"],
    ["archived-chats", "archived", null, "Archived chats"],
    ["connections", "general", null, "General"],
    ["source-control", "general", null, "General"],
    ["bot-inbox", "general", null, "General"],
    ["diagnostics", "general", null, "General"],
  ] as const)("maps %s to %s and target %s", (id, section, targetId, label) => {
    expect(parseSettingsDeepLink(`grokbot://app/v1/settings?id=${id}`)).toEqual({
      section,
      targetId,
      label,
    });
  });

  it("maps every shared id", () => {
    for (const id of SETTINGS_DEEP_LINK_IDS) {
      expect(parseSettingsDeepLink(`grokbot://app/v1/settings?id=${id}`), id).not.toBeNull();
    }
  });

  it("reaches every Settings section", () => {
    const reached = new Set(
      SETTINGS_DEEP_LINK_IDS.map(
        (id) => parseSettingsDeepLink(`grokbot://app/v1/settings?id=${id}`)?.section,
      ),
    );

    expect([...SETTINGS_SECTIONS].filter((section) => !reached.has(section))).toEqual([
      "integrations",
      "bots",
      "skills",
    ]);
  });

  it("uses General for a bare Settings link", () => {
    expect(parseSettingsDeepLink("grokbot://app/v1/settings")).toMatchObject({
      section: "general",
      targetId: null,
    });
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=")).toMatchObject({
      section: "general",
    });
  });

  it.each([
    ["missing href", undefined],
    ["unparseable href", "not a url"],
    ["wrong scheme", "https://app/v1/settings?id=providers"],
    ["lookalike scheme", "grokbots://app/v1/settings?id=providers"],
    ["wrong host", "grokbot://evil/v1/settings?id=providers"],
    ["wrong path", "grokbot://app/v1/not-settings?id=providers"],
    ["wrong version", "grokbot://app/v2/settings?id=providers"],
    ["trailing slash", "grokbot://app/v1/settings/?id=providers"],
    ["fragment", "grokbot://app/v1/settings?id=providers#access"],
    ["duplicate id", "grokbot://app/v1/settings?id=providers&id=general"],
    ["extra query key", "grokbot://app/v1/settings?id=providers&from=chat"],
    ["only an extra key", "grokbot://app/v1/settings?from=chat"],
    ["unknown id", "grokbot://app/v1/settings?id=unknown"],
    ["removed access matrix", "grokbot://app/v1/settings?id=provider-access"],
    ["section name instead of id", "grokbot://app/v1/settings?id=inbox"],
  ])("rejects %s", (_label, href) => {
    expect(parseSettingsDeepLink(href)).toBeNull();
  });
});
