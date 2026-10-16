import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as ServerConfig from "./config.ts";
import * as ChannelRuntime from "./channels/channel-runtime.ts";
import * as Keybindings from "./keybindings.ts";
import * as OrchestrationEngine from "./orchestration/services/orchestration-engine.ts";
import * as OrchestrationReactor from "./orchestration/services/orchestration-reactor.ts";
import * as ServerLifecycleEvents from "./server-lifecycle-events.ts";
import * as ServerSettings from "./server-settings.ts";
import * as ServerEnvironment from "./environment/server-environment.ts";
import * as ProviderSessionReaper from "./provider/services/provider-session-reaper.ts";
import { forkParked } from "./server-activation.ts";
import * as ServiceLauncherClient from "./cloud/service-launcher-client.ts";
import { isRemoteInstall } from "./remote/remote-mode.ts";
import { formatHeadlessServeOutput, resolveHeadlessServeUrl } from "./startup-access.ts";
import { RoutineRuntime } from "./routines/runtime.ts";

import { type StartupOptions, restoreExternalChannels } from "./startup-channels.ts";
import {
  scopedCommandGate,
  ServerRuntimeStartupError,
  ServerRuntimeStartup,
} from "./startup-command-gate.ts";
import { archivedBotRetentionLoop } from "./archived-bot-retention.ts";
import { dailyBackupLoop } from "./backup.ts";
import { reconcileDelegations, reconcileProviderSessions } from "./startup-reconciliation.ts";
import {
  resolveWelcomeBase,
  resolveAutoBootstrapWelcomeTargets,
  resolveStartupBrowserTarget,
  maybeOpenBrowser,
} from "./startup-welcome.ts";

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

