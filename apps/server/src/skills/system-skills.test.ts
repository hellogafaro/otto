import { describe, expect, it } from "vite-plus/test";
import { findSystemSkill, loadSystemSkills, systemSkills } from "./system-skills.ts";

describe("system skills", () => {
  it("loads every built-in skill in its fixed order without its license", () => {
    expect(systemSkills.map((skill) => skill.name)).toEqual([
      "research",
      "investigate",
      "implement",
      "git",
      "verify",
      "visualize",
      "write",
      "handoff",
      "summarize",
      "close",
      "computer",
    ]);
    expect(systemSkills.filter((skill) => skill.needsComputer).map((skill) => skill.name)).toEqual([
      "git",
      "computer",
    ]);
    expect([...findSystemSkill("write")!.files.keys()]).toEqual([
      "SKILL.md",
      "references/patterns.md",
    ]);
    expect(findSystemSkill("implement")!.files.has("LICENSE.md")).toBe(false);
  });

  it("keeps the skills free of links out, em dashes and credits", () => {
    for (const skill of systemSkills) {
      for (const content of skill.files.values()) {
        expect(content).not.toMatch(/https?:\/\/|\u2014|credit/i);
      }
    }
  });

  it("refuses a skill whose name or description breaks the rules", () => {
    const modules = Object.fromEntries(
      systemSkills.flatMap((skill) =>
        [...skill.files].map(([path, content]) => [`./system/${skill.name}/${path}`, content]),
      ),
    );

    const broken = (name: string, content: string) => () =>
      loadSystemSkills({ ...modules, [`./system/${name}/SKILL.md`]: content });

    expect(broken("verify", "---\nname: check\ndescription: Use it.\n---\n")).toThrow(
      "named after its folder",
    );
    expect(broken("verify", "---\nname: verify\ndescription: Use: it.\n---\n")).toThrow(
      "one-line description",
    );
    expect(
      broken("verify", "---\nname: verify\ndescription: Use it.\n---\nSee [x](x.md)."),
    ).toThrow("links to 'x.md'");
  });
});
