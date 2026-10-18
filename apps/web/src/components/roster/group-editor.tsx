import { RiDeleteBinLine, RiLogoutBoxRLine, RiPencilLine, RiUserAddLine } from "@remixicon/react";
import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { AuthSessionId, BotId, GroupId, type EnvironmentId } from "@otto/contracts";

import { useEffect, useState, type ReactNode } from "react";

import { canManageChannels } from "../../channel-access";
import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { DetailsGroup } from "../details-aside";
import { botEnvironment, environmentPeopleAtom } from "../../state/bots";
import { useEnvironmentSessionState } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { toast } from "sonner";
import { BotAvatarView } from "./bot-avatar-view";
import {
  type GroupCandidate,
  GroupMemberChecklist,
  groupCandidates,
} from "./group-member-checklist";
import { GroupMemberStack } from "./group-member-stack";
import { PersonAvatar } from "./person-avatar";
import { groupBotMembers, groupContainsBot, groupPersonMembers } from "./roster.logic";
import { useRosterStore } from "./roster-store";
import type { Bot, Group } from "./types";

/**
 * Otto: The people and bots not yet in a group, and the call that adds one. The details panel's
 * Add members and the composer's /invite both use it; any member may add.
 */
export function useGroupInvites(
  environmentId: EnvironmentId,
  group: Group | undefined,
  bots: readonly Bot[],
) {
  const { t } = useI18n();

  const assignMember = useAtomCommand(botEnvironment.groups.assignMember, {
    reportFailure: false,
  });

  const assignPerson = useAtomCommand(botEnvironment.groups.assignPerson, {
    reportFailure: false,
  });

  const directory = useAtomValue(environmentPeopleAtom(environmentId)).directory;
  const people = group ? groupPersonMembers(group) : [];

  const addable = group
    ? groupCandidates(
        bots.filter((bot) => bot.archivedAt === null && !groupContainsBot(group, bot.id)),
        directory.filter((person) => !people.some((member) => member.personId === person.personId)),
      )
    : [];

  const add = async (candidate: GroupCandidate) => {
    if (!group) return false;
    const groupId = GroupId.make(group.id);

    const result = await (candidate.kind === "bot"
      ? assignMember({
          environmentId,
          input: { groupId, botId: BotId.make(candidate.bot.id), role: "specialist" },
        })
      : assignPerson({
          environmentId,
          input: {
            groupId,
            person: {
              kind: "person",
              personId: AuthSessionId.make(candidate.person.personId),
              displayName: candidate.person.displayName,
            },
          },
        }));

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(t("{name} couldn't be added", { name: candidate.name }));

      return false;
    }

    return true;
  };

  return { addable, add };
}

