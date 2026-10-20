import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MENTION_CLASS_NAME, renderMentionLink } from "./mention-link";

describe("renderMentionLink", () => {
  it("draws a task mention as the info pill and leaves other links alone", () => {
    const opened: Array<{ type: string; id: string }> = [];

    const markup = renderToStaticMarkup(
      <>
        {renderMentionLink("#mention/task/task-1", "Launch", (mention) => opened.push(mention))}
        {renderMentionLink("#mention/library/file-1", "Brief", () => undefined)}
        {renderMentionLink("https://example.com", "elsewhere", () => undefined)}
      </>,
    );

    expect(markup).toContain(`class="${MENTION_CLASS_NAME}"`);
    expect(markup).toContain("@Launch");
    expect(markup).toContain("@Brief");
    expect(markup).not.toContain("elsewhere");
    expect(opened).toEqual([]);
  });
});
