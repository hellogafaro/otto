import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const CUSTOMIZE_TABS = ["integrations", "skills"] as const;

export type CustomizeTab = (typeof CUSTOMIZE_TABS)[number];

/** What a Customize detail page shows: an MCP server or a skill. Apps have their own pages. */
export const CUSTOMIZE_ENTITY_TYPES = ["mcp", "skill"] as const;

export type CustomizeEntityType = (typeof CUSTOMIZE_ENTITY_TYPES)[number];

export const isCustomizeEntityType = (value: string): value is CustomizeEntityType =>
  CUSTOMIZE_ENTITY_TYPES.some((type) => type === value);

const CustomizePageSearch = Schema.Struct({
  tab: Schema.optional(Schema.Literals(CUSTOMIZE_TABS)),
});

export type CustomizePageSearch = typeof CustomizePageSearch.Type;

export const parseCustomizePageSearch = (search: Parameters<typeof decodeCustomizePageSearch>[0]) =>
  Option.getOrElse(decodeCustomizePageSearch(search), (): CustomizePageSearch => ({}));

const decodeCustomizePageSearch = Schema.decodeUnknownOption(CustomizePageSearch);

/** The app catalog's search: a filter, and the group a new account joins. */
const CustomizeAppsSearch = Schema.Struct({
  q: Schema.optional(Schema.String),
  visibility: Schema.optional(Schema.Literals(["user", "workspace"])),
});

export type CustomizeAppsSearch = typeof CustomizeAppsSearch.Type;

const decodeCustomizeAppsSearch = Schema.decodeUnknownOption(CustomizeAppsSearch);

export const parseCustomizeAppsSearch = (search: Parameters<typeof decodeCustomizeAppsSearch>[0]) =>
  Option.getOrElse(decodeCustomizeAppsSearch(search), (): CustomizeAppsSearch => ({}));

const SKILL_FILE = /(^|\/)SKILL\.md$/i;

/** Finder and zip leftovers that never belong in a skill. */
const isJunkPath = (path: string) =>
  path.split("/").some((segment) => segment.startsWith(".") || segment === "__MACOSX");

/**
 * What an imported folder or zip holds as a skill: the shallowest `SKILL.md` marks the skill's
 * root, everything outside it is dropped, and the rest keeps its path below that root.
 * Null when there is no `SKILL.md`.
 */
export function planSkillImport<T>(
  entries: ReadonlyArray<{ readonly path: string; readonly value: T }>,
) {
  const usable = entries.filter((entry) => !isJunkPath(entry.path));

  const main = usable
    .toSorted((left, right) => left.path.split("/").length - right.path.split("/").length)
    .find((entry) => SKILL_FILE.test(entry.path));

  if (main === undefined) return null;
  const root = main.path.slice(0, main.path.length - "SKILL.md".length);

  const files = usable.flatMap((entry) =>
    entry !== main && entry.path.startsWith(root)
      ? [{ path: entry.path.slice(root.length), value: entry.value }]
      : [],
  );

  const folders = [
    ...new Set(
      files.flatMap((file) =>
        file.path
          .split("/")
          .slice(0, -1)
          .map((_, index, segments) => segments.slice(0, index + 1).join("/")),
      ),
    ),
  ].toSorted((left, right) => left.split("/").length - right.split("/").length);

  return {
    main: main.value,
    /** The folder the skill came in, a fallback for its name. */
    rootName: root.split("/").findLast((segment) => segment !== "") ?? null,
    folders,
    files,
  };
}
