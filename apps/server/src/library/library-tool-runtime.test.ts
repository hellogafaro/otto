import {
  AuthSessionId,
  BotId,
  GroupId,
  type LibraryFile,
  LibraryFileId,
  type LibraryFolder,
  LibraryFolderId,
  type LibraryVisibilityContext,
  ThreadId,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";

import { botSkills, inLibraryToolScope, skillCatalog } from "./library-tool-runtime.ts";

const ANA = {
  kind: "person" as const,
  personId: AuthSessionId.make("user-ana"),
  displayName: "Ana",
};

const NOVA = BotId.make("bot-nova");

const AT = "2026-10-14T00:00:00.000Z";

const folder = (id: string, fields: Partial<LibraryFolder> = {}): LibraryFolder => ({
  id: LibraryFolderId.make(id),
  parentId: null,
  title: id,
  visibility: "organization",
  createdBy: ANA,
  createdAt: AT,
  updatedBy: ANA,
  updatedAt: AT,
  ...fields,
});

const file = (
  id: string,
  folderId: string | null,
  fields: Partial<LibraryFile> = {},
): LibraryFile => ({
  id: LibraryFileId.make(id),
  folderId: folderId === null ? null : LibraryFolderId.make(folderId),
  type: "document",
  title: id,
  extension: "md",
  sizeBytes: 1,
  visibility: "organization",
  createdBy: ANA,
  createdAt: AT,
  updatedBy: ANA,
  updatedAt: AT,
  ...fields,
});

const here = ThreadId.make("thread-here");

const elsewhere = ThreadId.make("thread-elsewhere");

const folders = [
  folder("library-chats"),
  folder("chat-here", { parentId: LibraryFolderId.make("library-chats"), threadId: here }),
  folder("chat-elsewhere", {
    parentId: LibraryFolderId.make("library-chats"),
    threadId: elsewhere,
  }),
  folder("private", { visibility: "user" }),
];

const group = GroupId.make("group-both");

const context: LibraryVisibilityContext = {
  folders,
  threads: [
    { id: here, groupId: group },
    { id: elsewhere, groupId: group },
  ],
  groups: [
    {
      id: group,
      members: [{ kind: "bot" as const, botId: NOVA, role: "specialist" as const }, ANA],
    },
  ],
};

const state = { folders, context };

const caller = { threadId: here, botId: NOVA };

it("lets a bot see this chat's folder and shared items, never another chat's", () => {
  expect(inLibraryToolScope(state, caller, file("shared", null))).toBe(true);
  expect(inLibraryToolScope(state, caller, file("mine-here", "chat-here"))).toBe(true);
  expect(inLibraryToolScope(state, caller, file("other-chat", "chat-elsewhere"))).toBe(false);
});

it("keeps private items and everything under a private folder from a bot", () => {
  expect(inLibraryToolScope(state, caller, file("secret", null, { visibility: "user" }))).toBe(
    false,
  );
  expect(inLibraryToolScope(state, caller, file("inside", "private"))).toBe(false);
});

it("gives a bot workspace skills and its owner's personal ones, with paths inside each skill", () => {
  const BEN = {
    kind: "person" as const,
    personId: AuthSessionId.make("user-ben"),
    displayName: "Ben",
  };

  const skills = LibraryFolderId.make("library-skills");

  const skillFolders = [
    folder("library-skills"),
    folder("shared-skill", { parentId: skills, title: "Shared" }),
    folder("ana-skill", { parentId: skills, title: "Ana's", visibility: "user" }),
    folder("refs", { parentId: LibraryFolderId.make("shared-skill"), title: "references" }),
    folder("ben-notes", {
      parentId: LibraryFolderId.make("shared-skill"),
      title: "notes",
      visibility: "user",
      createdBy: BEN,
    }),
  ];

  const skillFiles = [
    file("shared-main", "shared-skill", { title: "SKILL" }),
    file("shared-guide", "refs", { title: "guide" }),
    file("ben-private", "ben-notes", { title: "draft", createdBy: BEN, visibility: "user" }),
    file("run", "refs", { title: "run", type: "file", extension: "py" }),
    file("ana-main", "ana-skill", { title: "SKILL", visibility: "user" }),
  ];

  const state = { folders: skillFolders, files: skillFiles };

  const names = (owner: typeof ANA | null) =>
    botSkills(state, { botId: NOVA, owner }).map(({ skill, files }) => [
      skill.title,
      files.map((entry) => entry.path).toSorted(),
    ]);

  expect(names(ANA)).toEqual([
    ["Ana's", ["SKILL.md"]],
    ["Shared", ["SKILL.md", "references/guide.md", "references/run.py"]],
  ]);
  expect(names(null)).toEqual([
    ["Shared", ["SKILL.md", "references/guide.md", "references/run.py"]],
  ]);
  expect(
    botSkills(state, {
      botId: NOVA,
      owner: ANA,
      disabledSkillIds: [LibraryFolderId.make("shared-skill")],
    }).map(({ skill }) => skill.title),
  ).toEqual(["Ana's"]);
});

it("lists built-in skills first, computer ones only with a computer, and hides shadowed Library skills", () => {
  const library = [
    { name: "verify", skillId: "skill-verify", description: "An old copy." },
    { name: "weekly-report", skillId: "skill-weekly", description: "Write the weekly report." },
  ];

  const withComputer = skillCatalog(library, { computer: true }).split("\n");
  const withoutComputer = skillCatalog(library, { computer: false }).split("\n");

  expect(withComputer.map((line) => line.split(":")[0])).toEqual([
    "- research",
    "- investigate",
    "- implement",
    "- git",
    "- github",
    "- verify",
    "- review",
    "- visualize",
    "- write",
    "- handoff",
    "- summarize",
    "- deliver",
    "- computer-use",
    "- weekly-report (skillId",
  ]);
  expect(withoutComputer.some((line) => line.startsWith("- computer-use:"))).toBe(false);
  expect(withoutComputer.some((line) => line.startsWith("- git:"))).toBe(false);
  expect(withoutComputer.some((line) => line.startsWith("- github:"))).toBe(false);
  expect(withComputer.join("\n")).not.toContain("An old copy.");
  expect(skillCatalog(library, { computer: true })).toBe(skillCatalog(library, { computer: true }));
});
