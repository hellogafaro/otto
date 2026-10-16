import { catalogRegistry, createTranslator } from "@otto/client-runtime/i18n";
import { describe, expect, it } from "vite-plus/test";

import { settingsSectionLabel } from "./settings-dialog";

describe("settingsSectionLabel", () => {
  it("matches the nav label instead of title-casing the section", () => {
    expect(settingsSectionLabel("image-generation")).toBe("Image generation");
    expect(settingsSectionLabel("privacy")).toBe("Privacy & data");
  });

  it("returns a catalog key the breadcrumb translates", async () => {
    const { t } = createTranslator("zh-CN", await catalogRegistry["zh-CN"]!());
    expect(t(settingsSectionLabel("image-generation"))).toBe("图像生成");
    expect(t(settingsSectionLabel("privacy"))).toBe("隐私与数据");
  });
});
