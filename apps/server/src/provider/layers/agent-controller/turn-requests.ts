import { type AgentSignalInput } from "@mastra/core/agent";
import * as Predicate from "effect/Predicate";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";
import type { OttoToolRuntime } from "../../otto-tool-runtime.ts";
import type { ProviderServiceError } from "../../errors.ts";
import type { AgentControllerLiveOptions } from "./options.ts";
import * as NodeCrypto from "node:crypto";
import * as FileSystem from "effect/FileSystem";

import { type ChatAttachment, TurnId, type ProviderRuntimeEvent, ThreadId } from "@otto/contracts";

import * as Deferred from "effect/Deferred";

import * as Effect from "effect/Effect";

import { resolveAttachmentPath } from "../../../attachment-store.ts";

import { ServerConfig } from "../../../config.ts";
import type { ChatMemory } from "../../../memory/memories.ts";

import type { OttoControllerHarness } from "../../mastra/otto-harness-types.ts";
import { createOttoInstructions } from "../../otto-agent-instructions.ts";
import { splitGroupTurnNote } from "../../../orchestration/group-responder.ts";

import { cancelActiveImageGenerations } from "../../../image-generation/image-generation-runtime.ts";

import { AgentControllerRuntimeError, ProviderValidationError } from "../../errors.ts";
import { type AgentControllerShape } from "../../services/agent-controller.ts";
import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";
import { inlineTextFile, MODEL_FILE_MAX_BYTES, modelReadsAttachment } from "../../chat-history.ts";
import { routineWakeText } from "../../mastra/otto-routine-signals.ts";
import { taskWakeSignal, taskWakeText } from "../../mastra/otto-task-signals.ts";

import {
  type ResolvedEngine,
  type ActiveTurn,
  type PendingTurn,
  type ActiveSession,
  type LegacyTurnMemoryState,
  type LegacyResourceIdentity,
} from "./state.ts";

const TEXT_APPLICATION_TYPES = new Set([
  "application/json",
  "application/toml",
  "application/xml",
  "application/x-yaml",
]);

type TurnContent =
  | { readonly pathLine: string }
  | {
      readonly pathLine: string;
      readonly file: {
        readonly data: string;
        readonly mediaType: string;
        readonly filename: string;
      };
    }
  | { readonly pathLine: string; readonly inline: string };

const readsAsText = (mimeType: string) =>
  mimeType.startsWith("text/") || TEXT_APPLICATION_TYPES.has(mimeType);

