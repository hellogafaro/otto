import { ProviderInstanceId, type ModelSelection } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveTurnModelSelection, type TurnProviderSnapshot } from "./turn-provider-selection.ts";

const codex: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};

const grok: ModelSelection = {
  instanceId: ProviderInstanceId.make("grok"),
  model: "grok-4",
};

const providers: ReadonlyArray<TurnProviderSnapshot> = [
  { instanceId: "codex", enabled: false, driver: "codex", status: "disabled" },
  {
    instanceId: "grok",
    enabled: true,
    driver: "grok",
    models: [{ slug: "grok-4", isDefault: true }],
  },
];

describe("resolveTurnModelSelection", () => {
  it("skips a stored Codex leftover and runs the live provider", () => {
    expect(
      resolveTurnModelSelection({
        requested: codex,
        stored: codex,
        liveDefault: grok,
        isBotThread: true,
        providers,
      }),
    ).toEqual(grok);
  });

  it("runs another enabled provider when the saved default is the leftover too", () => {
    expect(
      resolveTurnModelSelection({
        requested: codex,
        stored: codex,
        liveDefault: codex,
        isBotThread: true,
        providers,
      }),
    ).toEqual(grok);
  });

  it("does not inspect a missing Codex instance when Grok is on", () => {
    expect(
      resolveTurnModelSelection({
        stored: codex,
        liveDefault: codex,
        isBotThread: true,
        providers: [
          {
            instanceId: "grok",
            enabled: true,
            driver: "grok",
            models: [{ slug: "grok-4", isDefault: true }],
          },
        ],
      }),
    ).toEqual(grok);
  });

  it("keeps a saved bot engine even when that provider is off", () => {
    expect(
      resolveTurnModelSelection({
        botEngine: { provider: "codex", model: "gpt-5-codex" },
        requested: grok,
        stored: codex,
        liveDefault: grok,
        isBotThread: true,
        providers,
      }),
    ).toEqual(codex);
  });

  it("keeps an explicit choice of a different provider", () => {
    expect(
      resolveTurnModelSelection({
        requested: grok,
        stored: codex,
        liveDefault: codex,
        isBotThread: true,
        providers,
      }),
    ).toEqual(grok);
  });

  it("does not guess from an incomplete provider list", () => {
    expect(
      resolveTurnModelSelection({
        requested: codex,
        stored: codex,
        liveDefault: grok,
        isBotThread: true,
        providers: [{ instanceId: "codex" }],
      }),
    ).toEqual(grok);
  });
});
