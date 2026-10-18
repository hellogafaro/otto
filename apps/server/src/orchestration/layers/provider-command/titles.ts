import * as Data from "effect/Data";
import {
  type ChatAttachment,
  CommandId,
  type MessageId,
  type ModelSelection,
  type OrchestrationThreadShell,
  PLACEHOLDER_THREAD_TITLE,
  ProviderInstanceId,
  ThreadId,
} from "@otto/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { makeDrainableWorker } from "@otto/shared/DrainableWorker";
import { resolveThreadWorkspaceCwd } from "../../../checkpointing/utils.ts";
import { DEFAULT_THREAD_TITLE } from "../../thread-titles.ts";
import { type ProviderIntentEvent, resolveControllerBotId } from "./fields.ts";
import { formatThreadTitleContext } from "./title-context.ts";
import type { createContext } from "./context.ts";
import type { createWorkspace } from "./workspace.ts";
import type { createDependencies } from "./dependencies.ts";

const TitleRegeneration = Data.taggedEnum<
  | { readonly _tag: "Superseded" }
  | { readonly _tag: "Completed"; readonly title: string | undefined }
>();

/** Hidden prompts (routine runs, a new bot's introduction) never name the chat. */
const HIDDEN_PROMPT_MESSAGE_ID_PREFIXES = ["routine:", "intro:"] as const;

function isHiddenPromptMessageId(messageId: MessageId): boolean {
  return HIDDEN_PROMPT_MESSAGE_ID_PREFIXES.some((prefix) => messageId.startsWith(prefix));
}

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

/**
 * Whether a chat still carries a title nobody chose: the placeholder, or the
 * copy of the first message (or its first file's name) a client sets on send,
 * cut short with an ellipsis when long.
 */
export function isAutomaticThreadTitle(
  title: string,
  messageText: string,
  attachments: ReadonlyArray<ChatAttachment> | undefined,
): boolean {
  if (title === PLACEHOLDER_THREAD_TITLE || title === DEFAULT_THREAD_TITLE) return true;

  const firstAttachment = attachments?.[0];

  if (firstAttachment && title === `File: ${firstAttachment.name}`) return true;

  const seed = collapseWhitespace(title.replace(/(…|\.\.\.)$/u, ""));

  return seed.length > 0 && collapseWhitespace(messageText).startsWith(seed);
}

