import { describe, expect, it } from "vite-plus/test";

import { tabJumpDigit } from "./desktop-tab-strip";

describe("tabJumpDigit", () => {
  it("numbers tabs 1–8 by position and gives 9 to the last tab", () => {
    expect([0, 1, 2].map((index) => tabJumpDigit(index, 3))).toEqual([1, 2, 3]);
    expect(Array.from({ length: 11 }, (_, index) => tabJumpDigit(index, 11))).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      null,
      null,
      9,
    ]);
  });
});
