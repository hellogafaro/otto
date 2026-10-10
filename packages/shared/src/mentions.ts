export type MentionType = "user" | "agent" | "task" | "project" | "file";

export function serializeMention(item: {
  type: MentionType;
  id: string;
  label: string;
}) {
  const label = item.label
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  const id = encodeURIComponent(item.id).replace(/\)/g, "%29");
  return `@[${label}](${item.type}:${id})`;
}

/** Stored labels can contain brackets and backslashes; all consumers use the same grammar. */
export function parseMentions(text: string) {
  return Array.from(
    text.matchAll(
      /@\[((?:\\.|[^\]\\])*)\]\((user|agent|task|project|file):([^)]+)\)/g,
    ),
    (match) => {
      let id = match[3] ?? "";
      try {
        id = decodeURIComponent(id);
      } catch {
        /* Preserve legacy identifiers with literal percent signs. */
      }
      return {
        index: match.index,
        length: match[0].length,
        type: match[2] as MentionType,
        id,
        label: (match[1] ?? "").replace(/\\([\\[\]nr])/g, (_, value: string) =>
          value === "n" ? "\n" : value === "r" ? "\r" : value,
        ),
      };
    },
  );
}

export function mentionUserIds(text: string) {
  return [
    ...new Set(
      parseMentions(text)
        .filter((item) => item.type === "user")
        .map((item) => item.id),
    ),
  ];
}
