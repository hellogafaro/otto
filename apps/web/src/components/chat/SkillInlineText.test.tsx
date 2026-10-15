import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CHAT_INLINE_SKILL_CHIP_CLASS_NAME } from "../composerInlineChip";
import { SkillInlineText } from "./SkillInlineText";

const skills = [
  { name: "review-follow-up", displayName: "Review Follow-up", icon: "🔧" },
  { name: "deploy", icon: "/icons/deploy.png" },
];

describe("SkillInlineText", () => {
  it("renders sent skills as the borderless composer pill", () => {
    const markup = renderToStaticMarkup(
      <SkillInlineText text="Run $review-follow-up then $deploy" skills={skills} />,
    );

    expect(markup).toContain('data-markdown-copy="$review-follow-up"');
    expect(markup).toContain('data-markdown-copy="$deploy"');
    expect(markup).not.toContain("border");
    expect(markup).toContain(CHAT_INLINE_SKILL_CHIP_CLASS_NAME);
  });

  it("shows only the skill's name, with no icon", () => {
    const markup = renderToStaticMarkup(
      <SkillInlineText text="$review-follow-up $deploy" skills={skills} />,
    );

    expect(markup).toContain(">Review Follow-up</span>");
    expect(markup).not.toContain("🔧");
    expect(markup).not.toContain("<svg");
  });
});
