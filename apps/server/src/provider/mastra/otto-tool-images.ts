import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { OttoCallOptions } from "./otto-instructions.ts";

type OttoPromptMessage = OttoCallOptions["prompt"][number];

type OttoToolContentItem = Extract<
  Extract<
    Extract<OttoPromptMessage, { readonly role: "tool" }>["content"][number],
    { readonly type: "tool-result" }
  >["output"],
  { readonly type: "content" }
>["value"][number];

/** The newest tool images a chat-completions model still sees; older ones become a note. */
export const OTTO_CHAT_TOOL_IMAGES = 4;

// `media` is how Mastra stores a tool's image output; `image-data` and `file-data` how a
// provider receives it.
const decodeToolImage = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literals(["media", "image-data", "file-data"]),
    data: Schema.String,
    mediaType: Schema.String,
  }),
);

type ToolImage = { readonly data: string; readonly mediaType: string };

function toolImage(item: OttoToolContentItem): ToolImage | undefined {
  const image = Option.getOrUndefined(decodeToolImage(item));

  return image?.mediaType.startsWith("image/") ? image : undefined;
}

/**
 * Otto: Chat-completions APIs (Grok and other OpenAI-compatible endpoints) take tool results as
 * text only, and the AI SDK writes any other result as JSON, so every screenshot a chat read
 * would be sent as megabytes of base64 text and the provider refuses the request. Each tool
 * result keeps its text; with `seesImages`, the newest images follow their tool results in a
 * user message, and every other image becomes a note.
 */
export function toolImagesForChatApi(
  conversation: ReadonlyArray<OttoPromptMessage>,
  seesImages: boolean,
): ReadonlyArray<OttoPromptMessage> {
  const total = conversation.reduce(
    (count, message) =>
      message.role !== "tool"
        ? count
        : message.content.reduce(
            (inner, part) =>
              part.type === "tool-result" && part.output.type === "content"
                ? inner + part.output.value.filter((item) => toolImage(item)).length
                : inner,
            count,
          ),
    0,
  );

  if (total === 0) return conversation;

  // Images before this ordinal become notes; the newest ones are sent.
  const firstShown = seesImages ? Math.max(0, total - OTTO_CHAT_TOOL_IMAGES) : total;
  let ordinal = 0;

  return conversation.flatMap((message): OttoPromptMessage[] => {
    if (message.role !== "tool") return [message];

    const shown: ToolImage[] = [];

    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") return part;

      const lines = part.output.value.map((item) => {
        const image = toolImage(item);

        if (!image) return item.type === "text" ? item.text : JSON.stringify(item);

        ordinal += 1;

        if (ordinal > firstShown) {
          shown.push(image);

          return "[The image this tool returned follows in the next message.]";
        }

        return seesImages
          ? "[An image this tool returned earlier was left out to keep the request small.]"
          : "[This tool returned an image, which this model can't receive.]";
      });

      return { ...part, output: { type: "text" as const, value: lines.join("\n\n") } };
    });

    if (shown.length === 0) return [{ ...message, content }];

    return [
      { ...message, content },
      {
        role: "user",
        content: [
          { type: "text", text: "The images the tool calls above returned:" },
          ...shown.map((image) => ({
            type: "file" as const,
            data: image.data,
            mediaType: image.mediaType,
          })),
        ],
      },
    ];
  });
}
