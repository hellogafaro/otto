import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";

describe("buildThreadTitleRegenerationMenuItems", () => {
  it("hides regeneration when the environment does not advertise support", () => {
    expect(
      buildThreadTitleRegenerationMenuItems({ supported: false, isRegenerating: false }),
    ).toEqual([]);
  });

  it("offers regeneration for a supported environment", () => {
    expect(
      buildThreadTitleRegenerationMenuItems({ supported: true, isRegenerating: false }),
    ).toEqual([
      {
        id: "regenerate-title",
        title: "Regenerate title",
        image: "remix_refresh_line",
      },
    ]);
  });

  it("shows and disables the pending state", () => {
    expect(
      buildThreadTitleRegenerationMenuItems({ supported: true, isRegenerating: true }),
    ).toEqual([
      {
        id: "regenerate-title",
        title: "Regenerating…",
        image: "remix_refresh_line",
        attributes: { disabled: true },
      },
    ]);
  });
});
