import { describe, expect, it } from "@effect/vitest";
import { encodeMemoryArchiveJson } from "./memory/memory-archive-json.ts";
import { stripDefaultServerSettings } from "./server-settings-persistence.ts";

describe("opaque metadata serialization", () => {
  it("preserves non-finite metadata until JSON serialization", () => {
    const metadata = {
      z: [Number.POSITIVE_INFINITY, undefined],
      a: { z: Number.NaN, a: Number.NEGATIVE_INFINITY },
      omitted: undefined,
    };

    expect(encodeMemoryArchiveJson(metadata)).toBe('{"a":{"a":null,"z":null},"z":[null,null]}');
    expect(stripDefaultServerSettings(metadata, { z: [], a: { z: 0, a: 0 } })).toEqual({
      z: [Number.POSITIVE_INFINITY, undefined],
      a: { z: Number.NaN, a: Number.NEGATIVE_INFINITY },
    });
  });
});
