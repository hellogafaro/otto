import { Predicate } from "effect";
import { BotId } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer } from "../settings/settingsLayout";
import { toastManager } from "../ui/toast";
import { BotSettingsForm } from "./BotSettingsForm";
import { useRosterStore } from "./rosterStore";
import type { BotProfileUpdate } from "./useBotProfileDraft";

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
        toastManager.add({ type: "error", title: t("Could not save bot settings") });

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
