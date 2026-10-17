import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import type { OttoToolInputSchemas } from "@otto/contracts";

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Pi-style exact replacement. Every oldText must match the file as it was read exactly once,
 * and no two may overlap, so the edits apply together or not at all.
 */
export async function editWorkspaceFile(
  filesystem: WorkspaceFilesystem,
  input: (typeof OttoToolInputSchemas.edit)["Type"],
) {
  const original = String(await filesystem.readFile(input.path, { encoding: "utf8" }));

  const misses = input.edits.flatMap((edit, index) => {
    const matches = original.split(edit.oldText).length - 1;

    return matches === 1 ? [] : [{ edit: index, matches }];
  });

  if (misses.length > 0) {
    return {
      error: {
        code: "no_unique_match",
        message:
          "Each oldText must match the file exactly once. Read the file again and copy the text, with more context when it repeats.",
        misses,
      },
    };
  }

  const spans = input.edits
    .map((edit) => {
      const start = original.indexOf(edit.oldText);

      return { start, end: start + edit.oldText.length, newText: edit.newText };
    })
    .toSorted((left, right) => left.start - right.start);

  if (spans.some((span, index) => index > 0 && span.start < spans[index - 1]!.end)) {
    return {
      error: { code: "overlap", message: "Two oldText blocks overlap. Merge them into one edit." },
    };
  }

  let content = "";
  let from = 0;
  const changed: Array<{ readonly from: number; readonly to: number }> = [];

  for (const span of spans) {
    content += original.slice(from, span.start);
    const first = lineOf(content, content.length);
    content += span.newText;
    changed.push({ from: first, to: first + span.newText.split("\n").length - 1 });
    from = span.end;
  }

  content += original.slice(from);
  await filesystem.writeFile(input.path, content);

  return { path: input.path, edits: spans.length, changedLines: changed };
}
