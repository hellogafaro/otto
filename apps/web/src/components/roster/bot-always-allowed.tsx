import {
  BotId,
  sameAlwaysAllowedTool,
  type BotAlwaysAllowedTool,
  type EnvironmentId,
} from "@otto/contracts";
import { Predicate } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settings-layout";
import { Button } from "../ui/button";
import type { Bot } from "./types";

type Translate = ReturnType<typeof useI18n>["t"];

/** The kind of action a rule covers, as the server classified it. */
function actionLabel(action: string, t: Translate) {
  switch (action) {
    case "send":
      return t("Sending only");
    case "pay":
      return t("Payments only");
    case "delete":
      return t("Deleting only");
    case "production":
      return t("Production changes only");
    case "secrets":
      return t("Secrets only");
    case "publish":
      return t("Publishing only");
    case "sign":
      return t("Signing only");
    case "refund":
      return t("Refunds only");
    case "account":
      return t("Account changes only");
    default:
      return action;
  }
}

/**
 * Otto: The tools a person let this bot run without asking by choosing Always allow on one of its
 * approvals, and the only place they are managed. Each row names the tool, the kind of action it
 * covers, who turned it on and when; Remove makes the bot ask again from its next turn.
 */
export function BotAlwaysAllowed({
  bot,
  environmentId,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId | null;
}) {
  const { t, formatDate } = useI18n();
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });
  const [removing, setRemoving] = useState(false);
  const rules = bot.alwaysAllowed ?? [];

  const remove = (rule: BotAlwaysAllowedTool) => {
    if (!environmentId) return;
    setRemoving(true);
    void updateBot({
      environmentId,
      input: {
        botId: BotId.make(bot.id),
        alwaysAllowed: rules.filter((entry) => !sameAlwaysAllowedTool(entry, rule)),
      },
    }).then((result) => {
      setRemoving(false);

      if (Predicate.isTagged(result, "Failure")) toast.error(t("Bot settings couldn't be saved"));
    });
  };

  return (
    <SettingsSection
      id="always-allowed"
      title={t("Always allowed")}
      count={rules.length > 0 ? rules.length : undefined}
      description={t("Tools this bot runs without asking. Remove one and it asks again.")}
    >
      {rules.length === 0 ? (
        <SettingsRow
          title={t("Nothing always allowed")}
          description={t("Choose Always allow on one of this bot's approvals to add a tool here.")}
        />
      ) : null}
      {rules.map((rule) => {
        const name = rule.createdBy.displayName;

        const date = formatDate(new Date(rule.createdAt), {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        const turnedOn = t("Turned on by {name} on {date}", { name, date });

        return (
          <SettingsRow
            key={`${rule.toolName}:${rule.action ?? ""}`}
            title={rule.toolName}
            description={rule.action ? `${actionLabel(rule.action, t)} · ${turnedOn}` : turnedOn}
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={!environmentId || removing}
                aria-label={t("Stop always allowing {tool}", { tool: rule.toolName })}
                onClick={() => remove(rule)}
              >
                {t("Remove")}
              </Button>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
