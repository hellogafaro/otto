import {
  AuthSessionId,
  BotId,
  CommandId,
  GroupId,
  LIBRARY_CHATS_FOLDER_ID,
  LibraryFileId,
  LibraryFolderId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ThreadId,
  type WorkParticipant,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";

const ada: WorkParticipant = {
  kind: "person",
  personId: AuthSessionId.make("ada"),
  displayName: "Ada",
};

const ana: WorkParticipant = {
  kind: "person",
  personId: AuthSessionId.make("ana"),
  displayName: "Ana",
};

const scout: WorkParticipant = { kind: "bot", botId: BotId.make("scout") };

let commandCount = 0;

const cmd = () => CommandId.make(`cmd-${(commandCount += 1)}`);

const folderId = (id: string) => LibraryFolderId.make(id);

const fileId = (id: string) => LibraryFileId.make(id);

const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({ command, readModel });
    const planned = Array.isArray(result) ? result : [result];
    let next = readModel;

    for (const event of planned) {
      next = yield* projectEvent(next, {
        ...event,
        sequence: next.snapshotSequence + 1,
      } as OrchestrationEvent);
    }

    return next;
  });

const applyAll = (
  readModel: OrchestrationReadModel,
  commands: ReadonlyArray<OrchestrationCommand>,
) =>
  Effect.gen(function* () {
    let next = readModel;

    for (const command of commands) next = yield* apply(next, command);

    return next;
  });

const rejection = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.flip,
    Effect.map((error) => ("detail" in error ? error.detail : String(error))),
  );

const createFolder = (
  id: string,
  parentId: string | null,
  by: WorkParticipant = ada,
  extra: Partial<Extract<OrchestrationCommand, { type: "library.folder.create" }>> = {},
): OrchestrationCommand => ({
  type: "library.folder.create",
  commandId: cmd(),
  folderId: folderId(id),
  parentId: parentId === null ? null : folderId(parentId),
  title: id,
  by,
  createdAt: now,
  ...extra,
});

const createFile = (
  id: string,
  folder: string | null,
  by: WorkParticipant = ada,
  extra: Partial<Extract<OrchestrationCommand, { type: "library.file.create" }>> = {},
): OrchestrationCommand => ({
  type: "library.file.create",
  commandId: cmd(),
  fileId: fileId(id),
  folderId: folder === null ? null : folderId(folder),
  fileType: "document",
  title: id,
  extension: "md",
  sizeBytes: 3,
  visibility: "workspace",
  by,
  createdAt: now,
  ...extra,
});

const empty = createEmptyReadModel(now);