export const createTitles = Effect.fn("makeprovider-command-Titles")(function* ({
  resolveThreadDetail,
  resolveProject,
  serverSettingsService,
  textGeneration,
  resolveThreadShell,
  orchestrationEngine,
  serverCommandId,
  projectionSnapshotQuery,
  projectionBotRepository,
}: Pick<
  ReturnType<typeof createContext> &
    ReturnType<typeof createWorkspace> &
    Effect.Success<ReturnType<typeof createDependencies>>,
  | "resolveThreadDetail"
  | "resolveProject"
  | "serverSettingsService"
  | "textGeneration"
  | "resolveThreadShell"
  | "orchestrationEngine"
  | "serverCommandId"
  | "projectionSnapshotQuery"
  | "projectionBotRepository"
>) {
  /**
   * Models to write a title with, best first: the model the chat's bot answers with,
   * then the text generation model from Settings. A provider that cannot write
   * titles, or fails, falls through to the next one.
   */
  const titleModelSelections = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThreadShell, "botId" | "respondingBotId">,
  ) {
    const { textGenerationModelSelection } = yield* serverSettingsService.getSettings;
    const botId = resolveControllerBotId(thread);

    const engine =
      botId === null
        ? null
        : yield* projectionBotRepository.getById({ botId }).pipe(
            Effect.map((bot) => Option.getOrUndefined(bot)?.engine ?? null),
            Effect.orElseSucceed(() => null),
          );

    const botSelection: ModelSelection | null = engine
      ? {
          instanceId: ProviderInstanceId.make(engine.provider),
          model: engine.model,
          ...(engine.options ? { options: engine.options } : {}),
        }
      : null;

    return botSelection === null ||
      (botSelection.instanceId === textGenerationModelSelection.instanceId &&
        botSelection.model === textGenerationModelSelection.model)
      ? [textGenerationModelSelection]
      : [botSelection, textGenerationModelSelection];
  });

  const generateTitle = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThreadShell, "botId" | "respondingBotId">,
    input: Omit<Parameters<typeof textGeneration.generateThreadTitle>[0], "modelSelection">,
  ) {
    const [first, ...rest] = yield* titleModelSelections(thread);

    return yield* rest.reduce(
      (attempt, modelSelection) =>
        attempt.pipe(
          Effect.catch((error) =>
            Effect.logInfo("title generation falling back to the next model", {
              instanceId: modelSelection.instanceId,
              detail: error.detail,
            }).pipe(
              Effect.andThen(textGeneration.generateThreadTitle({ ...input, modelSelection })),
            ),
          ),
        ),
      textGeneration.generateThreadTitle({ ...input, modelSelection: first! }),
    );
  });

  const regenerateThreadTitle = Effect.fn("regenerateThreadTitle")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>,
    requestId: CommandId,
  ) {
    if (event.payload.regenerateTitle !== true) {
      return TitleRegeneration.Superseded();
    }

    const thread = yield* resolveThreadDetail(event.payload.threadId);

    if (!thread || thread.titleRegeneration?.requestId !== requestId) {
      return TitleRegeneration.Superseded();
    }

    const { message, attachments } = formatThreadTitleContext(thread.messages);

    if (message.length === 0) {
      return TitleRegeneration.Completed({ title: undefined });
    }

    const previousTitle = event.payload.previousTitle ?? thread.title;

    if (thread.title !== previousTitle) {
      return TitleRegeneration.Superseded();
    }

    const project = yield* resolveProject(thread.projectId);

    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      }) ?? process.cwd();

    const generated = yield* generateTitle(thread, {
      cwd,
      message,
      previousTitle,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    if (
      generated.title === DEFAULT_THREAD_TITLE ||
      generated.title === PLACEHOLDER_THREAD_TITLE ||
      generated.title === previousTitle
    ) {
      return TitleRegeneration.Completed({ title: undefined });
    }

    const latestThread = yield* resolveThreadShell(event.payload.threadId);

    if (
      !latestThread ||
      latestThread.titleRegeneration?.requestId !== requestId ||
      latestThread.title !== previousTitle
    ) {
      return TitleRegeneration.Superseded();
    }

    return TitleRegeneration.Completed({ title: generated.title });
  });

  /**
   * Names a chat from its first message. The chat keeps the client's copy of the
   * message (or the placeholder) until the generated title is ready, and a title
   * someone set by hand is never replaced.
   */
  const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
    }) {
      const thread = yield* resolveThreadShell(input.threadId);

      if (
        !thread ||
        isHiddenPromptMessageId(input.messageId) ||
        !isAutomaticThreadTitle(thread.title, input.messageText, input.attachments)
      ) {
        return;
      }

      const project = yield* resolveProject(thread.projectId);
      const attachments = input.attachments ?? [];

      const generated = yield* generateTitle(thread, {
        cwd:
          resolveThreadWorkspaceCwd({ thread, projects: project ? [project] : [] }) ??
          process.cwd(),
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
      });

      if (
        generated.title === DEFAULT_THREAD_TITLE ||
        generated.title === PLACEHOLDER_THREAD_TITLE
      ) {
        return;
      }

      // Generation takes seconds: write only if no one renamed the chat meanwhile.
      const latest = yield* resolveThreadShell(input.threadId);

      if (
        !latest ||
        latest.title === generated.title ||
        latest.titleRegeneration != null ||
        !isAutomaticThreadTitle(latest.title, input.messageText, input.attachments)
      ) {
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("first-turn-thread-title"),
        threadId: input.threadId,
        title: generated.title,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("provider command reactor failed to generate a first-turn title", {
                threadId: input.threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );

  const dispatchThreadTitleRegenerationCompletion = Effect.fn(
    "dispatchThreadTitleRegenerationCompletion",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly title?: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: yield* serverCommandId("thread-title-regeneration-complete"),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
  });

  const findInterruptedThreadTitleRegenerations = Effect.fn(
    "findInterruptedThreadTitleRegenerations",
  )(function* () {
    const readModel = yield* projectionSnapshotQuery.getCommandReadModel();

    return readModel.threads.flatMap((thread) => {
      const requestId = thread.titleRegeneration?.requestId;

      return requestId === undefined ? [] : [{ threadId: thread.id, requestId }];
    });
  });

  const clearInterruptedThreadTitleRegenerations = Effect.fn(
    "clearInterruptedThreadTitleRegenerations",
  )(function* (
    interrupted: ReadonlyArray<{ readonly threadId: ThreadId; readonly requestId: CommandId }>,
  ) {
    yield* Effect.forEach(
      interrupted,
      ({ threadId, requestId }) => {
        return dispatchThreadTitleRegenerationCompletion({
          threadId,
          requestId,
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.interrupt;
            }

            return Effect.logWarning(
              "provider command reactor failed to clear interrupted title regeneration",
              {
                threadId,
                cause: Cause.pretty(cause),
              },
            );
          }),
        );
      },
      { discard: true },
    );
  });

  const processThreadTitleRegenerationSafely = Effect.fn("processThreadTitleRegenerationSafely")(
    function* (event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>) {
      if (event.payload.regenerateTitle !== true) {
        return;
      }

      const requestId = event.payload.titleRegeneration?.requestId ?? event.commandId;

      if (requestId === null) {
        return;
      }

      const result = yield* regenerateThreadTitle(event, requestId).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }

          return Effect.logWarning("provider command reactor failed to regenerate thread title", {
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(TitleRegeneration.Completed({ title: undefined })));
        }),
      );

      if (TitleRegeneration.$is("Superseded")(result)) {
        return;
      }

      const completion = {
        threadId: event.payload.threadId,
        requestId,
        ...(result.title !== undefined ? { title: result.title } : {}),
      };

      yield* dispatchThreadTitleRegenerationCompletion(completion).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }

          return Effect.logWarning(
            "provider command reactor retrying title regeneration completion",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          ).pipe(Effect.andThen(dispatchThreadTitleRegenerationCompletion(completion)));
        }),
      );
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }

          return Effect.logWarning(
            "provider command reactor failed to complete title regeneration",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          );
        }),
      ),
  );

  const threadTitleRegenerationWorker = yield* makeDrainableWorker(
    processThreadTitleRegenerationSafely,
  );

  return {
    maybeGenerateThreadTitleForFirstTurn,
    regenerateThreadTitle,
    dispatchThreadTitleRegenerationCompletion,
    findInterruptedThreadTitleRegenerations,
    clearInterruptedThreadTitleRegenerations,
    processThreadTitleRegenerationSafely,
    threadTitleRegenerationWorker,
  };
});
