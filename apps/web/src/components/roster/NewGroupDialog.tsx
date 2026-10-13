import type { MessageKey } from "@otto/client-runtime/i18n";
import { useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { BotAvatarView } from "./BotAvatarView";
import type { Bot } from "./types";

export interface NewGroupInput {
  readonly name: string;
  readonly bossBotId: string;
  readonly specialistBotIds: readonly string[];
}

export function canCreateGroup(name: string, selectedIds: readonly string[]): boolean {
  return name.trim().length > 0 && new Set(selectedIds).size >= 2;
}

/** Hint shown under the bot list until the group has enough members. */
export function groupSelectionHint(selectedIds: readonly string[]): MessageKey | null {
  return new Set(selectedIds).size >= 2 ? null : "Select at least two bots.";
}

export function NewGroupDialog({
  open,
  bots,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly bots: readonly Bot[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: NewGroupInput) => void;
}) {
  const { t } = useI18n();
  const activeBots = useMemo(() => bots.filter((bot) => bot.archivedAt === null), [bots]);
  const [name, setName] = useState("");

  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    activeBots.slice(0, 2).map((bot) => bot.id),
  );

  const selectionHint = groupSelectionHint(selectedIds);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="flex max-h-(--spacing-dvh-2rem) max-w-lg flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();

            if (!canCreateGroup(name, selectedIds)) return;
            // Groups have no lead; the first bot is only stored as the group's boss.
            const [bossBotId = "", ...specialistBotIds] = [...new Set(selectedIds)];
            onCreate({ name: name.trim(), bossBotId, specialistBotIds });
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("New group")}</DialogTitle>
            <DialogDescription>
              {t("Choose the bots in this group. They all hear every message.")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            <label className="block space-y-2 text-sm font-medium">
              {t("Name")}
              <Input
                autoFocus
                aria-label={t("Group name")}
                maxLength={80}
                placeholder={t("Group name")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{t("Bots")}</legend>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                {activeBots.map((bot) => {
                  const checked = selectedIds.includes(bot.id);

                  return (
                    <label
                      key={bot.id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setSelectedIds((current) =>
                            next
                              ? [...current, bot.id]
                              : current.filter((candidate) => candidate !== bot.id),
                          )
                        }
                      />
                      <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-7" />
                      <span className="min-w-0 flex-1 truncate text-sm">{bot.name}</span>
                    </label>
                  );
                })}
              </div>
              {selectionHint ? (
                <p className="text-xs text-muted-foreground">{t(selectionHint)}</p>
              ) : null}
            </fieldset>
          </DialogPanel>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!canCreateGroup(name, selectedIds)}>
              {t("Create group")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