it.layer(NodeServices.layer)("decider library", (it) => {
  it.effect("nests folders at most eight deep", () =>
    Effect.gen(function* () {
      const chain = Array.from({ length: 8 }, (_, index) =>
        createFolder(`f${index + 1}`, index === 0 ? null : `f${index}`),
      );

      const readModel = yield* applyAll(empty, chain);

      expect(readModel.libraryFolders).toHaveLength(8);
      expect(yield* rejection(readModel, createFolder("f9", "f8"))).toBe(
        "Folders go at most 8 levels deep.",
      );
    }),
  );

  it.effect("refuses to move a folder into itself or below itself, or too deep", () =>
    Effect.gen(function* () {
      const readModel = yield* applyAll(empty, [
        createFolder("a", null),
        createFolder("b", "a"),
        createFolder("c", "b"),
      ]);

      const move = (target: string): OrchestrationCommand => ({
        type: "library.folder.update",
        commandId: cmd(),
        folderId: folderId("a"),
        parentId: folderId(target),
        by: ada,
      });

      expect(yield* rejection(readModel, move("a"))).toBe("A folder can't move into itself.");
      expect(yield* rejection(readModel, move("c"))).toBe("A folder can't move into itself.");

      const deep = yield* applyAll(
        readModel,
        Array.from({ length: 6 }, (_, index) =>
          createFolder(`d${index + 1}`, index === 0 ? null : `d${index}`),
        ),
      );

      expect(yield* rejection(deep, move("d6"))).toBe("Folders go at most 8 levels deep.");
    }),
  );

  it.effect("deletes only empty folders, and only by their creator", () =>
    Effect.gen(function* () {
      const readModel = yield* applyAll(empty, [createFolder("a", null), createFile("doc", "a")]);

      const remove = (by: WorkParticipant): OrchestrationCommand => ({
        type: "library.folder.delete",
        commandId: cmd(),
        folderId: folderId("a"),
        by,
      });

      expect(yield* rejection(readModel, remove(ada))).toBe("Only an empty folder can be deleted.");

      const emptied = yield* apply(readModel, {
        type: "library.file.delete",
        commandId: cmd(),
        fileId: fileId("doc"),
        by: ada,
      });

      expect(yield* rejection(emptied, remove(ana))).toBe(
        "Only the folder's creator can delete it.",
      );
      expect((yield* apply(emptied, remove(ada))).libraryFolders).toEqual([]);
    }),
  );

  it.effect("lets only the creator edit a file, and hides private files entirely", () =>
    Effect.gen(function* () {
      const readModel = yield* applyAll(empty, [
        createFile("shared", null),
        createFile("mine", null, ada, { visibility: "user" }),
      ]);

      const rename = (id: string, by: WorkParticipant): OrchestrationCommand => ({
        type: "library.file.update",
        commandId: cmd(),
        fileId: fileId(id),
        title: "Renamed",
        by,
      });

      expect(yield* rejection(readModel, rename("shared", ana))).toBe(
        "Only the file's creator can change it.",
      );
      expect(yield* rejection(readModel, rename("mine", ana))).toBe("File 'mine' does not exist.");

      const renamed = yield* apply(readModel, rename("shared", ada));

      expect(renamed.libraryFiles?.find((file) => file.id === "shared")).toMatchObject({
        title: "Renamed",
        updatedBy: ada,
      });
    }),
  );

  it.effect("hides files inside a private folder from everyone else", () =>
    Effect.gen(function* () {
      const readModel = yield* applyAll(empty, [
        createFolder("private", null, ada, { visibility: "user" }),
      ]);

      expect(yield* rejection(readModel, createFile("sneaky", "private", ana))).toBe(
        "Folder 'private' does not exist.",
      );
    }),
  );

  it.effect("rejects a document save made on top of a newer one", () =>
    Effect.gen(function* () {
      const readModel = yield* applyAll(empty, [createFile("doc", null)]);
      const opened = readModel.libraryFiles?.[0]?.updatedAt ?? "";

      const save = (expectedUpdatedAt: string): OrchestrationCommand => ({
        type: "library.file.update",
        commandId: cmd(),
        fileId: fileId("doc"),
        sizeBytes: 10,
        expectedUpdatedAt,
        by: ada,
      });

      const saved = yield* apply(readModel, save(opened));
      const after = saved.libraryFiles?.[0];

      expect(after?.sizeBytes).toBe(10);
      expect(after?.updatedAt).not.toBe(opened);
      expect(yield* rejection(saved, save(opened))).toBe("Changed by Ada, reload.");
    }),
  );

  it.effect("keeps chat folders under Chats, fixed in place, and only for the chat's people", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-crew");
      const groupId = GroupId.make("group-crew");

      const base: OrchestrationReadModel = {
        ...empty,
        groups: [
          {
            id: groupId,
            name: "Crew",
            bossBotId: null,
            members: [
              { kind: "person", personId: AuthSessionId.make("ada"), displayName: "Ada" },
              { kind: "bot", botId: BotId.make("scout"), role: "specialist" },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        threads: [{ id: threadId, groupId, deletedAt: null } as never],
      };

      const readModel = yield* applyAll(base, [
        createFolder(LIBRARY_CHATS_FOLDER_ID, null),
        createFolder("crew", LIBRARY_CHATS_FOLDER_ID, ada, { threadId }),
        createFile("plan", "crew", scout),
      ]);

      expect(yield* rejection(readModel, createFolder("loose", LIBRARY_CHATS_FOLDER_ID))).toBe(
        "The Chats folder only holds chat folders.",
      );
      expect(
        yield* rejection(
          readModel,
          createFolder("again", LIBRARY_CHATS_FOLDER_ID, ada, { threadId }),
        ),
      ).toBe("This chat already has a folder.");
      expect(
        yield* rejection(readModel, {
          type: "library.folder.update",
          commandId: cmd(),
          folderId: folderId("crew"),
          parentId: null,
          by: ada,
        }),
      ).toBe("A chat folder can be renamed but not moved or made private.");
      expect(
        yield* rejection(readModel, {
          type: "library.folder.delete",
          commandId: cmd(),
          folderId: folderId("crew"),
          by: ada,
        }),
      ).toBe("A chat folder can't be deleted.");

      const renamedByChatCreator = yield* apply(readModel, {
        type: "library.file.update",
        commandId: cmd(),
        fileId: fileId("plan"),
        title: "Launch plan",
        by: ada,
      });

      expect(renamedByChatCreator.libraryFiles?.[0]?.title).toBe("Launch plan");
      expect(
        yield* rejection(readModel, {
          type: "library.file.delete",
          commandId: cmd(),
          fileId: fileId("plan"),
          by: ana,
        }),
      ).toBe("File 'plan' does not exist.");
    }),
  );

  it.effect("refuses library changes with no one behind them", () =>
    Effect.gen(function* () {
      const { by: _by, ...anonymous } = createFolder("a", null) as Extract<
        OrchestrationCommand,
        { type: "library.folder.create" }
      >;

      expect(yield* rejection(empty, anonymous)).toBe("Library changes need a person or bot.");
    }),
  );
});