export function createTurnRequests(deps: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly resolvedByThread: Map<string, ResolvedEngine>;
  readonly sessions: Map<string, ActiveSession>;
  readonly usesMastraCode: (provider: ProviderDriverKind) => boolean;
  readonly legacyProviderBridge: LegacyProviderBridge["Service"];
  readonly disabledProviderError: (
    operation: string,
    providerInstanceId: ProviderInstanceId,
  ) => ProviderValidationError;
  readonly legacyResourceIdentity: Map<string, LegacyResourceIdentity>;
  readonly runMastra: <A>(
    operation: string,
    run: (signal: AbortSignal) => Promise<A>,
  ) => Effect.Effect<A, AgentControllerRuntimeError, never>;
  readonly memoryContext: (
    memory: ChatMemory | undefined,
    timezone: string | undefined,
  ) => Promise<string>;
  readonly bundle: OttoControllerHarness;
  readonly addLegacyPending: (
    key: string,
    pending: LegacyTurnMemoryState,
  ) => Map<string, LegacyTurnMemoryState[]>;
  readonly hasLegacyPending: (key: string, pending: LegacyTurnMemoryState) => boolean;
  readonly legacyHiddenWakeByTurn: Map<string, boolean>;
  readonly drainLegacyTerminals: (key: string) => Effect.Effect<void, never, never>;
  readonly removeLegacyPending: (key: string, pending: LegacyTurnMemoryState) => void;
  readonly toolRuntime: OttoToolRuntime;
  readonly config: ServerConfig["Service"];
  readonly options: AgentControllerLiveOptions | undefined;
  readonly admitPendingTurn: (
    active: ActiveSession,
    pending: PendingTurn,
  ) => Effect.Effect<void, ProviderServiceError, never>;
  readonly handlePendingTurnFailure: (
    active: ActiveSession,
    pending: PendingTurn,
    cause: unknown,
  ) => Promise<void>;
  readonly legacyPending: (key: string) => LegacyTurnMemoryState[];
  readonly legacyTurnMemory: Map<string, LegacyTurnMemoryState[]>;
  readonly legacyBufferedTerminals: Map<string, Map<string, ProviderRuntimeEvent>>;
  readonly endTurnAdmissionGeneration: (active: ActiveSession) => void;
  readonly finishTurn: (
    threadId: ThreadId,
    active: ActiveSession,
    state: "completed" | "failed" | "interrupted",
    errorMessage?: string,
  ) => void;
}) {
  // Images and PDFs go as file parts and text files inline as decoded text, which every model
  // reads (a long text file as its first lines); anything else (video, office files, archives)
  // or anything over 8 MiB only as the path line, which lets tools open the saved copy without
  // the server reading it.
  const readTurnContent = (input: string | undefined, attachments: ReadonlyArray<ChatAttachment>) =>
    Effect.forEach(
      attachments,
      (attachment): Effect.Effect<TurnContent, AgentControllerRuntimeError> => {
        const path = resolveAttachmentPath({
          attachmentsDir: deps.config.attachmentsDir,
          attachment,
        });

        if (path === null) {
          return Effect.fail(
            new AgentControllerRuntimeError({
              operation: "sendTurn.attachments",
              detail: `Attachment '${attachment.id}' has an invalid path.`,
            }),
          );
        }

        const pathLine = `[Attached ${attachment.type} "${attachment.name}" is saved at: ${path}]`;
        const asFile = modelReadsAttachment(attachment);

        if (
          !asFile &&
          !(readsAsText(attachment.mimeType) && attachment.sizeBytes <= MODEL_FILE_MAX_BYTES)
        ) {
          return Effect.succeed({ pathLine });
        }

        const readError = (cause: unknown) =>
          new AgentControllerRuntimeError({
            operation: "sendTurn.attachments",
            detail: `Could not read attachment '${attachment.id}'.`,
            cause,
          });

        const read = deps.options?.readAttachment;

        const bytes = read
          ? Effect.tryPromise({ try: () => read(path), catch: readError })
          : deps.fileSystem.readFile(path).pipe(Effect.mapError(readError));

        return bytes.pipe(
          Effect.map((bytes) => {
            const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

            if (asFile) {
              return {
                pathLine,
                file: {
                  data: buffer.toString("base64"),
                  mediaType: attachment.mimeType,
                  filename: attachment.name,
                },
              };
            }

            return { pathLine, inline: inlineTextFile(attachment.name, buffer.toString("utf8")) };
          }),
        );
      },
      { concurrency: 1 },
    ).pipe(
      Effect.map((read) => ({
        text: [
          input,
          ...read.map(({ pathLine }) => pathLine),
          ...read.flatMap((entry) => ("inline" in entry ? [entry.inline] : [])),
        ]
          .filter((part): part is string => Predicate.isString(part) && part.length > 0)
          .join("\n\n"),
        files: read.flatMap((entry) => ("file" in entry ? [entry.file] : [])),
      })),
    );

  // A turn takes signals only while its Mastra run is live: a turn waiting on an
  // approval or still being admitted has no run to read them.
  const takesSignals = (active: ActiveSession, turn: ActiveTurn | null) =>
    turn !== null &&
    active.activeTurn === turn &&
    !turn.finished &&
    !turn.waiting &&
    active.status !== "closed" &&
    active.session.run.getRunId() !== null;

  const signalTurn: AgentControllerShape["signalTurn"] = Effect.fn("AgentController.signalTurn")(
    function* (input) {
      const active = deps.sessions.get(String(input.threadId));

      if (!active) return false;
      const turn = active.activeTurn;

      if (!takesSignals(active, turn)) return false;
      const { text, files } = yield* readTurnContent(input.input, input.attachments ?? []);

      const signal: AgentSignalInput = input.taskWake
        ? yield* taskWakeSignal(input.taskWake, input.threadId, active.toolSession)
        : {
            type: "user",
            contents:
              files.length === 0
                ? text
                : [
                    { type: "text", text },
                    ...files.map((file) => ({ type: "file" as const, ...file })),
                  ],
          };

      if (!takesSignals(active, turn)) return false;

      const accepted = yield* deps.runMastra(
        "signalTurn",
        () => active.session.sendSignal(signal, { requireDelivery: true }).accepted,
      );

      return accepted.action !== "blocked" && accepted.action !== "discard";
    },
  );

  const sendTurn: AgentControllerShape["sendTurn"] = Effect.fn("AgentController.sendTurn")(
    function* (input) {
      const key = String(input.threadId);
      const resolved = deps.resolvedByThread.get(key);
      const active = deps.sessions.get(key);

      if (!active) {
        if (resolved && deps.usesMastraCode(resolved.provider)) {
          const routing = yield* deps.legacyProviderBridge.getInstanceInfo(
            resolved.providerInstanceId,
          );

          if (!routing.enabled) {
            return yield* deps.disabledProviderError(
              "AgentController.sendTurn",
              resolved.providerInstanceId,
            );
          }
        }

        if (
          deps.usesMastraCode(
            deps.resolvedByThread.get(key)?.provider ?? ProviderDriverKind.make("codex"),
          )
        ) {
          return yield* new AgentControllerRuntimeError({
            operation: "sendTurn",
            detail: `Mastra session for thread '${input.threadId}' is not running.`,
          });
        }

        const {
          botUsage: _,
          delegationResults,
          nowContext,
          memory: requestedMemory,
          taskWake,
          routineWake,
          ...requested
        } = input;

        // Otto: providers without signals read the task event or routine run as the tag
        // Mastra would send.
        const providerInput = taskWake
          ? { ...requested, input: taskWakeText(taskWake) }
          : routineWake
            ? { ...requested, input: routineWakeText(routineWake) }
            : requested;

        const turnMemory = deps.legacyResourceIdentity.get(key)?.memory
          ? requestedMemory
          : undefined;

        const memoryContext = yield* deps.runMastra("memory.render", () =>
          deps.memoryContext(turnMemory, input.timezone),
        );

        const pendingMemory: LegacyTurnMemoryState = {
          promptId: NodeCrypto.randomUUID(),
          persisted: false,
          seenEventIds: new Set(),
          user: providerInput.input ?? "",
          modelId: resolved?.mastraModelId ?? "openai/gpt-5.6-sol",
          turnId: undefined,
          dispatchReturned: false,
          earlyEvents: [],
          assistant: "",
          hiddenWake: input.hiddenWake === true,
        };

        deps.addLegacyPending(key, pendingMemory);

        const turnInstructions = resolved?.botConversation
          ? createOttoInstructions({
              ...(resolved.botName ? { name: resolved.botName } : {}),
              ...(resolved.botInstructions ? { instructions: resolved.botInstructions } : {}),
            })
          : "";

        // OpenCode reads per-turn context as its system prompt. Claude and Grok
        // only read context at session start, so this turn's text carries it.
        const contextInSystem = resolved?.provider === "opencode";

        const providerContext = [
          contextInSystem ? turnInstructions : "",
          memoryContext,
          contextInSystem ? nowContext : "",
          contextInSystem ? delegationResults : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const inputPrefix = contextInSystem
          ? []
          : [turnInstructions, nowContext, delegationResults];

        return yield* deps.legacyProviderBridge
          .sendTurn({
            ...providerInput,
            ...(inputPrefix.some(Boolean)
              ? { input: [...inputPrefix, providerInput.input].filter(Boolean).join("\n\n") }
              : {}),
            ...(providerContext ? { persistentMemoryContext: providerContext } : {}),
          })
          .pipe(
            Effect.tap((result) =>
              Effect.gen(function* () {
                if (!deps.hasLegacyPending(key, pendingMemory)) return;
                pendingMemory.turnId = String(result.turnId);

                if (input.hiddenWake === true)
                  deps.legacyHiddenWakeByTurn.set(`${key}:${pendingMemory.turnId}`, true);
                pendingMemory.dispatchReturned = true;

                for (const event of pendingMemory.earlyEvents) {
                  if (String(event.turnId) !== pendingMemory.turnId) continue;

                  if (
                    event.type === "content.delta" &&
                    event.payload.streamKind === "assistant_text"
                  ) {
                    pendingMemory.assistant += event.payload.delta;
                  }
                }

                pendingMemory.earlyEvents.length = 0;
                yield* deps.drainLegacyTerminals(key);
              }),
            ),
            Effect.tapError(() =>
              Effect.gen(function* () {
                if (deps.hasLegacyPending(key, pendingMemory)) {
                  deps.removeLegacyPending(key, pendingMemory);
                }

                yield* deps.drainLegacyTerminals(key);
              }),
            ),
          );
      }

      const turnAdmissionGeneration = active.turnAdmissionGeneration;
      const turnPreparationCancelled = active.turnPreparationCancelled;

      const prepareTurn = active.turnPreparation.withPermit(
        Effect.gen(function* () {
          if (resolved && deps.usesMastraCode(resolved.provider)) {
            const routing = yield* deps.legacyProviderBridge.getInstanceInfo(
              resolved.providerInstanceId,
            );

            if (!routing.enabled) {
              return yield* deps.disabledProviderError(
                "AgentController.sendTurn",
                resolved.providerInstanceId,
              );
            }
          }

          if (input.timezone !== undefined) {
            active.configuredToolSession = {
              ...active.configuredToolSession,
              timezone: input.timezone,
            };

            if (!active.activeTurn && !active.admittingTurn && active.pendingTurns.length === 0) {
              active.toolSession = active.configuredToolSession;
              deps.toolRuntime.registerSession(key, active.toolSession);
            }
          }

          const { text: content, files } = yield* readTurnContent(
            input.input,
            input.attachments ?? [],
          );

          if (
            deps.sessions.get(key) !== active ||
            active.status === "closed" ||
            active.turnAdmissionGeneration !== turnAdmissionGeneration
          ) {
            return yield* new AgentControllerRuntimeError({
              operation: "sendTurn",
              detail: `Mastra session for thread '${input.threadId}' is not running.`,
            });
          }

          const turnId = TurnId.make(`mastra-turn-${NodeCrypto.randomUUID()}`);
          const { text, note } = splitGroupTurnNote(content);
          active.pendingTurns.push({
            threadId: input.threadId,
            turnId,
            message: { content: text, ...(files.length > 0 ? { files } : {}) },
            turnNote: note,
            botUsage: input.botUsage,
            toolSession: active.configuredToolSession,
            memory: input.memory,
            askerPersonId: input.askerPersonId ?? null,
            hiddenWake: input.hiddenWake === true,
            delegationResults: input.delegationResults,
            nowContext: input.nowContext,
            taskWake: input.taskWake,
            routineWake: input.routineWake,
          });

          return turnId;
        }),
      );

      // An interrupt must not wait for a stalled attachment read: abandon the
      // preparation, release its permit, and fail turns still queued behind it.
      const turnId = yield* Effect.raceFirst(
        prepareTurn,
        Deferred.await(turnPreparationCancelled).pipe(
          Effect.andThen(
            Effect.fail(
              new AgentControllerRuntimeError({
                operation: "sendTurn",
                detail: `Mastra session for thread '${input.threadId}' is not running.`,
              }),
            ),
          ),
        ),
      );

      if (!active.activeTurn && !active.admittingTurn) {
        const nextTurn = active.pendingTurns.shift();

        if (nextTurn) {
          yield* deps
            .admitPendingTurn(active, nextTurn)
            .pipe(
              Effect.tapError((cause) =>
                Effect.promise(() => deps.handlePendingTurnFailure(active, nextTurn, cause)),
              ),
            );
        }
      }

      return { threadId: input.threadId, turnId };
    },
  );

  const interruptTurn: AgentControllerShape["interruptTurn"] = Effect.fn(
    "AgentController.interruptTurn",
  )(function* (input) {
    const key = String(input.threadId);
    const active = deps.sessions.get(key);

    if (!active) {
      if (
        deps.usesMastraCode(
          deps.resolvedByThread.get(key)?.provider ?? ProviderDriverKind.make("codex"),
        )
      ) {
        return;
      }

      return yield* deps.legacyProviderBridge.interruptTurn(input).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            deps.legacyTurnMemory.delete(key);
            deps.legacyBufferedTerminals.delete(key);
          }),
        ),
      );
    }

    deps.endTurnAdmissionGeneration(active);
    active.pendingTurns.length = 0;
    active.admittingTurn = null;
    active.session.abort();
    yield* cancelActiveImageGenerations(input.threadId);
    deps.finishTurn(input.threadId, active, "interrupted");
  });

  return { sendTurn, signalTurn, interruptTurn };
}
