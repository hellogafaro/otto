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

import { inLibraryToolScope } from "./LibraryToolRuntime.ts";

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
  visibility: "workspace",
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
  visibility: "workspace",
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
