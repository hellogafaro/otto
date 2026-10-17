import { OttoModelOptions } from "../reasoning-options.ts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as NodeURL from "node:url";
import { RequestContext } from "@mastra/core/request-context";
import {
  type Processor,
  type ProcessAPIErrorArgs,
  type ProcessInputStepArgs,
  type ProcessOutputResultArgs,
  type ProcessOutputStepArgs,
} from "@mastra/core/processors";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import {
  attributeGroupReplies,
  isGroupTurnNoteMessage,
  OTTO_REPLY_BOT_NAME,
  projectHistory,
} from "../chat-history.ts";
import {
  createOttoCompaction,
  isContextOverflow,
  type OttoCompactionWarning,
} from "./otto-compaction.ts";
import { type OttoMastraHarnessOptions, type OttoMastraState } from "./otto-harness-types.ts";
import { DEFAULT_MODEL_ID } from "./otto-models.ts";

const decodeControllerContext = Schema.decodeUnknownOption(
  Schema.Struct({
    session: Schema.optionalKey(Schema.Unknown),
    state: Schema.optionalKey(Schema.Unknown),
    resourceId: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeModelOptions = Schema.decodeUnknownOption(OttoModelOptions);

export function controllerContext(requestContext: RequestContext) {
  return Option.getOrUndefined(decodeControllerContext(requestContext.getRaw("controller")));
}

export function controllerModelId(requestContext: RequestContext): string {
  const value = controllerContext(requestContext);

  if (!value || !("session" in value)) return DEFAULT_MODEL_ID;
  const session = value.session;

  if (!Predicate.isObjectOrArray(session) || session === null || !("modelId" in session)) {
    return DEFAULT_MODEL_ID;
  }

  return Predicate.isString(session.modelId) ? session.modelId : DEFAULT_MODEL_ID;
}

export function controllerModelOptions(
  requestContext: RequestContext,
): OttoMastraState["modelOptions"] {
  const state = controllerContext(requestContext)?.state;

  if (!Predicate.isObjectOrArray(state) || state === null || !("modelOptions" in state)) {
    return undefined;
  }

  const modelOptions = state.modelOptions;

  return Option.getOrUndefined(decodeModelOptions(modelOptions));
}

export function controllerModelConnection(
  requestContext: RequestContext,
  getModelConnection: OttoMastraHarnessOptions["getModelConnection"],
) {
  const state = controllerContext(requestContext)?.state;

  if (!Predicate.isObjectOrArray(state) || state === null || !("providerInstanceId" in state)) {
    return undefined;
  }

  return Predicate.isString(state.providerInstanceId)
    ? getModelConnection?.(state.providerInstanceId)
    : undefined;
}

export function controllerResourceId(requestContext: RequestContext): string | undefined {
  const value = controllerContext(requestContext)?.resourceId;

  return Predicate.isString(value) ? value : undefined;
}

function controllerBot(requestContext: RequestContext | undefined) {
  const state = requestContext ? controllerContext(requestContext)?.state : undefined;

  if (!Predicate.isObject(state) || !("botName" in state) || !Predicate.isString(state.botName)) {
    return undefined;
  }

  return {
    name: state.botName,
    inGroup: "groupContext" in state && Predicate.isString(state.groupContext),
  };
}

const decodeMemoryThread = Schema.decodeUnknownOption(
  Schema.Struct({
    thread: Schema.Struct({ id: Schema.String }),
    resourceId: Schema.optionalKey(Schema.String),
  }),
);

function memoryThread(requestContext: RequestContext | undefined) {
  const value = Option.getOrUndefined(decodeMemoryThread(requestContext?.get("MastraMemory")));

  return value && { threadId: value.thread.id, resourceId: value.resourceId ?? value.thread.id };
}

/**
 * Sends a chat's whole stored history, compacts it once near the model's window, and stores
 * each run's new messages.
 */
export class OttoHistoryProcessor implements Processor<"otto-history"> {
  readonly id = "otto-history" as const;
  readonly name = "Otto History";
  private readonly memory: Memory;
  private readonly compaction: ReturnType<typeof createOttoCompaction>;

  constructor(memory: Memory, compaction: ReturnType<typeof createOttoCompaction>) {
    this.memory = memory;
    this.compaction = compaction;
  }

  async processInputStep(args: ProcessInputStepArgs) {
    const thread = memoryThread(args.requestContext);

    if (!thread || !args.requestContext) return args.messageList;

    if (args.stepNumber === 0) {
      const stored = await this.memory.recall({ threadId: thread.threadId, perPage: false });
      const history = projectHistory(stored.messages);
      const bot = controllerBot(args.requestContext);

      for (const message of bot?.inGroup ? attributeGroupReplies(history, bot.name) : history) {
        args.messageList.add(message, "memory");
      }
    }

    await this.compaction.compactIfNeeded(args, thread, controllerModelId(args.requestContext));

    return args.messageList;
  }

  /** A request the provider rejected as too long compacts at once and is sent again, once. */
  async processAPIError(args: ProcessAPIErrorArgs) {
    const thread = memoryThread(args.requestContext);

    if (
      !thread ||
      !args.requestContext ||
      args.state["overflowed"] ||
      !(args.error instanceof Error && isContextOverflow(args.error))
    ) {
      return { retry: false };
    }

    args.state["overflowed"] = true;

    return {
      retry: await this.compaction.compactIfNeeded(
        args,
        thread,
        controllerModelId(args.requestContext),
        true,
      ),
    };
  }

  processOutputStep(args: ProcessOutputStepArgs) {
    const thread = memoryThread(args.requestContext);

    if (thread && args.requestContext) {
      this.compaction.recordUsage(args, thread.threadId, controllerModelId(args.requestContext));
    }

    return args.messageList;
  }

  async processOutputResult(args: ProcessOutputResultArgs) {
    const messages = [
      ...args.messageList.get.input.db(),
      ...args.messageList.get.response.db(),
    ].filter(
      (message) => args.messageList.isNewMessage(message) && !isGroupTurnNoteMessage(message),
    );

    const botName = controllerBot(args.requestContext)?.name;

    for (const message of messages) {
      if (message.role !== "assistant" || !botName) continue;
      message.content.metadata = { ...message.content.metadata, [OTTO_REPLY_BOT_NAME]: botName };
    }

    if (messages.length > 0) await this.memory.persistMessages(messages);

    return args.messageList;
  }
}

export async function createOttoMastraMemory(
  options: Pick<OttoMastraHarnessOptions, "memoryDbPath" | "startCompaction" | "finishCompaction">,
  warn: (message: string, warning: OttoCompactionWarning) => void = () => undefined,
) {
  // The file name predates compaction; it holds every chat's stored messages.
  const storage = new LibSQLStore({
    id: "otto-observational-memory",
    url: NodeURL.pathToFileURL(options.memoryDbPath).toString(),
    connectionTimeoutMs: 5_000,
  });

  await storage.init();

  const memory = new Memory({
    storage,
    options: {
      lastMessages: false,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: false,
    },
  });

  const compaction = createOttoCompaction({ ...options, memory, warn });

  return {
    memory,
    storage,
    compaction,
    processor: new OttoHistoryProcessor(memory, compaction),
    close: () => storage.close(),
  };
}
