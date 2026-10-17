import type { OttoRunOptions } from "./mastra/otto-models.ts";

import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import { createPersistExternalTurn } from "./mastra/otto-conversation.ts";
import { Agent } from "@mastra/core/agent";
import {
  AgentController as MastraAgentController,
  type MastraDBMessage,
} from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";

import * as Effect from "effect/Effect";
import {
  type OttoMastraHarnessOptions,
  type OttoMastraState,
  type OttoMastraSession,
  type OttoMastraHarness,
} from "./mastra/otto-harness-types.ts";
import {
  createOttoMastraMemory,
  controllerModelId,
  controllerModelOptions,
  controllerModelConnection,
  controllerResourceId,
} from "./mastra/otto-memory.ts";
import { withLastRequest } from "./mastra/otto-compaction.ts";
import { OttoMastraHarnessError } from "./mastra/otto-harness-errors.ts";
import { storedChatContexts, withOttoPrompt } from "./mastra/otto-instructions.ts";
import {
  resolveOttoMastraModel,
  DEFAULT_MODEL_ID,
  withOttoModelRunOptions,
} from "./mastra/otto-models.ts";
import { OttoTaskStateProcessor } from "./mastra/otto-task-signals.ts";
import { resolveOttoTools } from "./mastra/otto-tools.ts";
import { ottoErrorProcessors } from "./mastra/otto-error-processors.ts";
import { ottoToolCategory, routineToolNeedsGlobalApproval } from "./mastra/otto-actions.ts";

interface ControllerRunOptionsHook {
  buildSharedRunOptions: (session: OttoMastraSession) => OttoRunOptions;
}

const decodeControllerRunOptionsHook = Schema.decodeUnknownSync(
  Schema.declare<ControllerRunOptionsHook>(
    (value): value is ControllerRunOptionsHook =>
      Predicate.isObject(value) && Predicate.isFunction(value.buildSharedRunOptions),
  ),
);

/**
 * Builds the Mastra harness inside the caller's scope. Closing the scope destroys the Mastra
 * controller and then closes the message store.
 */
