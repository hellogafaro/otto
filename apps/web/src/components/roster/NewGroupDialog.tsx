import type { MessageKey } from "@otto/client-runtime/i18n";
import { useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
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
import {
  GroupMemberChecklist,
  groupCandidates,
  type GroupPersonOption,
} from "./GroupMemberChecklist";
import type { Bot } from "./types";

export interface NewGroupInput {
  readonly name: string;
  readonly bossBotId: string;
  readonly specialistBotIds: readonly string[];
  readonly people: ReadonlyArray<GroupPersonOption>;
}

export function canCreateGroup(name: string, botIds: readonly string[]): boolean {
  return name.trim().length > 0 && new Set(botIds).size >= 1;
}

/** Hint shown under the member list until the group has a bot. */
export function groupSelectionHint(botIds: readonly string[]): MessageKey | null {
  return new Set(botIds).size >= 1 ? null : "Select at least one bot.";
}

const NO_PEOPLE: ReadonlyArray<GroupPersonOption> = [];

export function NewGroupDialog({
  open,
  bots,
  people = NO_PEOPLE,
  currentPersonId = null,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly bots: readonly Bot[];
  /** People in the organization; the creator is always in the group. */
  readonly people?: ReadonlyArray<GroupPersonOption>;
  readonly currentPersonId?: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: NewGroupInput) => void;
}) {
  const { t } = useI18n();
  const activeBots = useMemo(() => bots.filter((bot) => bot.archivedAt === null), [bots]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);

  const candidates = groupCandidates(
    activeBots,
    people.filter((person) => person.personId !== currentPersonId),
  );

  const chosen = candidates.filter((candidate) => selected.includes(candidate.key));

  const botIds = chosen.flatMap((candidate) =>
    candidate.kind === "bot" ? [candidate.bot.id] : [],
  );

  const selectionHint = groupSelectionHint(botIds);

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

            if (!canCreateGroup(name, botIds)) return;
            // Groups have no lead; the first bot is only stored as the group's boss.
            const [bossBotId = "", ...specialistBotIds] = botIds;

            onCreate({
              name: name.trim(),
              bossBotId,
              specialistBotIds,
              people: chosen.flatMap((candidate) =>
                candidate.kind === "person" ? [candidate.person] : [],
              ),
            });
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("New group")}</DialogTitle>
            <DialogDescription>
              {t("Choose who is in this group. Every bot hears every message.")}
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
              <legend className="mb-2 text-sm font-medium">{t("Members")}</legend>
              <GroupMemberChecklist
                candidates={candidates}
                selected={selected}
                onSelectedChange={setSelected}
              />
              <p className="text-xs text-muted-foreground">
                {selectionHint
                  ? t(selectionHint)
                  : t("You are in the group. Invite more people in Settings, Members.")}
              </p>
            </fieldset>
          </DialogPanel>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!canCreateGroup(name, botIds)}>
              {t("Create group")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
