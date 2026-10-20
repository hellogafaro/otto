import { mentionMarkdown, mentionPlainText, mentionTag, parseMentions } from "@otto/shared/mention";

export { mentionTag, parseMentionHref } from "@otto/shared/mention";

export const activityMarkdown = mentionMarkdown;

export const activityPlainText = mentionPlainText;

/** Someone or something a comment can mention. */
export interface MentionTarget {
  readonly type: "person" | "bot" | "task" | "project";
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

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns what the composer holds into stored comment content: `@Name` and `@bot:<id>` for
 * known people and bots, and `@task:<id>` and `@project:<id>` for known work, become mention
 * tags, and every other `<`, `>` and `&` is escaped.
 */
export function toActivityContent(draft: string, targets: ReadonlyArray<MentionTarget>): string {
  const byBotId = new Map(
    targets.flatMap((target) => (target.type === "bot" ? [[target.id, target] as const] : [])),
  );

  const byWorkId = new Map<string, MentionTarget>(
    targets.flatMap((target) =>
      target.type === "task" || target.type === "project"
        ? [[`${target.type}:${target.id}`, target] as const]
        : [],
    ),
  );

  const byLabel = new Map(
    targets.flatMap((target) =>
      target.type === "person" || target.type === "bot"
        ? [[target.label.toLowerCase(), target] as const]
        : [],
    ),
  );

  const labels = [...byLabel.keys()].toSorted((left, right) => right.length - left.length);

  const pattern = new RegExp(
    [
      "@bot:([A-Za-z0-9_-]+)",
      "@((?:task|project):[A-Za-z0-9][A-Za-z0-9._:-]*)",
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
      match[1] !== undefined
        ? byBotId.get(match[1])
        : match[2] !== undefined
          ? byWorkId.get(match[2])
          : byLabel.get(match[3]!.toLowerCase());

    if (target === undefined) continue;

    content += escapeText(draft.slice(last, start)) + mentionTag(target);
    last = start + match[0].length;
  }

  return (content + escapeText(draft.slice(last))).trim();
}

/** Splits stored comment content into text and mentions, unescaping both. */
export const parseActivityContent = parseMentions;

/**
 * A stored comment as its author edits it: mentions of people and bots as `@Name`, of work as
 * `@task:<id>` or `@project:<id>`, so saving through `toActivityContent` keeps them, and the
 * reply it answers kept aside as `prefix`, unchanged by the edit.
 */
export function activityEditDraft(content: string) {
  const segments = parseActivityContent(content);
  const [first] = segments;
  const reply = first?.type === "mention" && first.mentionType === "comment" ? first : null;

  const prefix =
    reply === null ? "" : `${mentionTag({ type: "comment", id: reply.id, label: reply.label })} `;

  const draft = segments
    .filter((segment) => segment !== reply)
    .map((segment) => {
      if (segment.type === "text") return segment.text;

      return segment.mentionType === "task" || segment.mentionType === "project"
        ? `@${segment.mentionType}:${segment.id}`
        : `@${segment.label}`;
    })
    .join("")
    .trim();

  return { prefix, draft };
}
