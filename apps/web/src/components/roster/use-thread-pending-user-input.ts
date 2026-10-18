import { Predicate } from "effect";
import {
  type ApprovalRequestId,
  type ProjectId,
  type ScopedThreadRef,
  SECRET_SAVE_TO_CHAT,
  SECRET_SAVE_TO_PROJECT,
} from "@otto/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyPendingUserInputOptionSelection,
  buildPendingUserInputAnswers,
  type PendingUserInputDraftAnswer,
  pendingUserInputStepAfterAnswer,
} from "../../pending-user-input";
import type { PendingUserInput } from "../../session-logic";
import { secretsEnvironment } from "../../state/secrets";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SecretRequestAnswer } from "../chat/secret-request-card";
import {
  type BotThreadFailure,
  commandFailure,
  localFailure,
} from "./thread-runtime-warning.logic";

/**
 * Answers the oldest open question in a bot or group chat, one question (step) at a time.
 * Draft answers and the step reset whenever a different prompt comes up, and a request id
 * stays marked as responding from the moment its answer is sent until the prompt leaves
 * the thread.
 */
export function useThreadPendingUserInput(input: {
  readonly linkedThreadRef: ScopedThreadRef | null;
  /** The chat's project, where a secret request's "Save to project" answer saves. */
  readonly projectId: ProjectId | null;
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly onFailure: (failure: BotThreadFailure) => void;
}) {
  const { linkedThreadRef, onFailure, pendingUserInputs, projectId } = input;

  const respondToUserInputCommand = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });

  const saveSecretsCommand = useAtomCommand(secretsEnvironment.save, { reportFailure: false });

  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const respondingRequestIdsRef = useRef(new Set<ApprovalRequestId>());

  const [pendingUserInputAnswers, setPendingUserInputAnswers] = useState<
    Record<string, PendingUserInputDraftAnswer>
  >({});

  // Picks build on the latest draft, not the one from the last render, so two clicks
  // handled before React re-renders both count.
  const answersRef = useRef(pendingUserInputAnswers);

  const setAnswers = useCallback((next: Record<string, PendingUserInputDraftAnswer>) => {
    answersRef.current = next;
    setPendingUserInputAnswers(next);
  }, []);

  const [pendingUserInputStep, setPendingUserInputStep] = useState(0);

  const submitPendingUserInput = useCallback(
    async (
      requestId: ApprovalRequestId,
      answers: Record<string, string | string[]>,
    ): Promise<boolean> => {
      if (!linkedThreadRef || respondingRequestIdsRef.current.has(requestId)) return false;
      respondingRequestIdsRef.current.add(requestId);
      setRespondingRequestIds((current) =>
        current.includes(requestId) ? current : [...current, requestId],
      );

      const result = await respondToUserInputCommand({
        environmentId: linkedThreadRef.environmentId,
        input: { threadId: linkedThreadRef.threadId, requestId, answers },
      });

      if (Predicate.isTagged(result, "Failure")) {
        respondingRequestIdsRef.current.delete(requestId);
        setRespondingRequestIds((current) => current.filter((id) => id !== requestId));
        onFailure(commandFailure(result));

        return false;
      }

      return true;
    },
    [linkedThreadRef, onFailure, respondToUserInputCommand],
  );

  /**
   * Takes a typed prompt as the custom answer to the current step, then moves on like a
   * pick would, sending from the last step once every question is answered. Resolves true
   * when the text was used.
   */
  const answerPendingUserInputWithPrompt = useCallback(
    async (pendingUserInput: PendingUserInput, prompt: string): Promise<boolean> => {
      if (respondingRequestIds.includes(pendingUserInput.requestId)) return false;

      const { questions } = pendingUserInput;
      const step = Math.min(pendingUserInputStep, questions.length - 1);
      const question = questions[step];

      if (!question || !prompt.trim()) return false;

      // A typed answer would be saved in the chat, so secrets only go through their form.
      if (question.secrets) {
        onFailure(localFailure("Enter secrets in the form above, not in a message."));

        return false;
      }

      const nextAnswers = {
        ...answersRef.current,
        [question.id]: { customAnswer: prompt.trim() },
      };

      setAnswers(nextAnswers);
      const nextStep = pendingUserInputStepAfterAnswer(questions, nextAnswers, step);

      if (nextStep !== null) {
        setPendingUserInputStep(nextStep);

        return true;
      }

      const answers = buildPendingUserInputAnswers(questions, nextAnswers);

      return answers ? submitPendingUserInput(pendingUserInput.requestId, answers) : true;
    },
    [onFailure, pendingUserInputStep, respondingRequestIds, setAnswers, submitPendingUserInput],
  );

  /**
   * Answers the open secret request: saves the values first, so the answer the chat records
   * names only where they went. Null cancels it.
   */
  const answerSecretRequest = useCallback(
    async (answer: SecretRequestAnswer | null): Promise<boolean> => {
      const pending = pendingUserInputs[0];
      const question = pending?.questions[0];

      if (!pending || !question || !linkedThreadRef) return false;

      if (!answer) return submitPendingUserInput(pending.requestId, { [question.id]: "Cancel" });

      const target =
        answer.scope === "project"
          ? projectId === null
            ? null
            : { scope: "project" as const, projectId }
          : { scope: "chat" as const, threadId: linkedThreadRef.threadId };

      if (!target) return false;

      const saved = await saveSecretsCommand({
        environmentId: linkedThreadRef.environmentId,
        input: { target, values: answer.values },
      });

      if (Predicate.isTagged(saved, "Failure")) {
        onFailure(commandFailure(saved));

        return false;
      }

      return submitPendingUserInput(pending.requestId, {
        [question.id]: answer.scope === "project" ? SECRET_SAVE_TO_PROJECT : SECRET_SAVE_TO_CHAT,
      });
    },
    [
      linkedThreadRef,
      onFailure,
      pendingUserInputs,
      projectId,
      saveSecretsCommand,
      submitPendingUserInput,
    ],
  );

  /** Answers the question on screen with text typed into the card's own-answer row. */
  const answerPendingUserInputWithText = useCallback(
    (text: string) => {
      const pending = pendingUserInputs[0];

      return pending ? answerPendingUserInputWithPrompt(pending, text) : Promise.resolve(false);
    },
    [answerPendingUserInputWithPrompt, pendingUserInputs],
  );

  useEffect(() => {
    setAnswers({});
    setPendingUserInputStep(0);
    const pendingIds = new Set(pendingUserInputs.map((pending) => pending.requestId));

    for (const requestId of respondingRequestIdsRef.current) {
      if (!pendingIds.has(requestId)) respondingRequestIdsRef.current.delete(requestId);
    }

    setRespondingRequestIds((current) => current.filter((requestId) => pendingIds.has(requestId)));
  }, [pendingUserInputs[0]?.requestId]);

  const selectPendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      const pending = pendingUserInputs[0];

      if (!pending || respondingRequestIdsRef.current.has(pending.requestId)) return;

      const selection = applyPendingUserInputOptionSelection(
        pending.questions,
        answersRef.current,
        questionId,
        optionLabel,
      );

      if (!selection) return;
      setAnswers(selection.draftAnswers);
      setPendingUserInputStep(selection.nextStep);
    },
    [pendingUserInputs, setAnswers],
  );

  const submitPendingUserInputAnswers = useCallback(async () => {
    const pending = pendingUserInputs[0];

    if (!pending) return;

    const answers = buildPendingUserInputAnswers(pending.questions, answersRef.current);

    if (!answers) return;
    await submitPendingUserInput(pending.requestId, answers);
  }, [pendingUserInputs, submitPendingUserInput]);

  return {
    pendingUserInputAnswers,
    pendingUserInputStep,
    setPendingUserInputStep,
    respondingRequestIds,
    answerPendingUserInputWithPrompt,
    answerPendingUserInputWithText,
    answerSecretRequest,
    selectPendingUserInputOption,
    submitPendingUserInputAnswers,
  };
}
