import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { buttonVariants } from "../ui/button";

describe("NewBotDialog", () => {
  const source = NodeFS.readFileSync(new URL("./NewBotDialog.tsx", import.meta.url), "utf8");

  it("requires a name and blocks creation until there is one", () => {
    expect(source).toContain("required");
    expect(source).toContain("disabled={submitting || trimmedName.length === 0}");
  });

  it("creates with the primary action and closes from the corner, with no Cancel", () => {
    expect(source).toContain('variant="primary"');
    expect(buttonVariants({ variant: "primary" })).toContain("bg-(--primary-button-background)");
    expect(source).not.toContain('t("Cancel")');
  });

  it("starts on the app default model and creates the bot with the picked engine", () => {
    expect(source).toContain("useState<BotEngine | null>(null)");
    expect(source).toContain("useBotEngineAvailability(engine)");
    expect(source).toContain("<BotModelPicker");
    expect(source).toContain("<TraitsPicker");
    expect(source).toContain("onCreate({ name: trimmedName, avatar, engine })");
  });

  it("warns when no provider can run the picked model", () => {
    expect(source).toContain("<ProviderUnavailableNotice");
  });
});
