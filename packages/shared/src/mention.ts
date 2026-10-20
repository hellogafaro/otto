/**
 * One mention, everywhere a person, bot, task, project, Library file or comment is named:
 * `<mention type="task" id="…">Title</mention>`. The label is display text. The id is what
 * resolves. Other `<`, `>` and `&` in stored text are escaped, so a tag cannot be forged
 * by writing them.
 */

export const MENTION_HREF_PREFIX = "#mention/";

/** The in-app address of a mention that has a page. Not a URL: it has no host. */
export function mentionPath(type: "task" | "project" | "library", id: string): string;
export function mentionPath(type: string, id: string): string | undefined;
export function mentionPath(type: string, id: string): string | undefined {
  if (type === "task") return `/tasks/${id}`;

  if (type === "project") return `/projects/${id}`;

  if (type === "library") return `/library/${id}`;

  return undefined;
}

export interface MentionTag {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly id: string;
  readonly label: string;
}

export type MentionSegment =
  | { readonly type: "text"; readonly start: number; readonly text: string }
  | {
      readonly type: "mention";
      readonly start: number;
      readonly mentionType: string;
      readonly id: string;
      readonly label: string;
    };

const MENTION_TAG = /<mention type="([^"]*)" id="([^"]*)">([^<]*)<\/mention>/g;

const FENCED_CODE = /(```[\s\S]*?(?:```|$))/;

const INLINE_CODE = /(`[^`\n]*`)/;

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

const unescapeText = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** The stored tag. The label and id are escaped, so a name cannot close the tag. */
export const mentionTag = (mention: {
  readonly type: string;
  readonly id: string;
  readonly label: string;
}) =>
  `<mention type="${escapeAttribute(mention.type)}" id="${escapeAttribute(mention.id)}">${escapeText(mention.label)}</mention>`;

/** The tags in `text`, in order, as written. Labels are not unescaped. */
export function findMentionTags(text: string): MentionTag[] {
  return [...text.matchAll(MENTION_TAG)].flatMap((match) => {
    const type = match[1];
    const id = match[2];

    if (match.index === undefined || !type || !id) return [];

    return [
      {
        start: match.index,
        end: match.index + match[0].length,
        type,
        id: unescapeText(id),
        label: unescapeText(match[3] ?? ""),
      },
    ];
  });
}

/** Splits stored content into text and mentions, unescaping both. */
export function parseMentions(content: string): ReadonlyArray<MentionSegment> {
  const segments: MentionSegment[] = [];
  let last = 0;

  for (const tag of findMentionTags(content)) {
    if (tag.start > last) {
      segments.push({
        type: "text",
        start: last,
        text: unescapeText(content.slice(last, tag.start)),
      });
    }

    segments.push({
      type: "mention",
      start: tag.start,
      mentionType: tag.type,
      id: tag.id,
      label: tag.label,
    });
    last = tag.end;
  }

  if (last < content.length) {
    segments.push({ type: "text", start: last, text: unescapeText(content.slice(last)) });
  }

  return segments;
}

/** A comment as a person reads it: mentions as `@Name`, markup unescaped. */
export function mentionPlainText(content: string): string {
  return parseMentions(content)
    .map((segment) => (segment.type === "text" ? segment.text : `@${segment.label}`))
    .join("");
}

/**
 * A comment as a bot reads it: the same tag it should write back, and the rest unescaped.
 * A bot that sees `@Name` here learns the wrong pattern.
 */
export function mentionText(content: string): string {
  return parseMentions(content)
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : mentionTag({ type: segment.mentionType, id: segment.id, label: segment.label }),
    )
    .join("");
}

const mentionLink = (tag: Pick<MentionTag, "type" | "id" | "label">) =>
  `[${tag.label.replaceAll(/[[\]\\]/g, "\\$&")}](${MENTION_HREF_PREFIX}${tag.type}/${encodeURIComponent(tag.id)})`;

/** Stored comment content as Markdown. Each mention is a `#mention/<type>/<id>` link. */
export function mentionMarkdown(content: string): string {
  return parseMentions(content)
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : mentionLink({ type: segment.mentionType, id: segment.id, label: segment.label }),
    )
    .join("");
}

/**
 * Replaces mention tags in text a bot wrote, outside code, with the same links. Surrounding
 * text is left as written, so a chat message is not unescaped.
 */
export function linkMentionTags(text: string): string {
  return text
    .split(FENCED_CODE)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        .split(INLINE_CODE)
        .map((part, partIndex) => {
          if (partIndex % 2 === 1) return part;

          let out = "";
          let last = 0;

          for (const tag of findMentionTags(part)) {
            out += part.slice(last, tag.start) + mentionLink(tag);
            last = tag.end;
          }

          return out + part.slice(last);
        })
        .join("");
    })
    .join("");
}

/**
 * A chat reply as it leaves Otto on a channel. A task, project or Library mention becomes a
 * link only when the server has a public origin; otherwise, and for a person or bot, it is
 * `@Name`. Tags inside code stay as written. Never invents a host.
 */
export function mentionChannelText(
  text: string,
  publicOrigin: string | undefined,
  markdown: boolean,
): string {
  const origin = publicOrigin?.replace(/\/$/, "");

  const replace = (part: string) => {
    let out = "";
    let last = 0;

    for (const tag of findMentionTags(part)) {
      const path = origin === undefined ? undefined : mentionPath(tag.type, tag.id);
      const label = tag.label.replaceAll(/[[\]\\]/g, "\\$&");

      out += part.slice(last, tag.start);
      out +=
        path === undefined
          ? `@${tag.label}`
          : markdown
            ? `[${label}](${origin}${path})`
            : `${tag.label} ${origin}${path}`;
      last = tag.end;
    }

    return out + part.slice(last);
  };

  return text
    .split(FENCED_CODE)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment
            .split(INLINE_CODE)
            .map((part, partIndex) => (partIndex % 2 === 1 ? part : replace(part)))
            .join(""),
    )
    .join("");
}

/** The mention a `#mention/<type>/<id>` link names. */
export function parseMentionHref(href: string) {
  if (!href.startsWith(MENTION_HREF_PREFIX)) return null;

  const [type, id] = href.slice(MENTION_HREF_PREFIX.length).split("/");

  return type && id ? { type, id: decodeURIComponent(id) } : null;
}

/**
 * A bot's prose as stored comment content. `labelOf` returns the current name of something
 * that exists and the bot may mention. Anything else, including a tag for a bot or for
 * something that is not there, is escaped, so it cannot become a pill.
 */
export function resolveBotMentions(
  text: string,
  labelOf: (mention: { readonly type: string; readonly id: string }) => string | undefined,
): string {
  let out = "";
  let last = 0;

  for (const tag of findMentionTags(text)) {
    const label = labelOf(tag);

    out += escapeText(text.slice(last, tag.start));
    out +=
      label === undefined
        ? escapeText(text.slice(tag.start, tag.end))
        : mentionTag({ type: tag.type, id: tag.id, label });
    last = tag.end;
  }

  return (out + escapeText(text.slice(last))).trim();
}
