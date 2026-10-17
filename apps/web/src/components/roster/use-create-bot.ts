import { BotId } from "@otto/contracts";
import { Predicate } from "effect";
import { useCallback, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toast } from "sonner";
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
    ({ name, avatar, engine, instructions }: NewBotInput) =>
      runCreateBotOnce(creatingRef, async () => {
        if (environmentId === null) {
          toast.error(t("Connect an environment first"));

          return;
        }

        setCreating(true);

        try {
          const botId = BotId.make(randomUUID());

          const result = await createBotCommand({
            environmentId,
            input: {
              botId,
              name: name.trim(),
              title: "Assistant",
              label: null,
              description: null,
              instructions,
              avatar,
              engine,
              sandbox: null,
              runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
              groupId: null,
            },
          });

          if (Predicate.isTagged(result, "Failure")) {
            toast.error(t("Bot couldn't be created"));

            return;
          }

          useRosterStore.getState().selectBot(botId);

          // Its first chat opens with the bot introducing itself, from a prompt the chat hides.
          // Onboarding closes only once that chat exists, so Chats opens it instead of a new one.
          await startChat(
            { kind: "bot", id: botId },
            {
              prompt: botIntroPrompt(name.trim(), locale),
              hidden: true,
              title: t("Meet {name}", { name: name.trim() }),
            },
          );
          onCreated();
        } finally {
          setCreating(false);
        }
      }),
    [createBotCommand, environmentId, locale, onCreated, startChat, t],
  );

  return { creating, canCreate: environmentId !== null, create };
}
