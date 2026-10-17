import { SYSTEM_SKILL_NAMES } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  SYSTEM_SKILLS,
  shadowsSystemSkill,
  systemSkillForPage,
  systemSkillPageId,
} from "./system-skills";

describe("built-in skills in the web app", () => {
  it("ships every built-in skill with its SKILL.md first and no license file", () => {
    expect(SYSTEM_SKILLS.map((skill) => skill.name)).toEqual([...SYSTEM_SKILL_NAMES]);

    for (const skill of SYSTEM_SKILLS) {
      expect(skill.description).not.toBe("");
      expect(skill.files[0]?.path).toBe("SKILL.md");
      expect(skill.files.some((file) => file.path.endsWith("LICENSE.md"))).toBe(false);
    }
  });

  it("opens a built-in skill's page by its system id only", () => {
    expect(systemSkillForPage(systemSkillPageId("git"))?.name).toBe("git");
    expect(systemSkillForPage("git")).toBeUndefined();
    expect(systemSkillForPage(systemSkillPageId("brainstorm"))).toBeUndefined();
  });

  it("flags a Library skill that takes a built-in name", () => {
    expect(shadowsSystemSkill(" implement ")).toBe(true);
    expect(shadowsSystemSkill("implement-fast")).toBe(false);
  });
});
