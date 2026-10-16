import { describe, expect, it } from "vite-plus/test";

import {
  searchableSetting,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settings-search";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/computer",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/models",
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("finds Usage and its metrics in the App settings section", () => {
    for (const query of ["Usage", "limits", "quota", "tokens", "cost"]) {
      expect(searchSettings(query)).toContainEqual(
        expect.objectContaining({ id: "usage", to: "/settings/usage" }),
      );
    }
  });

  it("finds language by English aliases and translated titles without changing its destination", () => {
    for (const query of [
      "language",
      "locale",
      "translation",
      "English",
      "system default",
      "简体中文",
      "中文",
    ]) {
      expect(searchSettings(query)).toContainEqual(
        expect.objectContaining({
          id: "language",
          to: "/settings/general",
          title: "Language",
        }),
      );
    }

    expect(
      searchSettings("langue", undefined, (title) => (title === "Language" ? "Langue" : title)),
    ).toEqual([expect.objectContaining({ id: "language", to: "/settings/general" })]);
    expect(searchableSetting("language")).toEqual({ id: "language", title: "Language" });
  });
  it("matches only setting titles", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("connections", ITEMS)).toEqual([]);
    expect(searchSettings("claude", ITEMS)).toEqual([]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual([]);
    expect(searchSettings("local execution")).toEqual([]);
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("finds bot channels by provider name", () => {
    for (const query of ["telegram", "imessage", "photon", "whatsapp"]) {
      expect(searchSettings(query).map((item) => item.id)).toContain("bot-channels");
    }
  });

  it("finds bot channels by channel repair words", () => {
    for (const query of ["Channels", "channel", "webhook", "credentials", "messaging"]) {
      expect(searchSettings(query).map((item) => item.id)).toContain("bot-channels");
    }
  });

  it("keeps catalog order for multiple title matches", () => {
    expect(searchSettings("update", ITEMS).map((item) => item.id)).toEqual([
      "provider-updates",
      "automatic-updates",
    ]);
  });

  it("returns no results for an empty query", () => {
    expect(searchSettings("   ", ITEMS)).toEqual([]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("quit confirmation")).toEqual([]);
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves anchor props to panels from the catalog", () => {
    expect(searchableSetting("code-font-size")).toEqual({
      id: "code-font-size",
      title: "Code font size",
    });
  });

  it("routes bot computers to the Computer page", () => {
    expect(searchSettings("bot computers")[0]).toMatchObject({
      id: "sandbox-browser-sharing",
      to: "/settings/computer",
    });
  });

  it("routes voice to the Voice page without offering a fallback model control", () => {
    expect(searchSettings("voice provider")[0]).toMatchObject({
      id: "voice-provider",
      to: "/settings/voice",
    });
    expect(searchSettings("fallback model")).not.toContainEqual(
      expect.objectContaining({ id: "text-generation-model" }),
    );
  });

  it("has no Advanced page or diagnostics left to find", () => {
    expect(SETTINGS_SEARCH_ITEMS.map((item) => item.to)).not.toContain("/settings/advanced");
    expect(searchSettings("diagnostics")).toEqual([]);
  });

  it("drops coding-agent leftovers from the index", () => {
    const ids: ReadonlyArray<string> = SETTINGS_SEARCH_ITEMS.map((item) => item.id);

    for (const id of [
      "hide-whitespace-changes",
      "skills-in-slash-menu",
      "add-project-starts-in",
      "source-control",
      "archive",
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it("routes sandbox provider settings to Computer settings", () => {
    expect(searchSettings("default sandbox")[0]).toMatchObject({
      id: "default-sandbox",
      to: "/settings/computer",
    });
  });

  it("routes appearance settings to their current section", () => {
    expect(searchSettings("theme")).toEqual([]);
    expect(searchSettings("color scheme")[0]).toMatchObject({
      id: "color-scheme",
      to: "/settings/appearance",
    });
    expect(searchSettings("code font size")[0]).toMatchObject({
      id: "code-font-size",
      to: "/settings/appearance",
    });
  });

  it("routes memory controls to Memory settings", () => {
    expect(searchSettings("ask before saving")[0]).toMatchObject({
      id: "memory-shared-project",
      to: "/settings/memory",
    });
    expect(searchSettings("private bot memory")[0]).toMatchObject({
      id: "memory-private-bot",
      to: "/settings/memory",
    });
  });

  it("finds image generation on the Images page", () => {
    expect(searchSettings("image generation")[0]).toMatchObject({
      id: "image-generation",
      to: "/settings/images",
    });
    expect(searchSettings("Grok images")[0]).toMatchObject({
      id: "image-provider-grok",
      to: "/settings/images",
    });
    expect(searchSettings("image fallback")[0]).toMatchObject({
      id: "image-default-provider",
      to: "/settings/images",
    });
  });
});
