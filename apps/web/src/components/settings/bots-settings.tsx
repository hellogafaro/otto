import { RiAddLine, RiRobot3Line } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { CustomizeRow } from "../customize/customize-group";
import { BotAvatarView } from "../roster/bot-avatar-view";
import { NewBotDialog } from "../roster/new-bot-dialog";
import { useRosterStore } from "../roster/roster-store";
import { useCreateBot } from "../roster/use-create-bot";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsPageSkeleton, SettingsSection } from "./settings-layout";
import { isRosterReady } from "../roster/roster-route-selection";
import { useSettingsEnvironmentId } from "~/settings-dialog-store";

/**
 * Otto: Bots live in Settings, as they change rarely: one card like Skills, each bot a row with
 * its avatar, name and description that opens its settings. The card's first row counts the
 * bots and holds the plus, as page titles never carry actions; the plus opens the same New bot
 * dialog as before and, once the bot exists, its first chat, where it introduces itself.
 */
export function BotsSettingsPanel() {
  const { t, plural } = useI18n();
  const navigate = useNavigate();
  const bots = useRosterStore((state) => state.bots);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const { creating, canCreate, create } = useCreateBot(() => setCreatingOpen(false));
  const environmentId = useSettingsEnvironmentId();
  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);

  if (!isRosterReady(environmentId, rosterEnvironmentId)) return <SettingsPageSkeleton />;

  const live = bots
    .filter((bot) => bot.archivedAt === null)
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("Bots")}>
        <div data-settings-row="" className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-13px font-medium text-foreground">
            {plural(live.length, { one: "{count} bot", other: "{count} bots" })}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={t("New bot")}
                  disabled={!canCreate}
                  onClick={() => setCreatingOpen(true)}
                >
                  <RiAddLine aria-hidden className="size-4" />
                </Button>
              }
            />
            <TooltipPopup side="bottom">{t("New bot")}</TooltipPopup>
          </Tooltip>
        </div>
        {live.length === 0 ? (
          <div data-settings-row="">
            <Empty>
              <EmptyMedia variant="icon">
                <RiRobot3Line />
              </EmptyMedia>
              <EmptyDescription>{t("No bots")}</EmptyDescription>
            </Empty>
          </div>
        ) : null}
        {live.map((bot) => (
          <CustomizeRow
            key={bot.id}
            logo={
              // An image fills the tile edge to edge; a blob keeps the 20px glyph size.
              <BotAvatarView
                avatar={bot.avatar}
                name={bot.name}
                className={bot.avatar.kind === "image" ? "size-full rounded-none" : "size-5"}
              />
            }
            name={bot.name}
            detail={bot.description ?? bot.title}
            onOpen={() => void navigate({ to: "/settings/bots/$botId", params: { botId: bot.id } })}
          />
        ))}
      </SettingsSection>
      {creatingOpen ? (
        <NewBotDialog
          open
          submitting={creating}
          onOpenChange={(next) => {
            if (!creating) setCreatingOpen(next);
          }}
          onCreate={(input) => void create(input)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
