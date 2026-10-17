import * as Predicate from "effect/Predicate";

import type { OttoToolResult } from "./tools/otto-tool-types.ts";

export const OTTO_TOOL_OUTPUT_MAX_BYTES = 50 * 1024;

export const OTTO_TOOL_OUTPUT_MAX_LINES = 2_000;

const NOTICE_BYTES = 256;

const NOTICE_LINES = 2;

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * The start of a tool's text output that fits 50 KB and 2,000 lines, cut after the last whole
 * line that fits, or inside the first line when it alone is too long, followed by a notice with
 * the full size and how to see the rest. `rest` gets the number of characters shown. The result
 * itself fits the cap, so capping it again changes nothing.
 */
export function capToolText(
  text: string,
  rest: (shown: number) => string = () => "Narrow the request to see the rest.",
): string {
  const totalBytes = Buffer.byteLength(text);
  const totalLines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

  if (totalBytes <= OTTO_TOOL_OUTPUT_MAX_BYTES && totalLines <= OTTO_TOOL_OUTPUT_MAX_LINES) {
    return text;
  }

  const budget = OTTO_TOOL_OUTPUT_MAX_BYTES - NOTICE_BYTES;
  let shown = 0;
  let bytes = 0;
  let lines = 0;

  while (lines < OTTO_TOOL_OUTPUT_MAX_LINES - NOTICE_LINES) {
    const newline = text.indexOf("\n", shown);
    const end = newline === -1 ? text.length : newline + 1;
    const lineBytes = Buffer.byteLength(text.slice(shown, end));

    if (bytes + lineBytes > budget) break;
    bytes += lineBytes;
    shown = end;
    lines += 1;

    if (newline === -1) break;
  }

  if (shown === 0) {
    for (const character of text) {
      const characterBytes = Buffer.byteLength(character);

      if (bytes + characterBytes > budget) break;
      bytes += characterBytes;
      shown += character.length;
    }

    lines = 1;
  }

  return `${text.slice(0, shown).replace(/\n$/, "")}\n\n[Showing ${kilobytes(bytes)} of ${kilobytes(totalBytes)}, ${lines} of ${totalLines} lines. ${rest(shown)}]`;
}

/**
 * A tool result as it is stored and shown to the model: text capped by `capToolText`, and any
 * other result over 50 KB as its capped JSON. Files read from the computer stay whole.
 */
export function capToolOutput(output: OttoToolResult): OttoToolResult {
  if (Predicate.isString(output)) return capToolText(output);

  if (Predicate.hasProperty(output, "__workspaceMedia")) return output;

  const json = JSON.stringify(output);

  if (json === undefined || Buffer.byteLength(json) <= OTTO_TOOL_OUTPUT_MAX_BYTES) return output;

  return capToolText(JSON.stringify(output, null, 2));
}
