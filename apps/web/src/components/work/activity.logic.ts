/** Someone or something a comment can mention. */
export interface MentionTarget {
  readonly type: "person" | "bot";
  readonly id: string;
  readonly label: string;
}

/** `start` is the segment's offset in the stored content, a stable key for rendering. */
export type ActivityContentSegment =
  | { readonly type: "text"; readonly start: number; readonly text: string }
  | {
      readonly type: "mention";
      readonly start: number;
      readonly mentionType: string;
      readonly id: string;
      readonly label: string;
    };

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

const unescapeText = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One stored mention: a person, a bot, or the comment a reply answers. */
export const mentionTag = (target: {
  readonly type: MentionTarget["type"] | "comment";
  readonly id: string;
  readonly label: string;
}) =>
  `<mention type="${target.type}" id="${escapeAttribute(target.id)}">${escapeText(target.label)}</mention>`;

/**
 * Turns what the composer holds into stored comment content: `@Name` and `@bot:<id>` for
 * known people and bots become mention tags, and every other `<`, `>` and `&` is escaped.
 */
export function toActivityContent(draft: string, targets: ReadonlyArray<MentionTarget>): string {
  const byBotId = new Map(
    targets.flatMap((target) => (target.type === "bot" ? [[target.id, target] as const] : [])),
  );

  const byLabel = new Map(targets.map((target) => [target.label.toLowerCase(), target]));

  const labels = [...byLabel.keys()].toSorted((left, right) => right.length - left.length);

  const pattern = new RegExp(
    [
      "@bot:([A-Za-z0-9_-]+)",
      ...(labels.length > 0 ? [`@(${labels.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`] : []),
    ].join("|"),
    "giu",
  );

  let content = "";
  let last = 0;

  for (const match of draft.matchAll(pattern)) {
    const start = match.index;
    const before = start === 0 ? "" : draft[start - 1];

    if (before !== "" && before !== undefined && !/\s|\(/.test(before)) continue;

    const target =
      match[1] === undefined ? byLabel.get(match[2]!.toLowerCase()) : byBotId.get(match[1]);

    if (target === undefined) continue;

    content += escapeText(draft.slice(last, start)) + mentionTag(target);
    last = start + match[0].length;
  }

  return (content + escapeText(draft.slice(last))).trim();
}

const MENTION_TAG = /<mention type="([^"]*)" id="([^"]*)">([^<]*)<\/mention>/g;

/** Splits stored comment content into text and mentions, unescaping both. */
export function parseActivityContent(content: string): ReadonlyArray<ActivityContentSegment> {
  const segments: ActivityContentSegment[] = [];
  let last = 0;

  for (const match of content.matchAll(MENTION_TAG)) {
    if (match.index > last) {
      segments.push({
        type: "text",
        start: last,
        text: unescapeText(content.slice(last, match.index)),
      });
    }

    segments.push({
      type: "mention",
      start: match.index,
      mentionType: match[1]!,
      id: unescapeText(match[2]!),
      label: unescapeText(match[3]!),
    });
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    segments.push({ type: "text", start: last, text: unescapeText(content.slice(last)) });
  }

  return segments;
}

/** A comment's text with mentions as `@Name`, for a one-line preview. */
export function activityPlainText(content: string): string {
  return parseActivityContent(content)
    .map((segment) => (segment.type === "text" ? segment.text : `@${segment.label}`))
    .join("");
}
