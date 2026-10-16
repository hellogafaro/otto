import { describe, expect, it } from "vite-plus/test";

import {
  matchesMemberSearch,
  parseSettingsSearch,
  splitPersonName,
} from "./organization-members.logic";

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

describe("splitPersonName", () => {
  it("takes the first word as the first name and the rest as the last name", () => {
    expect(splitPersonName(" Ana  María Lopez ")).toEqual({ first: "Ana", last: "María Lopez" });
  });

  it("leaves the last name empty for a single word", () => {
    expect(splitPersonName("Ana")).toEqual({ first: "Ana", last: "" });
  });
});
