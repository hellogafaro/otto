import { describe, expect, it } from "@effect/vitest";
import { stripDefaultServerSettings } from "./server-settings-persistence.ts";

describe("opaque metadata serialization", () => {
  it("preserves non-finite metadata until JSON serialization", () => {
    const metadata = {
      z: [Number.POSITIVE_INFINITY, undefined],
      a: { z: Number.NaN, a: Number.NEGATIVE_INFINITY },
      omitted: undefined,
    };

    expect(stripDefaultServerSettings(metadata, { z: [], a: { z: 0, a: 0 } })).toEqual({
      z: [Number.POSITIVE_INFINITY, undefined],
      a: { z: Number.NaN, a: Number.NEGATIVE_INFINITY },
    });
  });
});