export function GroupEditor({
  environmentId,
  group,
  bots,
  onDeleted,
  children,
  trailing,
}: {
  readonly environmentId: EnvironmentId;
  readonly group: Group;
  readonly bots: readonly Bot[];
  readonly onDeleted: () => void;
  /** Otto: the open chat's own details, shown above the members. */
  readonly children?: ReactNode;
  /** Otto: chat sections shown below the members; each brings its own spacing. */
  readonly trailing?: ReactNode;
}) {
  const { t, plural } = useI18n();

  const renameGroup = useAtomCommand(botEnvironment.groups.rename, {
    reportFailure: false,
  });

  const deleteGroup = useAtomCommand(botEnvironment.groups.delete, {
    reportFailure: false,
  });

  const unassignMember = useAtomCommand(botEnvironment.groups.unassignMember, {
    reportFailure: false,
  });

  const setBoss = useAtomCommand(botEnvironment.groups.setBoss, {
    reportFailure: false,
  });

  const unassignPerson = useAtomCommand(botEnvironment.groups.unassignPerson, {
    reportFailure: false,
  });

  const leaveGroup = useAtomCommand(botEnvironment.groups.leave, { reportFailure: false });
  const peopleIdentity = useAtomValue(environmentPeopleAtom(environmentId));
  const session = useEnvironmentSessionState(environmentId);
  const currentPersonId = peopleIdentity.current?.id;
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<ReadonlyArray<string>>([]);
  const activeBots = bots.filter((bot) => bot.archivedAt === null);
  const groupBots = groupBotMembers(group, activeBots);
  const people = groupPersonMembers(group);
  const members = groupCandidates(groupBots, people);

  const canRemovePeople =
    people[0]?.personId === currentPersonId || canManageChannels(session.data);

  const { addable, add } = useGroupInvites(environmentId, group, bots);

  useEffect(() => setName(group.name), [group.name]);

  const addMembersRequest = useRosterStore((state) => state.addMembersRequest);

  // The details panel can hold two editors at once (the docked panel and the sheet), so the
  // first to see the request takes it and the other leaves it.
  useEffect(() => {
    if (useRosterStore.getState().addMembersRequest !== group.id) return;
    useRosterStore.getState().requestAddMembers(null);
    setToAdd([]);
    setAdding(true);
  }, [addMembersRequest, group.id]);

  const run = async (action: () => Promise<{ readonly _tag: string }>, failure: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(failure);

      return false;
    }

    return true;
  };

  const groupId = GroupId.make(group.id);

  const addMembers = async () => {
    setBusy(true);

    for (const candidate of addable.filter(({ key }) => toAdd.includes(key))) {
      await add(candidate);
    }

    setBusy(false);
    setAdding(false);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <div className="flex flex-col items-start gap-1 pb-6 pt-2">
        <GroupMemberStack group={group} bots={bots} size="lg" className="mb-2" />
        <h2 className="max-w-full truncate text-base font-medium">{group.name}</h2>
        <span className="text-sm text-muted-foreground">
          {plural(members.length, { one: "{count} member", other: "{count} members" })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={busy}
          size="sm"
          variant="outline"
          onClick={() => {
            setName(group.name);
            setRenaming(true);
          }}
        >
          <RiPencilLine />
          {t("Rename")}
        </Button>
        <Button
          disabled={busy}
          size="sm"
          variant="outline"
          onClick={() => {
            setToAdd([]);
            setAdding(true);
          }}
        >
          <RiUserAddLine />
          {t("Add members")}
        </Button>
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
      <div className="mt-6">
        <DetailsGroup id="group-members" label={t("Members")}>
          {members.map((member) => {
            if (member.kind === "bot") {
              // Groups have no lead in the product. The stored boss only moves to
              // another member when it leaves, so removal works for every bot; the
              // last bot leaving makes the group people only.
              const nextBoss =
                member.bot.id === group.bossBotId
                  ? groupBots.find((other) => other.id !== member.bot.id)
                  : null;

              return (
                <div key={member.key} className="flex min-h-9 items-center gap-2">
                  <BotAvatarView avatar={member.bot.avatar} name={member.name} className="size-6" />
                  <span className="min-w-0 flex-1 truncate text-sm">{member.name}</span>
                  <Button
                    aria-label={t("Remove {name} from {group}", {
                      name: member.name,
                      group: group.name,
                    })}
                    disabled={busy}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      void run(
                        () =>
                          nextBoss
                            ? setBoss({
                                environmentId,
                                input: {
                                  groupId,
                                  bossBotId: BotId.make(nextBoss.id),
                                  unassignPreviousBoss: true,
                                },
                              })
                            : unassignMember({
                                environmentId,
                                input: { groupId, botId: BotId.make(member.bot.id) },
                              }),
                        t("{name} couldn't be removed", { name: member.name }),
                      )
                    }
                  >
                    <RiDeleteBinLine />
                  </Button>
                </div>
              );
            }

            const current = member.person.personId === currentPersonId;
            const canAct = current ? people.length > 1 : canRemovePeople;

            return (
              <div key={member.key} className="flex min-h-9 items-center gap-2">
                <PersonAvatar
                  name={member.name}
                  personId={member.person.personId}
                  className="size-6"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{member.name}</span>
                {canAct ? (
                  <Button
                    aria-label={
                      current
                        ? t("Leave {group}", { group: group.name })
                        : t("Remove {name} from {group}", { name: member.name, group: group.name })
                    }
                    disabled={busy}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      void run(
                        () =>
                          (current ? leaveGroup : unassignPerson)({
                            environmentId,
                            input: {
                              groupId,
                              personId: AuthSessionId.make(member.person.personId),
                            },
                          }),
                        current
                          ? t("Group couldn't be left")
                          : t("{name} couldn't be removed", { name: member.name }),
                      ).then((success) => success && current && onDeleted())
                    }
                  >
                    {current ? <RiLogoutBoxRLine /> : <RiDeleteBinLine />}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </DetailsGroup>
      </div>
      {trailing}
      <Button
        className="mt-6 w-full"
        disabled={busy}
        variant="destructive-outline"
        onClick={async () => {
          const confirmed = await ensureLocalApi().dialogs.confirm(
            t('Delete "{name}"? Its bots stay in your roster.', { name: group.name }),
            { variant: "destructive", confirmLabel: t("Delete group") },
          );

          if (!confirmed) return;

          const success = await run(
            () => deleteGroup({ environmentId, input: { groupId } }),
            t("Group couldn't be deleted"),
          );

          if (success) onDeleted();
        }}
      >
        {t("Delete group")}
      </Button>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              const nextName = name.trim();

              if (!nextName) return;
              setRenaming(false);

              if (nextName !== group.name) {
                void run(
                  () => renameGroup({ environmentId, input: { groupId, name: nextName } }),
                  t("Group couldn't be renamed"),
                );
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Rename group")}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <Input
                autoFocus
                aria-label={t("Group name")}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={name.trim().length === 0}>
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogPopup
          className="flex max-h-(--spacing-dvh-2rem) max-w-md flex-col overflow-hidden"
          bottomStickOnMobile={false}
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();

              if (toAdd.length > 0) void addMembers();
            }}
          >
            <DialogHeader className="shrink-0">
              <DialogTitle>{t("Add members")}</DialogTitle>
              <DialogDescription>
                {t("Every bot hears every message. Invite more people in Settings, Members.")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {addable.length > 0 ? (
                <GroupMemberChecklist
                  candidates={addable}
                  selected={toAdd}
                  onSelectedChange={setToAdd}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("Everyone is already in this group.")}
                </p>
              )}
            </DialogPanel>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={busy || toAdd.length === 0}>
                {t("Add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
