import { RiArrowLeftSLine } from "@remixicon/react";
import { type ApprovalRequestId, type UserInputQuestion } from "@otto/contracts";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "~/i18n";
import {
  buildPendingUserInputAnswers,
  type PendingUserInputDraftAnswer,
  pendingUserInputKeyAction,
  resolvePendingUserInputAnswer,
} from "../../pending-user-input";
import { type PendingUserInput } from "../../session-logic";
import { Card } from "../ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "../ui/questionnaire";
import { SecretRequestCard, type SecretRequestAnswer } from "./secret-request-card";
import { useApprovalShortcuts } from "./use-approval-shortcuts";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  /** The question on screen. Typed replies answer this one too. */
  step: number;
  onStepChange: (step: number) => void;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  /** Answers the question on screen with text typed into the card's own-answer row. */
  onAnswerWithText: (text: string) => void;
  onSubmit?: () => void;
  /** Answers a secret request; without it a secret request shows as an ordinary question. */
  onAnswerSecrets?: (answer: SecretRequestAnswer | null) => Promise<boolean>;
  /** `docked` drops the card chrome when a host surface already frames the panel. */
  surface?: "card" | "docked";
  /** The approve shortcut moves on or sends while no tool approval comes first. */
  shortcuts?: boolean;
}

/**
 * The bot's open question as one card built on shadcn's Questionnaire, one question at a
 * time. A single-choice pick moves to the next question and the last one sends; multi-select
 * steps wait for Next. Number keys pick options on the question on screen, other typing goes
 * to the own-answer field, and Enter moves on.
 */
export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  step,
  onStepChange,
  onSelectOption,
  onAnswerWithText,
  onSubmit,
  onAnswerSecrets,
  surface = "card",
  shortcuts = false,
}: PendingUserInputPanelProps) {
  const activePrompt = pendingUserInputs[0];

  // Once the answer is on its way the card goes at once, so it never sits beside the reply.
  if (!activePrompt || respondingRequestIds.includes(activePrompt.requestId)) return null;

  const secretQuestion = activePrompt.questions[0];

  if (secretQuestion?.secrets && onAnswerSecrets) {
    return (
      <SecretRequestCard
        key={activePrompt.requestId}
        question={secretQuestion}
        surface={surface}
        onAnswer={onAnswerSecrets}
      />
    );
  }

  return (
    <PendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      answers={answers}
      step={step}
      onStepChange={onStepChange}
      onSelectOption={onSelectOption}
      onAnswerWithText={onAnswerWithText}
      surface={surface}
      shortcuts={shortcuts}
      {...(onSubmit ? { onSubmit } : {})}
    />
  );
});

function isTypingTarget(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;

  return (
    target instanceof HTMLElement &&
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/** Enter on a focused link, button, or field belongs to that control, not to the card. */
function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]',
    ) !== null
  );
}

