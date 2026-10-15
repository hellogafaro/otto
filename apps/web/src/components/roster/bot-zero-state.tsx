import { RiRobot3Line, RiAddLine } from "@remixicon/react";

import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
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
import { NewBotDialog } from "./new-bot-dialog";
import { useCreateBot } from "./use-create-bot";

/**
 * What a brand-new workspace sees. The old copy named the missing thing and
 * stopped there, leaving the only way forward in a menu on the other side of
 * the window. This says what a bot is for and creates one from here, using the
 * same command Settings' New bot runs.
 */
export function BotZeroState() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const [open, setOpen] = useState(false);
  const { creating, create } = useCreateBot(() => setOpen(false));

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
          onCreate={(input) => void create(input)}
        />
      ) : null}
    </>
  );
}
