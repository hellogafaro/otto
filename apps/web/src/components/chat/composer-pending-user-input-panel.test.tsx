import { ApprovalRequestId } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingUserInputPanel } from "./composer-pending-user-input-panel";
import type { PendingUserInput } from "../../session-logic";

const approachQuestion = {
  id: "question-1",
  header: "Approach",
  question: "Which approach should the migration take?",
  options: [
    { label: "Incremental", description: "Move one module at a time" },
    { label: "Big bang", description: "Move everything in one release" },
  ],
  multiSelect: false,
};

const areasQuestion = {
  id: "question-2",
  header: "Areas",
  question: "Which areas should it cover first?",
  options: [
    { label: "Server", description: "Server" },
    { label: "Web", description: "Web" },
  ],
  multiSelect: true,
};

function prompt(questions: PendingUserInput["questions"]): PendingUserInput {
  return {
    requestId: ApprovalRequestId.make("request-1"),
    createdAt: "2026-08-15T00:00:00.000Z",
    questions,
  };
}

function renderPanel(
  questions: PendingUserInput["questions"],
  answers: Parameters<typeof ComposerPendingUserInputPanel>[0]["answers"] = {},
  step = 0,
) {
  return renderToStaticMarkup(
    <ComposerPendingUserInputPanel
      pendingUserInputs={[prompt(questions)]}
      respondingRequestIds={[]}
      answers={answers}
      step={step}
      onStepChange={() => {}}
      onSelectOption={() => {}}
      onAnswerWithText={() => {}}
      onSubmit={() => {}}
    />,
  );
}

/** Markup without class lists, whose variant names would read as states. */
const withoutClasses = (markup: string) => markup.replace(/ class="[^"]*"/g, "");

/** The opening tag of the element with this data-slot, its classes left out. */
const slotTag = (markup: string, slot: string, nth = 0) =>
  [...withoutClasses(markup).matchAll(new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`, "g"))][
    nth
  ]?.[0] ?? "";

describe("ComposerPendingUserInputPanel", () => {
  it("keeps a lone single-choice question behind Send, so one stray click cannot answer it", () => {
    const markup = renderPanel([approachQuestion]);

    expect(markup).toContain('data-testid="pending-user-input-card"');
    expect(markup).toContain('aria-label="Which approach should the migration take?"');
    expect(markup).toContain('aria-keyshortcuts="1"');
    expect(markup).toMatch(/data-slot="questionnaire-choice-shortcut"[^>]*>1</);
    expect(markup).toMatch(/data-slot="questionnaire-choice-shortcut"[^>]*>2</);
    expect(markup).not.toContain('role="progressbar"');
    expect(slotTag(markup, "questionnaire-submit")).toContain('disabled=""');
    expect(markup).toMatch(/data-slot="questionnaire-submit"[^>]*>Send</);

    const picked = renderPanel([approachQuestion], {
      "question-1": { selectedOptionLabels: ["Incremental"] },
    });

    expect(slotTag(picked, "questionnaire-submit")).not.toContain("disabled");
  });

  it("shows one question at a time with its place in the set", () => {
    const markup = renderPanel([approachQuestion, areasQuestion]);

    expect(slotTag(markup, "questionnaire-item", 0)).not.toContain("hidden");
    expect(slotTag(markup, "questionnaire-item", 1)).toContain('hidden=""');
    expect(markup).toMatch(/role="progressbar"[^>]*>1 of 2</);
    expect(slotTag(markup, "questionnaire-previous")).toContain('hidden=""');
  });

  it("waits for Next on an unanswered step", () => {
    const open = renderPanel([approachQuestion, areasQuestion]);
    expect(slotTag(open, "questionnaire-next")).toContain('disabled=""');

    const answered = renderPanel([approachQuestion, areasQuestion], {
      "question-1": { selectedOptionLabels: ["Incremental"] },
    });

    expect(slotTag(answered, "questionnaire-next")).not.toContain("disabled");
  });

  it("offers Back and Send on the last step, enabled once every question is answered", () => {
    const partial = renderPanel([approachQuestion, areasQuestion], {}, 1);

    expect(slotTag(partial, "questionnaire-item", 1)).not.toContain("hidden");
    expect(partial).toMatch(/<\/svg>Back<\/button>/);
    expect(slotTag(partial, "questionnaire-previous")).not.toContain("hidden");
    expect(slotTag(partial, "questionnaire-submit")).toContain('disabled=""');

    const complete = renderPanel(
      [approachQuestion, areasQuestion],
      {
        "question-1": { selectedOptionLabels: ["Incremental"] },
        "question-2": { selectedOptionLabels: ["Web"] },
      },
      1,
    );

    expect(slotTag(complete, "questionnaire-submit")).not.toContain("disabled");
  });

  it("marks the picked choices as radios for one answer and checkboxes for many", () => {
    const markup = renderPanel(
      [approachQuestion, areasQuestion],
      {
        "question-1": { selectedOptionLabels: ["Incremental"] },
        "question-2": { selectedOptionLabels: ["Web"] },
      },
      0,
    );

    expect(slotTag(markup, "questionnaire-choice", 0)).toContain('data-type="radio"');
    expect(slotTag(markup, "questionnaire-choice", 0)).toContain("data-checked");
    expect(slotTag(markup, "questionnaire-choice", 1)).not.toContain("data-checked");
    expect(slotTag(markup, "questionnaire-choice", 3)).toContain('data-type="checkbox"');
    expect(slotTag(markup, "questionnaire-choice", 3)).toContain("data-checked");
  });

  it("offers a field for a typed answer and fills it in once one is typed", () => {
    const empty = renderPanel([approachQuestion, areasQuestion], {});

    expect(empty).toContain('placeholder="Type your own answer"');
    expect(slotTag(empty, "questionnaire-input")).toContain("data-empty");

    const markup = renderPanel([approachQuestion, areasQuestion], {
      "question-1": { customAnswer: "Whatever is safest" },
    });

    expect(markup).toContain('value="Whatever is safest"');
    expect(slotTag(markup, "questionnaire-input")).toContain("data-filled");
    expect(withoutClasses(markup)).not.toMatch(/data-checked/);
  });
});
