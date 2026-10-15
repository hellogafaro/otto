import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { CommandId, ProjectId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/workspace-paths.ts";
import { normalizeDispatchCommand } from "./normalizer.ts";

const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "otto-normalizer-project-folder-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("normalizeDispatchCommand project folders", () => {
  it.effect("creates a managed folder for a project created without one", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;

      const normalized = yield* normalizeDispatchCommand({
        type: "project.create",
        commandId: CommandId.make("command-1"),
        projectId: ProjectId.make("project-launch"),
        title: "Launch",
        createdAt: "2026-08-01T00:00:00.000Z",
      });

      if (normalized.type !== "project.create") {
        throw new Error("Expected a project.create command.");
      }

      const expectedRoot = NodePath.join(config.projectsDir, "project-launch");
      expect(NodeFS.realpathSync(normalized.workspaceRoot ?? "")).toBe(
        NodeFS.realpathSync(expectedRoot),
      );
      expect(NodeFS.statSync(expectedRoot).isDirectory()).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("refuses a managed folder for an id that is not a plain name", () =>
    Effect.gen(function* () {
      const error = yield* normalizeDispatchCommand({
        type: "project.create",
        commandId: CommandId.make("command-2"),
        projectId: ProjectId.make("../escape"),
        title: "Escape",
        createdAt: "2026-08-01T00:00:00.000Z",
      }).pipe(Effect.flip);

      expect(error.message).toContain("letters, digits");
    }).pipe(Effect.provide(testLayer)),
  );
});
