import {
  CommandId,
  DEFAULT_MODEL,
  GENERAL_PROJECT_ID,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  PLACEHOLDER_THREAD_TITLE,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ServerConfig from "./config.ts";
import * as ExternalLauncher from "./process/external-launcher.ts";
import * as OrchestrationEngine from "./orchestration/services/orchestration-engine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/services/projection-snapshot-query.ts";
import { formatHostForUrl, isWildcardHost } from "./startup-access.ts";

export const getAutoBootstrapDefaultModelSelection = (): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
});

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

export const resolveAutoBootstrapWelcomeTargets = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const path = yield* Path.Path;

  let bootstrapProjectId: ProjectId | undefined;
  let bootstrapThreadId: ThreadId | undefined;

  // Otto always lands in a chat: on first run, with no active project, it opens one in the
  // General project, so a bot click never dead-ends at the add-project wall.
  const firstRun = !(yield* projectionReadModelQuery.getCommandReadModel()).projects.some(
    (project) => project.deletedAt === null,
  );

  // Otto: General is where "No project" chats live. Its folder is its own, under the projects
  // folder, so bots never work in the server's own folder.
  const general = yield* projectionReadModelQuery.getProjectShellById(GENERAL_PROJECT_ID);

  if (Option.isNone(general)) {
    const workspaceRoot = path.join(serverConfig.projectsDir, GENERAL_PROJECT_ID);

    yield* (yield* FileSystem.FileSystem).makeDirectory(workspaceRoot, { recursive: true });

    yield* orchestrationEngine.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* randomUUID),
      projectId: GENERAL_PROJECT_ID,
      title: "General",
      workspaceRoot,
      defaultModelSelection: getAutoBootstrapDefaultModelSelection(),
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  }

  const shouldBootstrap = serverConfig.autoBootstrapProjectFromCwd || firstRun;

  if (shouldBootstrap) {
    yield* Effect.gen(function* () {
      const existingProject = serverConfig.autoBootstrapProjectFromCwd
        ? yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(serverConfig.cwd)
        : Option.some({
            id: GENERAL_PROJECT_ID,
            defaultModelSelection: Option.getOrUndefined(general)?.defaultModelSelection,
          });

      let nextProjectId: ProjectId;
      let nextProjectDefaultModelSelection: ModelSelection;

      if (Option.isNone(existingProject)) {
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        nextProjectId = ProjectId.make(yield* randomUUID);
        const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
        nextProjectDefaultModelSelection = getAutoBootstrapDefaultModelSelection();
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(yield* randomUUID),
          projectId: nextProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: serverConfig.cwd,
          defaultModelSelection: nextProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        nextProjectId = existingProject.value.id;
        nextProjectDefaultModelSelection =
          existingProject.value.defaultModelSelection ?? getAutoBootstrapDefaultModelSelection();
      }

      const existingThreadId =
        yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);

      if (Option.isNone(existingThreadId)) {
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const createdThreadId = ThreadId.make(yield* randomUUID);
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(yield* randomUUID),
          threadId: createdThreadId,
          projectId: nextProjectId,
          title: PLACEHOLDER_THREAD_TITLE,
          modelSelection: nextProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = createdThreadId;
      } else {
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = existingThreadId.value;
      }
    });
  }

  return {
    ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
    ...(bootstrapThreadId ? { bootstrapThreadId } : {}),
  } as const;
});

export const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const localUrl = `http://localhost:${serverConfig.port}`;

  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;

  // Otto: The app itself shows setup until an owner claims it, then sign-in.
  return serverConfig.publicOrigin ?? serverConfig.devUrl?.toString() ?? bindUrl;
});

export const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;

    if (serverConfig.noBrowser) {
      return;
    }

    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;

    yield* externalLauncher.launchBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("browser auto-open unavailable", {
          hint: `Open ${target} in your browser.`,
        }),
      ),
    );
  });
