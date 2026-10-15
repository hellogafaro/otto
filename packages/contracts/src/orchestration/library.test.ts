import { describe, expect, it } from "vite-plus/test";

import { AuthSessionId, BotId, GroupId, ThreadId } from "../base-schemas.ts";
import {
  canEditLibraryItem,
  canSeeDirectChat,
  canSeeLibraryItem,
  type LibraryFile,
  LibraryFileId,
  type LibraryFolder,
  LibraryFolderId,
  libraryContentType,
  libraryDocumentTitle,
  libraryDownloadName,
  libraryFileKind,
  normalizeLibraryTitle,
  splitLibraryFileName,
} from "./library.ts";

const ada = { kind: "person" as const, personId: AuthSessionId.make("ada"), displayName: "Ada" };

const ana = { kind: "person" as const, personId: AuthSessionId.make("ana"), displayName: "Ana" };

const scout = { kind: "bot" as const, botId: BotId.make("scout") };

const bytes = (text: string) => new TextEncoder().encode(text);

const folder = (overrides: Partial<LibraryFolder> = {}): LibraryFolder => ({
  id: LibraryFolderId.make("folder"),
  parentId: null,
  title: "Folder",
  visibility: "organization",
  createdBy: ada,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedBy: ada,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const file = (overrides: Partial<LibraryFile> = {}): LibraryFile => ({
  id: LibraryFileId.make("file"),
  folderId: null,
  type: "document",
  title: "Notes",
  extension: "md",
  sizeBytes: 10,
  visibility: "organization",
  createdBy: ada,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedBy: ada,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("library titles and names", () => {
  it("splits an upload name into title and lowercase extension", () => {
    expect(splitLibraryFileName("Q3 Report.PDF")).toEqual({ title: "Q3 Report", extension: "pdf" });
    expect(splitLibraryFileName("archive.tar.gz")).toEqual({
      title: "archive.tar",
      extension: "gz",
    });
    expect(splitLibraryFileName(".env")).toEqual({ title: ".env", extension: "" });
    expect(splitLibraryFileName("README")).toEqual({ title: "README", extension: "" });
    expect(splitLibraryFileName("notes.md")).toEqual({ title: "notes", extension: "md" });
    expect(splitLibraryFileName("weird.ex-t")).toEqual({ title: "weird.ex-t", extension: "" });
    expect(splitLibraryFileName(".md")).toEqual({ title: ".md", extension: "" });
  });

  it("keeps titles to one trimmed line and falls back to Untitled", () => {
    expect(normalizeLibraryTitle("  Line one\nline two  ")).toBe("Line one line two");
    expect(normalizeLibraryTitle("   ")).toBe("Untitled");
    expect(normalizeLibraryTitle("x".repeat(250))).toHaveLength(200);
  });

  it("titles a new document after its first heading", () => {
    expect(libraryDocumentTitle("intro\n# Launch plan\n## Later")).toBe("Launch plan");
    expect(libraryDocumentTitle("no heading here")).toBe("Untitled");
    expect(libraryDocumentTitle("")).toBe("Untitled");
  });

  it("builds a safe download name without doubling the extension", () => {
    expect(libraryDownloadName({ title: "Plan", extension: "md" })).toBe("Plan.md");
    expect(libraryDownloadName({ title: "Plan.md", extension: "md" })).toBe("Plan.md");
    expect(libraryDownloadName({ title: "a/b: c?", extension: "txt" })).toBe("a-b- c-.txt");
    expect(libraryDownloadName({ title: "README", extension: "" })).toBe("README");
  });
});

describe("library file types", () => {
  it("trusts the bytes before the extension and corrects a wrong extension", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(libraryFileKind({ extension: "png", head: bytes("%PDF-1.7") })).toEqual({
      type: "pdf",
      extension: "pdf",
    });
    expect(libraryFileKind({ extension: "md", head: png })).toEqual({
      type: "image",
      extension: "png",
    });
    expect(
      libraryFileKind({ extension: "jpeg", head: new Uint8Array([0xff, 0xd8, 0xff]) }),
    ).toEqual({ type: "image", extension: "jpeg" });
  });

  it("falls back to the extension, and unknown is a file", () => {
    const typeOf = (extension: string, head: Uint8Array) =>
      libraryFileKind({ extension, head }).type;

    expect(typeOf("md", bytes("# Hi"))).toBe("document");
    expect(typeOf("md", new Uint8Array())).toBe("document");
    expect(typeOf("svg", bytes("<svg"))).toBe("image");
    expect(typeOf("txt", bytes("BMW service notes"))).toBe("file");
    expect(typeOf("", bytes("hello"))).toBe("file");
  });

  it("serves content types from a fixed list", () => {
    expect(libraryContentType({ type: "image", extension: "png" })).toBe("image/png");
    expect(libraryContentType({ type: "pdf", extension: "png" })).toBe("application/pdf");
    expect(libraryContentType({ type: "file", extension: "exe" })).toBe("application/octet-stream");
  });
});

describe("library visibility and editing", () => {
  const threadId = ThreadId.make("thread-1");
  const groupId = GroupId.make("group-1");

  const context = (overrides: Partial<Parameters<typeof canSeeLibraryItem>[1]> = {}) => ({
    folders: [] as LibraryFolder[],
    threads: [{ id: threadId, groupId, deletedAt: null }],
    groups: [
      {
        id: groupId,
        members: [
          { kind: "person" as const, personId: ada.personId, displayName: "Ada" },
          { kind: "bot" as const, botId: scout.botId, role: "specialist" as const },
        ],
      },
    ],
    ...overrides,
  });

  it("hides a private item and everything under a private folder", () => {
    const privateFolder = folder({ visibility: "user" });
    const inside = file({ folderId: privateFolder.id, createdBy: ana, updatedBy: ana });
    const ctx = context({ folders: [privateFolder] });

    expect(canSeeLibraryItem(file({ visibility: "user" }), ctx, ana)).toBe(false);
    expect(canSeeLibraryItem(file({ visibility: "user" }), ctx, ada)).toBe(true);
    expect(canSeeLibraryItem(inside, ctx, ana)).toBe(false);
    expect(canSeeLibraryItem(inside, ctx, ada)).toBe(true);
  });

  it("shows a chat folder to exactly the people and bots in that chat", () => {
    const chatFolder = folder({ id: LibraryFolderId.make("chat"), threadId });
    const inside = file({ folderId: chatFolder.id, createdBy: scout, updatedBy: scout });
    const ctx = context({ folders: [chatFolder] });

    expect(canSeeLibraryItem(inside, ctx, ada)).toBe(true);
    expect(canSeeLibraryItem(inside, ctx, ana)).toBe(false);
    expect(canSeeLibraryItem(inside, ctx, scout)).toBe(true);
    expect(canSeeLibraryItem(inside, ctx, { kind: "bot", botId: BotId.make("other") })).toBe(false);
  });

  it("leaves a deleted chat's folder to its creator only", () => {
    const chatFolder = folder({ id: LibraryFolderId.make("chat"), threadId });
    const ctx = context({ folders: [chatFolder], threads: [] });

    expect(canSeeLibraryItem(chatFolder, ctx, ada)).toBe(true);
    expect(canSeeLibraryItem(chatFolder, { ...ctx, groups: [] }, ana)).toBe(false);
  });

  it("lets the creator edit, and the chat creator edit a bot's chat file", () => {
    const chatFolder = folder({ id: LibraryFolderId.make("chat"), threadId });
    const botFile = file({ folderId: chatFolder.id, createdBy: scout, updatedBy: scout });

    expect(canEditLibraryItem(file(), [], ada)).toBe(true);
    expect(canEditLibraryItem(file(), [], ana)).toBe(false);
    expect(canEditLibraryItem(botFile, [chatFolder], ada)).toBe(true);
    expect(canEditLibraryItem(botFile, [chatFolder], ana)).toBe(false);
    expect(canEditLibraryItem(botFile, [chatFolder], scout)).toBe(true);
    expect(canEditLibraryItem(file({ createdBy: scout }), [], ada)).toBe(false);
  });
});

describe("direct chat visibility", () => {
  const chat = { createdBy: ada.personId, botId: scout.botId, visibility: "user" as const };

  it("shows a private chat to its creator and its bot only", () => {
    expect(canSeeDirectChat(chat, { kind: "person", personId: ada.personId })).toBe(true);
    expect(canSeeDirectChat(chat, { kind: "bot", botId: scout.botId })).toBe(true);
    expect(canSeeDirectChat(chat, { kind: "person", personId: ana.personId })).toBe(false);
    expect(canSeeDirectChat(chat, { kind: "bot", botId: BotId.make("other") })).toBe(false);
  });

  it("shows an organization chat, or one nobody started, to everyone", () => {
    const viewer = { kind: "person" as const, personId: ana.personId };

    expect(canSeeDirectChat({ ...chat, visibility: "organization" }, viewer)).toBe(true);
    expect(canSeeDirectChat({ ...chat, createdBy: null }, viewer)).toBe(true);
  });
});
