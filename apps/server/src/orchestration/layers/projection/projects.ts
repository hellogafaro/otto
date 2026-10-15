import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type ProjectionDependencies, type ProjectorDefinition } from "./definitions.ts";

export function createProjects({
  projectionProjectRepository,
}: Pick<ProjectionDependencies, "projectionProjectRepository">) {
  const applyProjectsProjection: ProjectorDefinition["apply"] = Effect.fn(
    "applyProjectsProjection",
  )(function* (event, _attachmentSideEffects) {
    switch (event.type) {
      case "project.created":
        yield* projectionProjectRepository.upsert({
          projectId: event.payload.projectId,
          title: event.payload.title,
          workspaceRoot: event.payload.workspaceRoot,
          defaultModelSelection: event.payload.defaultModelSelection,
          defaultThreadEnvMode: null,
          faviconPath: event.payload.faviconPath ?? null,
          scripts: event.payload.scripts,
          description: event.payload.description ?? null,
          owner: event.payload.owner ?? null,
          resources: event.payload.resources ?? null,
          status: event.payload.status ?? null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          deletedAt: null,
        });

        return;

      case "project.meta-updated": {
        const existingRow = yield* projectionProjectRepository.getById({
          projectId: event.payload.projectId,
        });

        if (Option.isNone(existingRow)) {
          return;
        }

        yield* projectionProjectRepository.upsert({
          ...existingRow.value,
          ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
          ...(event.payload.workspaceRoot !== undefined
            ? { workspaceRoot: event.payload.workspaceRoot }
            : {}),
          ...(event.payload.defaultModelSelection !== undefined
            ? { defaultModelSelection: event.payload.defaultModelSelection }
            : {}),
          ...(event.payload.defaultThreadEnvMode !== undefined
            ? { defaultThreadEnvMode: event.payload.defaultThreadEnvMode }
            : {}),
          ...(event.payload.faviconPath !== undefined
            ? { faviconPath: event.payload.faviconPath }
            : {}),
          ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
          ...(event.payload.description !== undefined
            ? { description: event.payload.description }
            : {}),
          ...(event.payload.owner !== undefined ? { owner: event.payload.owner } : {}),
          ...(event.payload.resources !== undefined ? { resources: event.payload.resources } : {}),
          ...(event.payload.status !== undefined ? { status: event.payload.status } : {}),
          ...(event.payload.coverFileId !== undefined
            ? { coverFileId: event.payload.coverFileId }
            : {}),
          updatedAt: event.payload.updatedAt,
        });

        return;
      }

      case "project.deleted": {
        const existingRow = yield* projectionProjectRepository.getById({
          projectId: event.payload.projectId,
        });

        if (Option.isNone(existingRow)) {
          return;
        }

        yield* projectionProjectRepository.upsert({
          ...existingRow.value,
          deletedAt: event.payload.deletedAt,
          updatedAt: event.payload.deletedAt,
        });

        return;
      }

      default:
        return;
    }
  });

  return { applyProjectsProjection };
}
