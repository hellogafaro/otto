import type { AnsweredUserInputQuestion } from "@otto/client-runtime/user-input-answers";

/**
 * Otto: A submitted answer to a bot's questions, shown as the person's own reply: the same
 * bubble as a sent message, with each question in 12px muted text over what was answered.
 * Multi-select picks read in the order the bot offered them, joined into one line.
 */
export function UserInputAnswerCard({
  answered,
}: {
  readonly answered: ReadonlyArray<AnsweredUserInputQuestion>;
}) {
  return (
    <dl
      className="flex w-full flex-col gap-2 rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6"
      data-testid="user-input-answer-card"
    >
      {answered.map(({ question, answers }) => {
        const optionOrder = question.options.map((option) => option.label);

        // Picks read in the order the bot offered them; typed answers come last.
        const rank = (answer: string) => {
          const index = optionOrder.indexOf(answer);

          return index === -1 ? optionOrder.length : index;
        };

        return (
          <div key={question.id} className="flex flex-col">
            <dt className="line-clamp-2 text-xs leading-5 text-muted-foreground">
              {question.question}
            </dt>
            <dd className="break-words text-foreground">
              {[...new Set(answers)].toSorted((left, right) => rank(left) - rank(right)).join(", ")}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