export const make = (options?: StartupOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const keybindings = yield* Keybindings.Keybindings;
    const orchestrationReactor = yield* OrchestrationReactor.OrchestrationReactor;
    const providerSessionReaper = yield* ProviderSessionReaper.ProviderSessionReaper;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const crypto = yield* Crypto.Crypto;
    const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;
    const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
    const channelRuntime = yield* Effect.serviceOption(ChannelRuntime.ChannelRuntime);

    const commandGate = yield* scopedCommandGate;
    const httpListening = yield* Deferred.make<void>();
    const reactorScope = yield* Scope.make("sequential");

    yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

    const startup = Effect.gen(function* () {
      yield* Effect.logDebug("startup phase: starting keybindings runtime");
      yield* runStartupPhase(
        "keybindings.start",
        keybindings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start keybindings runtime", {
              path: error.configPath,
              detail: error.detail,
              cause: error.cause,
            }),
          ),
        ),
      );

      yield* Effect.logDebug("startup phase: starting server settings runtime");
      yield* runStartupPhase(
        "settings.start",
        serverSettings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start server settings runtime", {
              path: error.settingsPath,
              operation: error.operation,
              providerInstanceId: error.providerInstanceId,
              environmentVariable: error.environmentVariable,
              cause: error.cause,
            }),
          ),
        ),
      );

      // Before the reactors start, so no delegation this process creates can be mistaken for an
      // orphan, and startup recovery sees the settled records.
      yield* runStartupPhase("delegations.reconcile", reconcileDelegations);

      yield* Effect.logDebug("startup phase: parking orchestration roots at activation");
      yield* runStartupPhase(
        "reactors.start",
        Effect.gen(function* () {
          yield* orchestrationReactor.start().pipe(Scope.provide(reactorScope));
          yield* providerSessionReaper.start().pipe(Scope.provide(reactorScope));

          if (Option.isSome(channelRuntime)) {
            yield* forkParked(
              channelRuntime.value.stopArchivedBotChannels(orchestrationEngine.streamDomainEvents),
            ).pipe(Scope.provide(reactorScope));
          }

          const routineRuntime = yield* Effect.serviceOption(RoutineRuntime);

          if (Option.isSome(routineRuntime)) {
            yield* routineRuntime.value.start.pipe(Scope.provide(reactorScope));
          }
        }),
      );

      yield* runStartupPhase("provider-sessions.reconcile", reconcileProviderSessions);

      yield* forkParked(archivedBotRetentionLoop).pipe(Scope.provide(reactorScope));
      yield* forkParked(dailyBackupLoop).pipe(Scope.provide(reactorScope));

      yield* runStartupPhase(
        "channels.restore",
        Option.match(channelRuntime, {
          onNone: () => Effect.void,
          onSome: restoreExternalChannels,
        }),
      );

      const welcomeBase = yield* resolveWelcomeBase;
      const environment = yield* serverEnvironment.getDescriptor;
      yield* Effect.logDebug("startup phase: preparing welcome payload");

      {
        // Always attempt: resolveAutoBootstrapWelcomeTargets returns empty
        // targets when a project already exists and no flag forces it.
        yield* forkParked(
          runStartupPhase(
            "welcome.autobootstrap",
            Effect.gen(function* () {
              const bootstrapTargets = yield* resolveAutoBootstrapWelcomeTargets.pipe(
                Effect.provideService(Crypto.Crypto, crypto),
              );

              if (!bootstrapTargets.bootstrapProjectId && !bootstrapTargets.bootstrapThreadId) {
                return;
              }

              yield* Effect.logDebug("startup phase: publishing bootstrapped welcome event", {
                environmentId: environment.environmentId,
                cwd: welcomeBase.cwd,
                projectName: welcomeBase.projectName,
                bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
                bootstrapThreadId: bootstrapTargets.bootstrapThreadId,
              });
              yield* lifecycleEvents.publish({
                version: 1,
                type: "welcome",
                payload: {
                  environment,
                  ...welcomeBase,
                  ...bootstrapTargets,
                },
              });
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("startup auto-bootstrap welcome failed", {
                  cause,
                }),
              ),
            ),
          ),
        );
      }

      yield* forkParked(
        Effect.gen(function* () {
          // Otto: Remote installs run headless under the boot service or in a container, so the
          // address goes to stdout, which `otto remote logs` and `docker logs` show.
          if (
            isRemoteInstall({ launcherManaged: launcher.managed, env: process.env }) ||
            serverConfig.startupPresentation === "headless"
          ) {
            const url = yield* resolveHeadlessServeUrl();
            yield* runStartupPhase("headless.output", Console.log(formatHeadlessServeOutput(url)));
          } else {
            const startupBrowserTarget = yield* resolveStartupBrowserTarget;

            if (serverConfig.mode !== "desktop") {
              yield* Effect.logInfo("Otto is ready.").pipe(
                Effect.annotateLogs({ url: startupBrowserTarget }),
              );
            }

            yield* runStartupPhase("browser.open", maybeOpenBrowser(startupBrowserTarget));
          }
        }),
      );

      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* runStartupPhase(
        "auxiliary-roots.parked",
        options?.awaitAuxiliaryParked ?? Effect.void,
      );

      // This is the prepared boundary. Every dependency has been acquired and
      // every runtime root has confirmed that it is parked before this request.
      const updateOutcome = yield* launcher.prepareTrial;
      yield* runStartupPhase(
        "welcome.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "welcome",
          payload: { environment, ...welcomeBase },
        }),
      );
      yield* options?.activate ?? Effect.void;

      yield* Effect.logDebug("Accepting commands");
      yield* commandGate.signalCommandReady;
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: DateTime.formatIso(yield* DateTime.now),
            environment,
            ...(updateOutcome === undefined ? {} : { updateOutcome }),
          },
        }),
      );
      yield* Effect.logDebug("startup phase: complete");
    }).pipe(
      Effect.annotateSpans({
        "server.mode": serverConfig.mode,
        "server.port": serverConfig.port,
        "server.host": serverConfig.host ?? "default",
      }),
      Effect.withSpan("server.startup", { kind: "server", root: true }),
    );

    yield* Effect.forkScoped(
      Effect.exit(startup).pipe(
        Effect.flatMap((startupExit) => {
          if (Exit.isSuccess(startupExit)) return Effect.void;

          const error = new ServerRuntimeStartupError({
            mode: serverConfig.mode,
            host: serverConfig.host ?? null,
            port: serverConfig.port,
            cause: startupExit.cause,
          });

          return Effect.logError("server runtime startup failed", {
            cause: startupExit.cause,
          }).pipe(
            Effect.andThen(commandGate.failCommandReady(error)),
            Effect.andThen(options?.abort?.(error) ?? Effect.void),
          );
        }),
      ),
    );

    return {
      awaitCommandReady: commandGate.awaitCommandReady,
      markHttpListening: Deferred.succeed(httpListening, undefined),
      enqueueCommand: commandGate.enqueueCommand,
    } satisfies ServerRuntimeStartup["Service"];
  });

export const layerWithOptions = (options?: StartupOptions) =>
  Layer.effect(ServerRuntimeStartup, make(options));

export const layer = layerWithOptions();

export {
  ServerRuntimeStartupError,
  ServerRuntimeStartup,
  scopedCommandGate,
} from "./startup-command-gate.ts";

export {
  getAutoBootstrapDefaultModelSelection,
  resolveWelcomeBase,
  resolveAutoBootstrapWelcomeTargets,
} from "./startup-welcome.ts";

export {
  reconcileProviderSessions,
  DELEGATION_RESTART_FAILURE_MESSAGE,
  reconcileDelegations,
} from "./startup-reconciliation.ts";

export { restoreExternalChannels } from "./startup-channels.ts";
