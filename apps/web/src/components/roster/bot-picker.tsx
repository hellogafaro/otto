import { useI18n } from "../../i18n";
import { ComposerControl, ComposerControlChevron } from "../chat/composer-control";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { BotAvatarView } from "./bot-avatar-view";
import type { Bot } from "./types";

/**
 * Otto: A composer control that picks one bot: the chosen bot's 16px avatar
 * and name with a chevron, opening a menu of every live bot.
 */
export function BotPicker({
  bots,
  value,
  onChange,
}: {
  readonly bots: ReadonlyArray<Bot>;
  readonly value: string | null;
  readonly onChange: (botId: string) => void;
}) {
  const { t } = useI18n();
  const chosen = bots.find((bot) => bot.id === value);

  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl aria-label={t("Choose bot")} className="max-w-52 min-w-0" />}
      >
        {chosen ? (
          <BotAvatarView avatar={chosen.avatar} name={chosen.name} className="size-4" />
        ) : null}
        <span className="min-w-0 truncate">{chosen?.name ?? t("Choose bot")}</span>
        <ComposerControlChevron />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
          {bots.map((bot) => (
            <MenuRadioItem key={bot.id} value={bot.id} closeOnClick>
              <span className="flex items-center gap-2">
                <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
                {bot.name}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
