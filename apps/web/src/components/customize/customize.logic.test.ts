import { describe, expect, it } from "vite-plus/test";

import {
  parseCustomizeAppsSearch,
  parseCustomizePageSearch,
  planSkillImport,
} from "./customize.logic";

const entries = (paths: readonly string[]) => paths.map((path) => ({ path, value: path }));

describe("planSkillImport", () => {
  it("roots the skill at its shallowest SKILL.md and keeps paths below it", () => {
    const plan = planSkillImport(
      entries([
        "export/weekly-report/SKILL.md",
        "export/weekly-report/references/guide.md",
        "export/weekly-report/scripts/run.py",
        "export/weekly-report/examples/nested/SKILL.md",
        "export/README.md",
        "export/weekly-report/.DS_Store",
        "__MACOSX/export/weekly-report/._SKILL.md",
      ]),
    );

    expect(plan?.main).toBe("export/weekly-report/SKILL.md");
    expect(plan?.rootName).toBe("weekly-report");
    expect(plan?.folders).toEqual(["references", "scripts", "examples", "examples/nested"]);
    expect(plan?.files.map((file) => file.path)).toEqual([
      "references/guide.md",
      "scripts/run.py",
      "examples/nested/SKILL.md",
    ]);
  });

  it("is null without a SKILL.md", () => {
    expect(planSkillImport(entries(["notes/readme.md"]))).toBeNull();
  });
});

describe("parseCustomizePageSearch", () => {
  it("keeps known tabs and drops the rest", () => {
    expect(parseCustomizePageSearch({ tab: "skills" })).toEqual({ tab: "skills" });
    expect(parseCustomizePageSearch({ tab: "plugins" })).toEqual({});
  });
});

describe("parseCustomizeAppsSearch", () => {
  it("keeps the filter and a known group", () => {
    expect(parseCustomizeAppsSearch({ q: "gm", visibility: "organization" })).toEqual({
      q: "gm",
      visibility: "organization",
    });
    expect(parseCustomizeAppsSearch({ visibility: "everyone" })).toEqual({});
  });
});
