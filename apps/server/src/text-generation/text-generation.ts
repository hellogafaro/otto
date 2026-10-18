import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@otto/contracts";
import { TextGenerationError } from "@otto/contracts";

import * as ProviderInstanceRegistry from "../provider/services/provider-instance-registry.ts";
import type { ProviderInstance } from "../provider/provider-driver.ts";

export type TextGenerationProvider = "codex" | "claudeAgent" | "grok" | "opencode";

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
}

/** One change to a chat's memory, as the review returns it; unused fields are null. */
export interface MemoryReviewChange {
  readonly action: "add" | "update" | "confirm" | "delete";
  readonly id: string | null;
  readonly text: string | null;
  readonly projectOnly: boolean | null;
}

export interface MemoryReviewInput {
  /** Where a CLI provider runs; the review reads no files. */
  cwd: string;
  /** The memory as the bot sees it, one line per entry with its id. */
  memory: string;
  /** The messages since the last review, oldest first, each as "Name: text". */
  transcript: string;
  /** YYYY-MM-DD in the server's timezone. */
  today: string;
  /** Whose memory this chat adds to: the whole team's, or one person's own. */
  learner: "team" | "person";
  /** The project the chat is in, or null when it is in none. */
  project: string | null;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface MemoryReviewResult {
  changes: ReadonlyArray<MemoryReviewChange>;
}

export type TextGenerationOperation =
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateMemoryReview";

export interface TextGenerationService {
  generateBranchName(input: BranchNameGenerationInput): Promise<BranchNameGenerationResult>;
  generateThreadTitle(input: ThreadTitleGenerationInput): Promise<ThreadTitleGenerationResult>;
  generateMemoryReview(input: MemoryReviewInput): Promise<MemoryReviewResult>;
}

/**
 * TextGeneration - Service tag for branch names, thread titles and memory reviews.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

    /** Review a chat's new messages and return the changes to its memory. */
    readonly generateMemoryReview: (
      input: MemoryReviewInput,
    ) => Effect.Effect<MemoryReviewResult, TextGenerationError>;
  }
>()("@otto/server/text-generation/text-generation/TextGeneration") {}

/** @deprecated Use `TextGeneration["Service"]`. */
export type TextGenerationShape = TextGeneration["Service"];

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOperation,
  instanceId: ProviderInstanceId,
): Effect.Effect<NonNullable<ProviderInstance["textGeneration"]>, TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance?.textGeneration
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `Provider instance '${instanceId}' does not support text generation.`,
            }),
          ),
    ),
  );

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
): TextGeneration["Service"] =>
  TextGeneration.of({
    generateBranchName: (input) =>
      resolveInstance(registry, "generateBranchName", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
      ),
    generateThreadTitle: (input) =>
      resolveInstance(registry, "generateThreadTitle", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
      ),
    generateMemoryReview: (input) =>
      resolveInstance(registry, "generateMemoryReview", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateMemoryReview(input)),
      ),
  });

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  return makeTextGenerationFromRegistry(registry);
});

export const layer = Layer.effect(TextGeneration, make);
