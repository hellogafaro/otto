import {
  type BotId,
  CommandId,
  EventId,
  type ModelSelection,
  type McpServer,
} from "@otto/contracts";
import * as Cache from "effect/Cache";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { TextGeneration } from "../../../text-generation/text-generation.ts";
import { BotUsageLedger } from "../../../usage/bot-usage-ledger.ts";
import { AgentController } from "../../../provider/services/agent-controller.ts";
import { ProviderSessionDirectory } from "../../../provider/services/provider-session-directory.ts";
import { ProviderRegistry } from "../../../provider/services/provider-registry.ts";
import { ProjectionBotRepository } from "../../../persistence/services/projection-bots.ts";
import { ProjectionMcpServerRepository } from "../../../persistence/services/projection-mcp-servers.ts";
import { OrchestrationEngineService } from "../../services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../../services/projection-snapshot-query.ts";
import { ServerSettingsService } from "../../../server-settings.ts";
import { GitWorkflowService } from "../../../git/git-workflow-service.ts";
import { ComposioService } from "../../../composio/composio-service.ts";
import { ServerSecretStore } from "../../../auth/server-secret-store.ts";
import { OrganizationAccounts } from "../../../auth/organization-accounts.ts";
import { ProjectionProjectRepository } from "../../../persistence/services/projection-projects.ts";
import { HANDLED_TURN_REQUEST_KEY_MAX, HANDLED_TURN_REQUEST_KEY_TTL } from "./fields.ts";

export const createDependencies = Effect.fn("makeprovider-command-Dependencies")(function* () {
  const crypto = yield* Crypto.Crypto;

  const orchestrationEngine = yield* OrchestrationEngineService;

  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const projectionBotRepository = yield* ProjectionBotRepository;

  const projectionMcpServerRepository = yield* ProjectionMcpServerRepository;

  const agentController = yield* AgentController;

  const providerSessionDirectory = yield* Effect.serviceOption(ProviderSessionDirectory);

  const providerRegistry = yield* ProviderRegistry;

  const gitWorkflow = yield* GitWorkflowService;

  const fileSystem = yield* FileSystem.FileSystem;

  const textGeneration = yield* TextGeneration;

  const serverSettingsService = yield* ServerSettingsService;

  const botUsageLedger = yield* BotUsageLedger;

  const composio = yield* Effect.serviceOption(ComposioService);

  const secretStore = yield* Effect.serviceOption(ServerSecretStore);

  const accounts = yield* Effect.serviceOption(OrganizationAccounts);

  const projects = yield* Effect.serviceOption(ProjectionProjectRepository);

  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  if (agentController.configurePluginRuntime) {
    yield* agentController.configurePluginRuntime({
      readSnapshot: () => runPromise(projectionSnapshotQuery.getCommandReadModel()),
      dispatch: (command) => runPromise(orchestrationEngine.dispatch(command)),
      ...(Option.isSome(composio)
        ? {
            searchComposioToolkits: async (input: {
              readonly query?: string;
              readonly limit?: number;
              readonly bot?: { readonly botId: string; readonly ownerPersonId: string | null };
            }) => {
              if (!(await runPromise(composio.value.isConfigured))) {
                return { status: "setup-required" as const, toolkits: [] };
              }

              const [toolkits, connectedToolkits] = await Promise.all([
                runPromise(composio.value.searchToolkits(input)),
                runPromise(
                  composio.value.connectedToolkits(
                    input.bot ?? { botId: null, ownerPersonId: null },
                  ),
                ),
              ]);

              return { status: "available" as const, toolkits, connectedToolkits };
            },
          }
        : {}),
    });
  }

  if (agentController.configureDelegation) {
    yield* agentController.configureDelegation({
      readSnapshot: () => runPromise(projectionSnapshotQuery.getCommandReadModel()),
      readThread: (threadId) =>
        runPromise(
          projectionSnapshotQuery
            .getThreadDetailById(threadId, { activityKinds: [] })
            .pipe(Effect.map(Option.getOrUndefined)),
        ),
      dispatch: (command) => runPromise(orchestrationEngine.dispatch(command)),
    });
  }

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));

  const handledTurnRequestKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_REQUEST_KEY_MAX,
    timeToLive: HANDLED_TURN_REQUEST_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnRequestRecently = (key: string) =>
    Cache.getOption(handledTurnRequestKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnRequestKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();

  const threadBotWorkspaceKeys = new Map<string, string>();

  const threadRespondingBotIds = new Map<string, BotId | null>();

  const threadMcpServers = new Map<string, readonly McpServer[]>();

  const threadsAwaitingRestrictiveSessionCleanup = new Set<string>();

  return {
    crypto,
    orchestrationEngine,
    projectionSnapshotQuery,
    projectionBotRepository,
    projectionMcpServerRepository,
    agentController,
    providerSessionDirectory,
    providerRegistry,
    gitWorkflow,
    fileSystem,
    textGeneration,
    serverSettingsService,
    botUsageLedger,
    composio,
    secretStore,
    accounts,
    projects,
    runPromise,
    serverCommandId,
    serverEventId,
    handledTurnRequestKeys,
    hasHandledTurnRequestRecently,
    threadModelSelections,
    threadBotWorkspaceKeys,
    threadRespondingBotIds,
    threadMcpServers,
    threadsAwaitingRestrictiveSessionCleanup,
  };
});
