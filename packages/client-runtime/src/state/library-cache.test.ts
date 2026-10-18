import {
  AuthSessionId,
  type LibraryFile,
  LibraryFileId,
  type LibraryFolder,
  LibraryFolderId,
  type OrchestrationShellStreamItem,
} from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyLibraryShellItem,
  cacheLibraryItems,
  type LibraryCache,
  libraryPathCached,
} from "./library-cache.ts";

const ada = { kind: "person" as const, personId: AuthSessionId.make("ada"), displayName: "Ada" };

const at = "2026-10-18T00:00:00.000Z";

const folder = (id: string, parent: string | null): LibraryFolder => ({
  id: LibraryFolderId.make(id),
  parentId: parent === null ? null : LibraryFolderId.make(parent),
  title: id,
  visibility: "organization",
  createdBy: ada,
  createdAt: at,
  updatedBy: ada,
  updatedAt: at,
});

const file = (id: string, folderId: string | null): LibraryFile => ({
  id: LibraryFileId.make(id),
  folderId: folderId === null ? null : LibraryFolderId.make(folderId),
  type: "document",
  title: id,
  extension: "md",
  sizeBytes: 1,
  visibility: "organization",
  createdBy: ada,
  createdAt: at,
  updatedBy: ada,
  updatedAt: at,
});

const filled: LibraryCache = cacheLibraryItems(
  { folders: new Map(), files: new Map(), revision: 3 },
  {
    folders: [folder("top", null), folder("inner", "top"), folder("other", null)],
    files: [file("deep", "inner"), file("loose", null), file("beside", "other")],
  },
);

const apply = (item: OrchestrationShellStreamItem) => applyLibraryShellItem(filled, item);

describe("library cache", () => {
  it("fills from reads without moving the revision", () => {
    expect(filled.revision).toBe(3);
    expect([...filled.files.keys()]).toEqual(["deep", "loose", "beside"]);
    expect(libraryPathCached(filled, LibraryFolderId.make("inner"))).toBe(true);
    expect(libraryPathCached(filled, null)).toBe(true);
    expect(libraryPathCached(filled, LibraryFolderId.make("unknown"))).toBe(false);
  });

  it("keeps every Library change and counts it", () => {
    const renamed = apply({
      kind: "library-file-upserted",
      sequence: 9,
      file: { ...file("loose", null), title: "Renamed" },
    });

    expect(renamed.files.get(LibraryFileId.make("loose"))?.title).toBe("Renamed");
    expect(renamed.revision).toBe(4);

    const removed = apply({
      kind: "library-file-removed",
      sequence: 9,
      fileId: LibraryFileId.make("loose"),
    });

    expect(removed.files.has(LibraryFileId.make("loose"))).toBe(false);
    expect(removed.revision).toBe(4);
  });

  it("drops a removed folder with everything cached beneath it", () => {
    const next = apply({
      kind: "library-folder-removed",
      sequence: 9,
      folderId: LibraryFolderId.make("top"),
    });

    expect([...next.folders.keys()]).toEqual(["other"]);
    expect([...next.files.keys()]).toEqual(["loose", "beside"]);
    expect(next.revision).toBe(4);
  });

  it("starts over on a new snapshot and ignores everything else", () => {
    const fresh = apply({ kind: "snapshot", snapshot: {} as never });

    expect(fresh.folders.size + fresh.files.size).toBe(0);
    expect(fresh.revision).toBe(4);
    expect(apply({ kind: "thread-removed", sequence: 9, threadId: "t" as never })).toBe(filled);
  });
});
