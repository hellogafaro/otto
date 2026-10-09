import { describe, expect, it } from "vitest";
import { estimateCost } from "../packages/runs/src";
import type { ModelConfig, UsageReceipt } from "../packages/runs/src/schema";

describe("estimated Run cost", () => {
  const cost: NonNullable<ModelConfig["cost"]> = {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 1,
    tiers: [
      {
        inputTokensAbove: 272000,
        input: 4,
        output: 15,
        cacheRead: 0.2,
        cacheWrite: 2,
      },
    ],
  };
  const receipt = (
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
  ): UsageReceipt => ({
    attempt: 1,
    sequence: 1,
    tokens: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens:
        inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    },
  });
  // Includes the 272000 tier edge: the threshold applies to input + cacheRead + cacheWrite, strictly above.
  const cases = [
    [0, 0, 0, 0],
    [10, 2, 0, 0],
    [1234, 567, 89, 12],
    [271999, 100, 0, 0],
    [272000, 100, 0, 0],
    [272001, 100, 0, 0],
    [200000, 5000, 72000, 0],
    [200000, 5000, 72001, 0],
    [100000, 5000, 100000, 72001],
    [1_000_000, 50_000, 500_000, 250_000],
  ] as const;
  it("prices accepted deterministic rates at the strict tier boundary including both cache fields", () => {
    for (const [input, output, cacheRead, cacheWrite] of cases) {
      const high = input + cacheRead + cacheWrite > 272000;
      const expected =
        (input * (high ? 4 : 2) +
          output * (high ? 15 : 10) +
          cacheRead * (high ? 0.2 : 0.1) +
          cacheWrite * (high ? 2 : 1)) /
        1e6;
      const actual = estimateCost(cost, [
        receipt(input, output, cacheRead, cacheWrite),
      ]);
      expect(
        actual,
        `${input}/${output}/${cacheRead}/${cacheWrite}`,
      ).toBeCloseTo(expected, 8);
    }
  });
  it("prices every message by its own request size and sums them deterministically", () => {
    const receipts = [
      receipt(10, 2, 0, 0),
      receipt(250000, 5, 50000, 0),
      receipt(400, 7, 100, 0),
    ];
    const once = estimateCost(cost, receipts);
    expect(once).toBe(estimateCost(cost, [...receipts]));
    // The middle request crosses 272000 and is repriced in full at the higher tier; the others stay at base.
    expect(once).toBeCloseTo(
      (10 * 2 +
        2 * 10 +
        (250000 * 4 + 5 * 15 + 50000 * 0.2) +
        (400 * 2 + 7 * 10 + 100 * 0.1)) /
        1e6,
      9,
    );
  });
  it("stays unknown for a missing price basis, an unreported count, no receipts or non-finite input", () => {
    // Old Runs have no accepted price: never Pi's default zero.
    expect(estimateCost(undefined, [receipt(10, 2, 0, 0)])).toBeNull();
    expect(estimateCost(cost, [])).toBeNull();
    const unreported = receipt(10, 2, 0, 0);
    unreported.tokens.cacheReadTokens = null;
    expect(estimateCost(cost, [receipt(10, 2, 0, 0), unreported])).toBeNull();
    expect(
      estimateCost({ ...cost, input: Number.POSITIVE_INFINITY }, [
        receipt(10, 2, 0, 0),
      ]),
    ).toBeNull();
    // Only the four priced counts matter: an unreported totalTokens does not make the estimate unknown.
    const noTotal = receipt(10, 2, 0, 0);
    noTotal.tokens.totalTokens = null;
    expect(estimateCost(cost, [noTotal])).toBeCloseTo(
      (10 * 2 + 2 * 10) / 1e6,
      9,
    );
    // A genuinely free price is a priced zero, distinct from an unknown one.
    expect(
      estimateCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, [
        receipt(10, 2, 0, 0),
      ]),
    ).toBe(0);
  });
});
