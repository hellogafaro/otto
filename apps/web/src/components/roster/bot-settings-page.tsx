import { Predicate } from "effect";
import { BotId } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer } from "../settings/settings-layout";
import { toast } from "sonner";
import { BotSettingsForm } from "./bot-settings-form";
import { useRosterStore } from "./roster-store";
import type { BotProfileUpdate } from "./use-bot-profile-draft";

/**
 * Otto: One bot's settings, a subpage of Settings > Bots, so the Settings nav stays beside it
 * and the top bar's back button returns to the list.
 */
export function BotSettingsPage({ botId }: { readonly botId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });

  const bot = useRosterStore((state) =>
    state.bots.find((candidate) => candidate.id === botId && candidate.archivedAt === null),
  );

  const onSaveBot = useCallback(
    async (input: BotProfileUpdate) => {
      if (!environmentId || !bot) return false;

      const result = await updateBot({
        environmentId,
        input: { botId: BotId.make(bot.id), ...input },
      });

      if (Predicate.isTagged(result, "Failure")) {
        toast.error(t("Bot settings couldn't be saved"));

        return false;
      }

      return true;
    },
    [bot, environmentId, t, updateBot],
  );

  if (!bot) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">{t("This bot is no longer available.")}</p>
      </SettingsPageContainer>
    );
  }

  return (
    <BotSettingsForm
      key={bot.id}
      bot={bot}
      onSave={onSaveBot}
      onDeleted={() =>
        void navigate({ to: "/settings/$section", params: { section: "bots" }, replace: true })
      }
    />
  );
}
