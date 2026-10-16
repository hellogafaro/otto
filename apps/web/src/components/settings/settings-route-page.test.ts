import { catalogRegistry, createTranslator } from "@otto/client-runtime/i18n";
import { describe, expect, it } from "vite-plus/test";

import { settingsSectionLabel } from "./settings-dialog";

describe("settingsSectionLabel", () => {
  it("matches the nav label instead of title-casing the section", () => {
    expect(settingsSectionLabel("providers")).toBe("Models");
    expect(settingsSectionLabel("memory")).toBe("Memory");
  });

  it("returns a catalog key the breadcrumb translates", async () => {
    const { t } = createTranslator("zh-CN", await catalogRegistry["zh-CN"]!());
    expect(t(settingsSectionLabel("providers"))).toBe("模型");
    expect(t(settingsSectionLabel("memory"))).toBe("记忆");
  });
});
