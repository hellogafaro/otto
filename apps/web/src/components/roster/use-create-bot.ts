import { BotId } from "@otto/contracts";
import { Predicate } from "effect";
import { useCallback, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { botIntroPrompt } from "./bot-intro";
import { DEFAULT_BOT_RUNTIME_MODE } from "./bot-sandbox";
import { useStartChat } from "./chat-navigation";
import type { NewBotInput } from "./new-bot-dialog";
import { runCreateBotOnce } from "./roster-commands.logic";
import { useRosterStore } from "./roster-store";

/**
 * Otto: Creates a bot from the New bot dialog, then opens its first chat, where it
 * introduces itself. `onCreated` runs once the bot exists; a second submit while one
 * is on its way is ignored.
 */
export function useCreateBot(onCreated: () => void) {
  const { t, locale } = useI18n();
  const startChat = useStartChat();
  const environmentId = usePrimaryEnvironmentId();
  const createBotCommand = useAtomCommand(botEnvironment.create, { reportFailure: false });
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const create = useCallback(
    ({ name, avatar, engine }: NewBotInput) =>
      runCreateBotOnce(creatingRef, async () => {
        if (environmentId === null) {
          toastManager.add({ type: "error", title: t("Connect an environment first") });

          return;
        }

        setCreating(true);

        try {
          const botId = BotId.make(`bot-${randomUUID()}`);

          const result = await createBotCommand({
            environmentId,
            input: {
              botId,
              name: name.trim(),
              title: "Assistant",
              label: null,
              description: null,
              avatar,
              engine,
              sandbox: null,
              runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
              groupId: null,
            },
          });

          if (Predicate.isTagged(result, "Failure")) {
            toastManager.add({ type: "error", title: t("Could not create bot") });

            return;
          }

          useRosterStore.getState().selectBot(botId);
          onCreated();

          // Its first chat opens with the bot introducing itself, from a prompt the chat hides.
          void startChat(
            { kind: "bot", id: botId },
            {
              prompt: botIntroPrompt(name.trim(), locale),
              hidden: true,
              title: t("Meet {name}", { name: name.trim() }),
            },
          );
        } finally {
          setCreating(false);
        }
      }),
    [createBotCommand, environmentId, locale, onCreated, startChat, t],
  );

  return { creating, canCreate: environmentId !== null, create };
}
