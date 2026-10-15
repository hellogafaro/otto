import {
  AuthSessionId,
  CommandId,
  type LibraryFile,
  LibraryFileId,
  LibraryFolderId,
  type OrchestrationReadModel,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { asEventId, asProjectId } from "./test-support/project-decider-fixtures.ts";

const now = "2026-01-01T00:00:00.000Z";

const projectId = asProjectId("project-cover");

const otherProjectId = asProjectId("project-other");

const ana = { kind: "person", personId: AuthSessionId.make("ana"), displayName: "Ana" } as const;

const folder = (id: string, forProject: typeof projectId) => ({
  id: LibraryFolderId.make(id),
  parentId: null,
  projectId: forProject,
  title: id,
  visibility: "organization" as const,
  createdBy: ana,
  createdAt: now,
  updatedBy: ana,
  updatedAt: now,
});

const file = (id: string, overrides: Partial<LibraryFile> = {}): LibraryFile => ({
  id: LibraryFileId.make(id),
  folderId: LibraryFolderId.make("cover-folder"),
  type: "image",
  title: `${id}.png`,
  extension: "png",
  sizeBytes: 10,
  visibility: "organization",
  createdBy: ana,
  createdAt: now,
  updatedBy: ana,
  updatedAt: now,
  ...overrides,
});

const withProject = Effect.gen(function* () {
  const readModel = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: asEventId("evt-project-cover"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("cmd-project-cover"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-project-cover"),
    metadata: {},
    payload: {
      projectId,
      title: "Cover",
      workspaceRoot: "/tmp/cover",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  return {
    ...readModel,
    libraryFolders: [folder("cover-folder", projectId), folder("other-folder", otherProjectId)],
    libraryFiles: [
      file("cover"),
      file("notes", { type: "document", extension: "md" }),
      file("private", { visibility: "user" }),
      file("elsewhere", { folderId: LibraryFolderId.make("other-folder") }),
    ],
  } satisfies OrchestrationReadModel;
});

const setCover = (readModel: OrchestrationReadModel, coverFileId: string | null) =>
  decideOrchestrationCommand({
    command: {
      type: "project.meta.update",
      commandId: CommandId.make("cmd-set-cover"),
      projectId,
      coverFileId: coverFileId === null ? null : LibraryFileId.make(coverFileId),
    },
    readModel,
  });

it.layer(NodeServices.layer)("decider project cover", (it) => {
  it.effect("sets and clears an image in the project's folder as the cover", () =>
    Effect.gen(function* () {
      const readModel = yield* withProject;

      for (const coverFileId of ["cover", null]) {
        const result = yield* setCover(readModel, coverFileId);
        const event = Array.isArray(result) ? result[0] : result;

        expect(event.type).toBe("project.meta-updated");
        expect((event.payload as { coverFileId?: string | null }).coverFileId).toBe(coverFileId);
      }
    }),
  );

  it.effect("refuses anything but an organization image in the project's folder", () =>
    Effect.gen(function* () {
      const readModel = yield* withProject;

      for (const coverFileId of ["notes", "private", "elsewhere", "missing"]) {
        const error = yield* Effect.flip(setCover(readModel, coverFileId));

        expect(error.message).toContain(
          "A project cover must be an image in the project's folder.",
        );
      }
    }),
  );
});
