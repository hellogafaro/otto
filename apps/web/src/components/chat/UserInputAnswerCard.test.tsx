import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { UserInputAnswerCard } from "./UserInputAnswerCard";

const scope = {
  id: "scope",
  header: "Scope",
  question: "Which suites should I touch?",
  multiSelect: true,
  options: [
    { label: "Server", description: "Reaper tests" },
    { label: "Web", description: "Reconnect tests" },
    { label: "Mobile", description: "Session restore tests" },
  ],
};

const fix = {
  id: "fix",
  header: "Fix",
  question: "How should I fix the reaper tests?",
  multiSelect: false,
  options: [
    { label: "Wait on receipts", description: "Replace the sleeps" },
    { label: "Raise the timeout", description: "Keeps the race" },
  ],
};

describe("UserInputAnswerCard", () => {
  it("lists multi-select picks once each, in the order the bot offered them", () => {
    const markup = renderToStaticMarkup(
      <UserInputAnswerCard
        answered={[{ question: scope, answers: ["Mobile", "Server", "Server"] }]}
      />,
    );

    expect(markup).toContain(">Server, Mobile<");
  });

  it("reads back each question over its answer, typed answers included", () => {
    const markup = renderToStaticMarkup(
      <UserInputAnswerCard
        answered={[
          { question: fix, answers: ["Receipts, then delete"] },
          { question: scope, answers: ["Web"] },
        ]}
      />,
    );

    expect(markup).toMatch(
      /How should I fix the reaper tests\?<\/dt><dd[^>]*>Receipts, then delete</,
    );
    expect(markup).toMatch(/Which suites should I touch\?<\/dt><dd[^>]*>Web</);
  });
});
