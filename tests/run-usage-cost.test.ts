import { describe, expect, it } from "vitest";
import { calculateCost } from "../apps/server/node_modules/@earendil-works/pi-ai/dist/models.js";
import { openaiCodexProvider } from "../apps/server/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.js";
import { estimateCost } from "../packages/runs/src";
import type { ModelConfig, UsageReceipt } from "../packages/runs/src/schema";

/** Source-backed parity with the pinned Pi 1.0.0 `calculateCost` over its own Codex catalog prices. */
describe("estimated Run cost", () => {
  const catalog = openaiCodexProvider().getModels();
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
  it("matches Pi's own cost for every pinned Codex model, tier boundary and cache field", () => {
    expect(catalog.length).toBeGreaterThan(0);
    for (const model of catalog)
      for (const [input, output, cacheRead, cacheWrite] of cases) {
        const usage = {
          input,
          output,
          cacheRead,
          cacheWrite,
          totalTokens: input + output + cacheRead + cacheWrite,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
        const expected = calculateCost(model, usage).total;
        const actual = estimateCost(model.cost satisfies ModelConfig["cost"], [
          receipt(input, output, cacheRead, cacheWrite),
        ]);
        expect(
          actual,
          `${model.id} ${input}/${output}/${cacheRead}/${cacheWrite}`,
        ).toBeCloseTo(expected, 8);
      }
  });
  it("prices every message by its own request size and sums them deterministically", () => {
    const model = catalog.find((entry) => entry.id === "gpt-6.1-sol");
    if (!model) throw new Error("Pinned catalog lost the controlled model");
    const receipts = [
      receipt(10, 2, 0, 0),
      receipt(250000, 5, 50000, 0),
      receipt(400, 7, 100, 0),
    ];
    const once = estimateCost(model.cost, receipts);
    expect(once).toBe(estimateCost(model.cost, [...receipts]));
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
    const model = catalog.find((entry) => entry.id === "gpt-6.1-sol");
    if (!model) throw new Error("Pinned catalog lost the controlled model");
    // Old Runs have no accepted price: never Pi's default zero.
    expect(estimateCost(undefined, [receipt(10, 2, 0, 0)])).toBeNull();
    expect(estimateCost(model.cost, [])).toBeNull();
    const unreported = receipt(10, 2, 0, 0);
    unreported.tokens.cacheReadTokens = null;
    expect(
      estimateCost(model.cost, [receipt(10, 2, 0, 0), unreported]),
    ).toBeNull();
    expect(
      estimateCost({ ...model.cost, input: Number.POSITIVE_INFINITY }, [
        receipt(10, 2, 0, 0),
      ]),
    ).toBeNull();
    // Only the four priced counts matter: an unreported totalTokens does not make the estimate unknown.
    const noTotal = receipt(10, 2, 0, 0);
    noTotal.tokens.totalTokens = null;
    expect(estimateCost(model.cost, [noTotal])).toBeCloseTo(
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
