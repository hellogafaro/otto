import type { UserInputQuestion } from "@otto/contracts";
import { useState } from "react";

import { useI18n } from "~/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

/** What the secret form sends: the values and where to save them. */
export interface SecretRequestAnswer {
  readonly scope: "project" | "chat";
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Otto: The bot's secret request, inline like its other questions. The person types each value
 * into a masked field; the values save straight to Otto, so neither the chat nor the bot ever
 * holds them. The bot only learns which names are now set.
 */
export function SecretRequestCard({
  question,
  surface,
  onAnswer,
}: {
  readonly question: UserInputQuestion;
  readonly surface: "card" | "docked";
  readonly onAnswer: (answer: SecretRequestAnswer | null) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const fields = question.secrets ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<SecretRequestAnswer["scope"] | "cancel" | null>(null);
  const complete = fields.every((field) => (values[field.name] ?? "").length > 0);

  const answer = async (scope: SecretRequestAnswer["scope"] | null) => {
    setPending(scope ?? "cancel");
    const sent = await onAnswer(scope ? { scope, values } : null);

    if (!sent) setPending(null);
  };

  const body = (
    <form
      className="flex w-full min-w-0 flex-col gap-3 pt-4"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();

        if (complete && pending === null) void answer("project");
      }}
    >
      <div className="flex flex-col gap-1 px-4">
        <p className="text-sm font-medium text-pretty text-foreground">{question.question}</p>
        <p className="text-xs text-muted-foreground">
          {t("Values go straight to Otto. The bot gets them in its commands but never sees them.")}
        </p>
      </div>
      <div className="flex flex-col gap-3 px-4">
        {fields.map((field, index) => (
          <Field key={field.name} className="w-full">
            <FieldLabel>
              <span className="font-mono">{field.name}</span>
            </FieldLabel>
            {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus={index === 0}
              aria-label={field.name}
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <div className="mt-1 flex w-full flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button
          type="button"
          size="sm"
          variant="ghost-muted"
          className="me-auto"
          disabled={pending !== null}
          onClick={() => void answer(null)}
        >
          {pending === "cancel" ? <Spinner /> : null}
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!complete || pending !== null}
          onClick={() => void answer("chat")}
        >
          {pending === "chat" ? <Spinner /> : null}
          {t("This chat only")}
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!complete || pending !== null}>
          {pending === "project" ? <Spinner /> : null}
          {t("Save to project")}
        </Button>
      </div>
    </form>
  );

  return (
    <section
      aria-label={question.question}
      className="chat-generative w-full max-w-2xl"
      data-generative="question"
      data-testid="secret-request-card"
    >
      {surface === "card" ? <Card>{body}</Card> : body}
    </section>
  );
}
