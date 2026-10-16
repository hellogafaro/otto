import { describe, expect, it } from "vite-plus/test";

import { matchesMemberSearch, parseSettingsSearch } from "./organization-members.logic";

describe("parseSettingsSearch", () => {
  it("keeps the members search", () => {
    expect(parseSettingsSearch({ q: "ada" })).toEqual({ q: "ada" });
  });

  it("falls back to no search when the URL is malformed", () => {
    expect(parseSettingsSearch({ q: 42 })).toEqual({});
  });
});

describe("matchesMemberSearch", () => {
  it("matches a name or email regardless of case and padding", () => {
    expect(matchesMemberSearch("  LOVELACE ", "Ada Lovelace", "ada@example.test")).toBe(true);
    expect(matchesMemberSearch("example.test", "Ada Lovelace", "ada@example.test")).toBe(true);
    expect(matchesMemberSearch("grace", "Ada Lovelace", "ada@example.test")).toBe(false);
  });

  it("matches everyone on an empty search", () => {
    expect(matchesMemberSearch("", "Ada Lovelace")).toBe(true);
  });
});
