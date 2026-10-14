import { skillTemplate, splitFrontMatter } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { joinFrontMatter } from "./library.logic";

describe("document front matter", () => {
  it("splits a skill's YAML header from its body and puts it back unchanged", () => {
    const skill = skillTemplate({ name: "weekly-report", description: "Use for the numbers." });
    const { frontMatter, body } = splitFrontMatter(skill);

    expect(frontMatter).toBe("name: weekly-report\ndescription: Use for the numbers.");
    expect(body.startsWith("# weekly-report")).toBe(true);
    expect(joinFrontMatter(frontMatter, body)).toBe(skill);
  });

  it("leaves documents without a header untouched", () => {
    expect(splitFrontMatter("# Notes\n\nText")).toEqual({
      frontMatter: null,
      body: "# Notes\n\nText",
    });
    expect(joinFrontMatter(null, "# Notes\n\nText")).toBe("# Notes\n\nText");
  });
});
