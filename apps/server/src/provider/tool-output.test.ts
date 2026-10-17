import { describe, expect, it } from "vite-plus/test";

import {
  capToolOutput,
  capToolText,
  OTTO_TOOL_OUTPUT_MAX_BYTES,
  OTTO_TOOL_OUTPUT_MAX_LINES,
} from "./tool-output.ts";

const fitsCap = (text: string) =>
  Buffer.byteLength(text) <= OTTO_TOOL_OUTPUT_MAX_BYTES &&
  text.split("\n").length <= OTTO_TOOL_OUTPUT_MAX_LINES;

describe("capToolText", () => {
  it("keeps output within the cap unchanged", () => {
    const text = "line\n".repeat(1_999);

    expect(capToolText(text)).toBe(text);
  });

  it("keeps whole lines from the start and says how much was left out", () => {
    const text = Array.from({ length: 3_000 }, (_, index) => `line ${index + 1}`).join("\n");
    const capped = capToolText(text);

    expect(capped.startsWith("line 1\nline 2\n")).toBe(true);
    expect(capped).toContain("line 1998\n\n[Showing ");
    expect(capped).not.toContain("line 1999");
    expect(capped).toContain("1998 of 3000 lines. Narrow the request to see the rest.]");
    expect(fitsCap(capped)).toBe(true);
    expect(capToolText(capped)).toBe(capped);
  });

  it("cuts by size before the line limit, after the last whole line that fits", () => {
    const line = `${"x".repeat(999)}\n`;
    const capped = capToolText(line.repeat(200));

    expect(capped).toMatch(
      /^(x{999}\n){49}x{999}\n\n\[Showing 48\.8 KB of 195\.3 KB, 50 of 200 lines\./,
    );
    expect(fitsCap(capped)).toBe(true);
  });

  it("cuts one over-long line between characters, never inside one", () => {
    const capped = capToolText("é".repeat(100_000));
    const [shown] = capped.split("\n\n[Showing");

    expect(shown).toMatch(/^é+$/);
    expect(Buffer.byteLength(shown!)).toBeLessThanOrEqual(OTTO_TOOL_OUTPUT_MAX_BYTES);
    expect(capped).toContain("of 195.3 KB, 1 of 1 lines.");
    expect(fitsCap(capped)).toBe(true);
  });

  it("tells the tool's own way to read on, from the characters shown", () => {
    const capped = capToolText("a\n".repeat(5_000), (shown) => `Use offset=${shown} to read more.`);

    expect(capped).toContain("Use offset=3996 to read more.]");
  });
});

describe("capToolOutput", () => {
  it("returns small results as they are", () => {
    const result = { items: [1, 2, 3] };

    expect(capToolOutput(result)).toBe(result);
    expect(capToolOutput(undefined)).toBeUndefined();
  });

  it("turns a result over the cap into its capped JSON", () => {
    const result = { items: Array.from({ length: 5_000 }, (_, index) => ({ id: index })) };
    const capped = capToolOutput(result);

    expect(capped).toEqual(expect.stringMatching(/^\{\n {2}"items": \[\n {4}\{\n {6}"id": 0\n/));
    expect(fitsCap(String(capped))).toBe(true);
  });

  it("keeps a file read from the computer whole", () => {
    const media = {
      __workspaceMedia: true,
      text: "screenshot.png",
      mediaType: "image/png",
      data: "A".repeat(200_000),
    };

    expect(capToolOutput(media)).toBe(media);
  });
});
