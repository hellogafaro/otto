import * as NodeFS from "node:fs";
import { COMPUTER_SYSTEM_SKILLS, parseSkillFrontMatter, SYSTEM_SKILL_NAMES } from "@otto/contracts";
import * as Predicate from "effect/Predicate";

declare global {
  interface ImportMeta {
    glob<T>(
      pattern: string | readonly string[],
      options: { readonly eager: true; readonly import: string; readonly query?: string },
    ): Record<string, T>;
  }
}

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SystemSkill {
  readonly name: string;
  readonly description: string;
  readonly needsComputer: boolean;
  /** Readable files by path inside the skill; LICENSE.md is kept beside the skill but never read. */
  readonly files: ReadonlyMap<string, string>;
}

function readSourceTree(): Record<string, string> {
  const root = new URL("./system/", import.meta.url);

  return Object.fromEntries(
    NodeFS.readdirSync(root, { recursive: true, encoding: "utf8" })
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".md"))
      .map((path) => [`./system/${path}`, NodeFS.readFileSync(new URL(path, root), "utf8")]),
  );
}

/** Parses and checks the bundled skills; a broken skill fails at startup and in tests. */
export function loadSystemSkills(
  modules: Readonly<Record<string, string>>,
): readonly SystemSkill[] {
  const byName = new Map<string, Map<string, string>>();

  for (const [key, content] of Object.entries(modules)) {
    const [, name, path] = /^\.\/system\/([^/]+)\/(.+)$/.exec(key) ?? [];

    if (!name || !path || path === "LICENSE.md") continue;
    const files = byName.get(name) ?? new Map<string, string>();
    files.set(path, content);
    byName.set(name, files);
  }

  return SYSTEM_SKILL_NAMES.map((name) => {
    const files = byName.get(name);
    const skill = files?.get("SKILL.md");

    if (!files || skill === undefined) throw new Error(`Built-in skill '${name}' has no SKILL.md.`);
    const front = parseSkillFrontMatter(skill);
    const description = front.description ?? "";

    if (front.name !== name || !SKILL_NAME.test(name))
      throw new Error(`Built-in skill '${name}' must be named after its folder.`);

    if (!description || description.length > 200 || description.includes(": "))
      throw new Error(
        `Built-in skill '${name}' needs a one-line description of at most 200 characters.`,
      );

    for (const [path, content] of files) {
      for (const [, link] of content.matchAll(/\]\(([^)]+)\)/g)) {
        if (
          /^[a-z]+:/i.test(link!) ||
          !files.has(new URL(link!, `file:///${path}`).pathname.slice(1))
        )
          throw new Error(`Built-in skill '${name}' links to '${link}', which it doesn't have.`);
      }
    }

    return { name, description, needsComputer: COMPUTER_SYSTEM_SKILLS.includes(name), files };
  });
}

export const systemSkills = loadSystemSkills(
  Predicate.isFunction(import.meta.glob)
    ? import.meta.glob<string>("./system/**/*.md", {
        eager: true,
        query: "?raw",
        import: "default",
      })
    : readSourceTree(),
);

export function findSystemSkill(name: string): SystemSkill | undefined {
  return systemSkills.find((skill) => skill.name === name);
}