export const makeOttoMastraHarness = Effect.fnUntraced(function* (
  options: OttoMastraHarnessOptions,
) {
  const context = yield* Effect.context<never>();

  const history = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        createOttoMastraMemory(options, (message, annotations) => {
          Effect.runForkWith(context)(Effect.logWarning(message, annotations));
        }),
      catch: (cause) => new OttoMastraHarnessError({ operation: "memory.open", cause }),
    }),
    (memory) => Effect.promise(() => memory.close()).pipe(Effect.ignoreCause({ log: true })),
  );

  const resolveModel = (requestContext: RequestContext) =>
    resolveOttoMastraModel(
      controllerModelId(requestContext),
      options.authStorage,
      options.getKimiAccess,
      options.getOpenCodeGoApiKey,
      controllerModelOptions(requestContext),
      options.getSubscriptionApiKey,
      controllerModelConnection(requestContext, options.getModelConnection),
      options.getSubscriptionOAuth,
      options.getSubscriptionAccessToken,
      controllerResourceId(requestContext),
    );

  const chatContexts = storedChatContexts(history.memory);

  // Otto: the model lays out the whole prompt, because only it sees the final tool list.
  const agent = new Agent({
    id: "otto-agent",
    name: "Otto",
    instructions: "",
    model: ({ requestContext }) =>
      withLastRequest(
        withOttoPrompt(resolveModel(requestContext), requestContext, chatContexts),
        controllerResourceId(requestContext),
        history.compaction.requests,
      ),
    tools: ({ requestContext }) => resolveOttoTools(requestContext, options, resolveModel),
    memory: history.memory,
    // The history loads first, so the task state is compared with what the model already has.
    inputProcessors: [history.processor, new OttoTaskStateProcessor()],
    outputProcessors: [history.processor],
    errorProcessors: [...ottoErrorProcessors(options.onStreamRetry)],
  });

  const controller = new MastraAgentController<OttoMastraState>({
    id: "otto-codex",
    agent,
    storage: history.storage,
    memory: history.memory,
    modes: [
      { id: "build", name: "Build", defaultModelId: DEFAULT_MODEL_ID },
      // Keep legacy controller requests valid until their mode is normalized to build.
      {
        id: "plan",
        name: "Plan",
        defaultModelId: DEFAULT_MODEL_ID,
        instructions: "Inspect and explain. Do not change files or run mutating commands.",
      },
    ],
    defaultModeId: "build",
    disableBuiltinTools: [
      "submit_plan",
      "task_write",
      "task_update",
      "task_complete",
      "task_check",
      "subagent",
    ],
    toolCategoryResolver: ottoToolCategory,
    intervalHandlers: [],
  });

  const controllerWithRunOptions = decodeControllerRunOptionsHook(controller);

  const buildSharedRunOptions = controllerWithRunOptions.buildSharedRunOptions.bind(controller);
  controllerWithRunOptions.buildSharedRunOptions = (session) => {
    const runOptions = buildSharedRunOptions(session);

    const approvalOptions =
      runOptions.requireToolApproval === true
        ? {
            ...runOptions,
            requireToolApproval: ({ toolName }: { readonly toolName: string }) =>
              routineToolNeedsGlobalApproval(toolName),
          }
        : runOptions;

    return withOttoModelRunOptions(approvalOptions, session.state.get());
  };

  // Registered after the store, so the controller stops before the store closes.
  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(() => controller.destroy()).pipe(Effect.ignoreCause({ log: true })),
  );

  const harness: OttoMastraHarness = {
    controller,
    rebuildConversation: async (threadId, messages) => {
      const originalThread = await history.memory.getThreadById({
        threadId,
        resourceId: threadId,
      });

      const originals = originalThread
        ? (await history.memory.recall({ threadId, perPage: false })).messages
        : [];

      const replace = async (transcript: ReadonlyArray<MastraDBMessage>) => {
        history.compaction.forget(threadId);
        await history.memory.deleteThread(threadId);
        await history.memory.createThread({
          threadId,
          resourceId: threadId,
          ...(originalThread?.title ? { title: originalThread.title } : {}),
          ...(originalThread?.metadata ? { metadata: originalThread.metadata } : {}),
        });

        if (transcript.length > 0) await history.memory.persistMessages([...transcript]);
      };

      try {
        await replace(messages);
      } catch (cause) {
        await replace(originals);
        throw cause;
      }

      return () => replace(originals);
    },
    persistExternalTurn: createPersistExternalTurn(history.memory),
  };

  return harness;
});

export {
  type OttoMastraState,
  type OttoMastraSession,
  type OttoMastraHarnessOptions,
  type OttoMastraHarness,
} from "./mastra/otto-harness-types.ts";

export {
  withOttoModelRunOptions,
  mastraModelId,
  openCodeGoInlineConnection,
  resolveOttoMastraModel,
} from "./mastra/otto-models.ts";

export { withOttoPrompt } from "./mastra/otto-instructions.ts";

export {
  OTTO_DELETE_ROUTINES_TOOL_NAME,
  OTTO_UPDATE_ROUTINE_TOOL_NAME,
  routineToolInputSchema,
  type OttoRoutineListResult,
  type OttoRoutineDeleteResult,
  resolveOttoTools,
} from "./mastra/otto-tools.ts";

export {
  type OttoToolCategory,
  type OttoCriticalAction,
  criticalOttoAction,
  ottoActionNeedsApproval,
  ottoToolCategory,
  routineToolNeedsGlobalApproval,
} from "./mastra/otto-actions.ts";

export { OttoHistoryProcessor, createOttoMastraMemory } from "./mastra/otto-memory.ts";

export { OttoMastraHarnessError } from "./mastra/otto-harness-errors.ts";
