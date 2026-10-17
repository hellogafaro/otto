import { parseSkillFrontMatter, SYSTEM_SKILL_NAMES } from "@otto/contracts";

const SYSTEM_SKILL_PREFIX = "system:";

const modules = import.meta.glob<string>("../../../../server/src/skills/system/*/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** Otto: the skills every bot has, read-only and shipped with the server, in the order bots see them. */
export const SYSTEM_SKILLS = SYSTEM_SKILL_NAMES.map((name) => {
  const folder = `../../../../server/src/skills/system/${name}/`;

  const files = Object.entries(modules)
    .filter(([path]) => path.startsWith(folder) && !path.endsWith("/LICENSE.md"))
    .map(([path, content]) => ({ path: path.slice(folder.length), content }))
    .toSorted(
      (left, right) =>
        Number(right.path === "SKILL.md") - Number(left.path === "SKILL.md") ||
        left.path.localeCompare(right.path),
    );

  const main = files.find((file) => file.path === "SKILL.md")?.content ?? "";

  return { name, description: parseSkillFrontMatter(main).description ?? "", files };
});

export type SystemSkillView = (typeof SYSTEM_SKILLS)[number];

export const systemSkillPageId = (name: string) => `${SYSTEM_SKILL_PREFIX}${name}`;

export const systemSkillForPage = (id: string) =>
  id.startsWith(SYSTEM_SKILL_PREFIX)
    ? SYSTEM_SKILLS.find((skill) => skill.name === id.slice(SYSTEM_SKILL_PREFIX.length))
    : undefined;

/** A Library skill with a built-in skill's name: bots use the built-in one instead. */
export const shadowsSystemSkill = (name: string) =>
  SYSTEM_SKILL_NAMES.some((builtIn) => builtIn === name.trim());
