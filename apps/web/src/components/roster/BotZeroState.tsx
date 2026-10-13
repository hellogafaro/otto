import { RiRobot3Line, RiAddLine } from "@remixicon/react";
import { Predicate } from "effect";
import { BotId } from "@otto/contracts";

import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { toastManager } from "../ui/toast";
import { DEFAULT_BOT_RUNTIME_MODE } from "./botSandbox";
import { NewBotDialog } from "./NewBotDialog";
import type { BotAvatar } from "./types";

/**
 * What a brand-new workspace sees. The old copy named the missing thing and
 * stopped there, leaving the only way forward in a menu on the other side of
 * the window. This says what a bot is for and creates one from here, using the
 * same command the roster's own New bot entry runs.
 */
export function BotZeroState() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const createBot = useAtomCommand(botEnvironment.create, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async ({ name, avatar }: { name: string; avatar: BotAvatar }) => {
    // A second submit before the first resolves would create a second bot.
    if (creating) return;

    if (environmentId === null) {
      toastManager.add({ type: "error", title: t("Connect an environment first") });

      return;
    }

    setCreating(true);

    const result = await createBot({
      environmentId,
      input: {
        botId: BotId.make(`bot-${randomUUID()}`),
        name: name.trim(),
        title: "Assistant",
        label: null,
        description: null,
        avatar,
        engine: null,
        sandbox: null,
        runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
        groupId: null,
      },
    });

    setCreating(false);

    if (Predicate.isTagged(result, "Failure")) {
      toastManager.add({ type: "error", title: t("Could not create bot") });

      return;
    }

    // The roster route watches for the new bot and opens its chat.
    setOpen(false);
  };

  return (
    <>
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyMedia variant="icon">
            <RiRobot3Line />
          </EmptyMedia>
          <EmptyTitle>{t("Hand off your first job")}</EmptyTitle>
          <EmptyDescription>
            {t(
              "A bot remembers your instructions, tools, and context, so you explain a job once and it keeps the work moving.",
            )}
          </EmptyDescription>
          <EmptyContent>
            <Button disabled={environmentId === null || creating} onClick={() => setOpen(true)}>
              <RiAddLine className="size-4" />
              {t("Create bot")}
            </Button>
            {environmentId === null ? (
              <span className="text-xs text-muted-foreground">
                {t("Connect an environment to create one.")}
              </span>
            ) : null}
          </EmptyContent>
        </EmptyHeader>
      </Empty>
      {open ? (
        <NewBotDialog
          open
          submitting={creating}
          onOpenChange={(next) => {
            if (creating) return;
            setOpen(next);
          }}
          onCreate={(input) => void handleCreate(input)}
        />
      ) : null}
    </>
  );
}