function PendingUserInputCard({
  prompt,
  answers,
  step: requestedStep,
  onStepChange,
  onSelectOption,
  onAnswerWithText,
  onSubmit,
  surface,
  shortcuts,
}: {
  prompt: PendingUserInput;
  answers: Record<string, PendingUserInputDraftAnswer>;
  step: number;
  onStepChange: (step: number) => void;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onAnswerWithText: (text: string) => void;
  onSubmit?: () => void;
  surface: "card" | "docked";
  shortcuts: boolean;
}) {
  const { t } = useI18n();
  const { questions } = prompt;
  const step = Math.min(Math.max(requestedStep, 0), questions.length - 1);
  const question = questions[step];
  const isLastStep = step === questions.length - 1;
  const complete = buildPendingUserInputAnswers(questions, answers) !== null;

  const stepAnswered = question
    ? resolvePendingUserInputAnswer(question, answers[question.id])
    : null;

  const ownAnswerRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const goOn =
    isLastStep && complete && onSubmit
      ? onSubmit
      : !isLastStep && stepAnswered !== null
        ? () => onStepChange(step + 1)
        : undefined;

  const shortcutHint = useApprovalShortcuts(shortcuts, goOn ? { "approval.approve": goOn } : {});

  useEffect(() => {
    if (!question) return;

    // Keys inside the card belong to the Questionnaire; this takes them from anywhere else.
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;

      const target = event.target instanceof Node ? event.target : null;

      if (cardRef.current?.contains(target) || isInteractiveTarget(event.target)) return;

      if (event.key === "Enter") {
        if (event.defaultPrevented) return;

        if (isLastStep && complete && onSubmit) {
          event.preventDefault();
          onSubmit();
        } else if (!isLastStep && stepAnswered !== null) {
          event.preventDefault();
          onStepChange(step + 1);
        }

        return;
      }

      const action = pendingUserInputKeyAction(event.key, question.options.length);
      const option = action?.kind === "pick" ? question.options[action.optionIndex] : undefined;

      if (option) {
        event.preventDefault();
        onSelectOption(question.id, option.label);
      } else if (action?.kind === "type") {
        // Focus moves before the character lands, so it starts the typed answer.
        ownAnswerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handler);

    return () => document.removeEventListener("keydown", handler);
  }, [complete, isLastStep, onSelectOption, onStepChange, onSubmit, question, step, stepAnswered]);

  if (!question) return null;

  const body = (
    <Questionnaire
      items={questions.map((entry) => ({
        name: entry.id,
        required: true,
        choices: entry.options.map((option) => ({ value: option.label })),
      }))}
      item={question.id}
      onItemChange={(name) => {
        const index = questions.findIndex((entry) => entry.id === name);

        if (index >= 0) onStepChange(index);
      }}
      shortcuts="numbers"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        if (complete) onSubmit?.();
      }}
    >
      {questions.length > 1 ? (
        <QuestionnaireProgress>
          {t("{step} of {total}", { step: String(step + 1), total: String(questions.length) })}
        </QuestionnaireProgress>
      ) : null}
      {questions.map((entry) => (
        <PendingQuestion
          key={entry.id}
          question={entry}
          draft={answers[entry.id]}
          onSelectOption={onSelectOption}
          onAnswerWithText={onAnswerWithText}
          ownAnswerRef={entry.id === question.id ? ownAnswerRef : undefined}
        />
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious size="sm" variant="ghost-muted">
          <RiArrowLeftSLine />
          {t("Back")}
        </QuestionnairePrevious>
        <QuestionnaireNext size="sm" variant="primary" disabled={stepAnswered === null}>
          {t("Next")}
          {shortcutHint("approval.approve")}
        </QuestionnaireNext>
        <QuestionnaireSubmit size="sm" variant="primary" disabled={!complete || !onSubmit}>
          {t("Send")}
          {shortcutHint("approval.approve")}
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );

  return (
    <section
      ref={cardRef}
      aria-label={question.question}
      className="chat-generative w-full max-w-2xl"
      data-generative="question"
      data-testid="pending-user-input-card"
    >
      {surface === "card" ? <Card>{body}</Card> : body}
    </section>
  );
}

/** One question as a Questionnaire item; the item on screen is the one the card is on. */
function PendingQuestion({
  question,
  draft,
  onSelectOption,
  onAnswerWithText,
  ownAnswerRef,
}: {
  question: UserInputQuestion;
  draft: PendingUserInputDraftAnswer | undefined;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onAnswerWithText: (text: string) => void;
  ownAnswerRef: RefObject<HTMLInputElement | null> | undefined;
}) {
  const { t } = useI18n();
  const customAnswer = draft?.customAnswer?.trim() ?? "";
  const resolved = resolvePendingUserInputAnswer(question, draft);
  const selectedLabels = customAnswer ? [] : [resolved ?? []].flat();
  const [text, setText] = useState(customAnswer);
  const [shownAnswer, setShownAnswer] = useState(customAnswer);

  // An answer sent from the composer replaces whatever is in the field.
  if (shownAnswer !== customAnswer) {
    setShownAnswer(customAnswer);
    setText(customAnswer);
  }

  return (
    <QuestionnaireItem name={question.id} multiple={question.multiSelect === true} required>
      <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
      <QuestionnaireChoices>
        {question.options.map((option) => (
          <QuestionnaireChoice
            key={option.label}
            value={option.label}
            checked={selectedLabels.includes(option.label)}
            onChange={() => onSelectOption(question.id, option.label)}
          >
            <span className="text-foreground">{option.label}</span>
            {option.description && option.description !== option.label ? (
              <QuestionnaireChoiceDescription className="text-xs">
                {option.description}
              </QuestionnaireChoiceDescription>
            ) : null}
          </QuestionnaireChoice>
        ))}
        <QuestionnaireInput
          ref={ownAnswerRef}
          aria-label={t("Type your own answer")}
          placeholder={t("Type your own answer")}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            const trimmed = text.trim();

            if (event.key !== "Enter" || event.nativeEvent.isComposing || !trimmed) return;
            event.preventDefault();
            event.stopPropagation();
            onAnswerWithText(trimmed);
          }}
        />
      </QuestionnaireChoices>
    </QuestionnaireItem>
  );
}
