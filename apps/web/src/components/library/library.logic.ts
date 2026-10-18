import {
  type LibraryFile,
  type LibraryFolder,
  LibraryListSort,
  LibraryListTypeList,
  type LibraryListType,
  ListOrder,
  WorkParticipantKey,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const LIBRARY_TABS = ["all", "documents", "images", "files"] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

/** The type each tab other than All lists in every folder. */
export const LIBRARY_TAB_TYPES: Record<Exclude<LibraryTab, "all">, LibraryListType> = {
  documents: "document",
  images: "image",
  files: "file",
};

const LibrarySearch = Schema.Struct({
  folder: Schema.optional(Schema.String),
  tab: Schema.optional(Schema.Literals(LIBRARY_TABS)),
  preview: Schema.optional(Schema.String),
  type: Schema.optional(LibraryListTypeList),
  creator: Schema.optional(WorkParticipantKey),
  sort: Schema.optional(LibraryListSort),
  order: Schema.optional(ListOrder),
});

export type LibrarySearch = typeof LibrarySearch.Type;

const decodeLibrarySearch = Schema.decodeUnknownOption(LibrarySearch);

/** Unknown or malformed search params fall back to the whole Library on All. */
export const parseLibrarySearch = (search: Parameters<typeof decodeLibrarySearch>[0]) =>
  Option.getOrElse(decodeLibrarySearch(search), (): LibrarySearch => ({}));

/** What the Library puts in its URL: types as one comma list. */
export const encodeLibrarySearch = Schema.encodeSync(LibrarySearch);

const byTitle = (left: { title: string }, right: { title: string }) =>
  left.title.localeCompare(right.title, undefined, { sensitivity: "base", numeric: true });

/** Folders A to Z, then files newest first, the way Drive lists a folder. */
export function sortLibraryItems(
  folders: ReadonlyArray<LibraryFolder>,
  files: ReadonlyArray<LibraryFile>,
) {
  return {
    folders: folders.toSorted(byTitle),
    files: files.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}

const sizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatLibrarySize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;

  if (bytes < 1_000_000) return `${sizeFormatter.format(bytes / 1000)} KB`;

  return `${sizeFormatter.format(bytes / 1_000_000)} MB`;
}

/**
 * The rich text editor has no front matter, so a document's YAML header (a skill's name and
 * description) is edited beside it as plain text and put back in front of the body on save.
 */
export const joinFrontMatter = (frontMatter: string | null, body: string) =>
  frontMatter === null ? body : `---\n${frontMatter}\n---\n\n${body}`;
