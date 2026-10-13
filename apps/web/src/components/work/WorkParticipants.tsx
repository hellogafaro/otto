import {
  type AuthSessionId,
  BotId,
  type WorkParticipant,
  workParticipantKey,
} from "@otto/contracts";
import { RiUserLine } from "@remixicon/react";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { BotAvatarView } from "../roster/BotAvatarView";
import { useRosterStore } from "../roster/rosterStore";
import type { Bot } from "../roster/types";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type Person = Extract<WorkParticipant, { kind: "person" }>;

/** Everyone work can go to: the people this workspace knows and its live bots. */
export function useWorkParticipants(
  snapshot: {
    readonly currentPersonId?: AuthSessionId | undefined;
    readonly currentPersonDisplayName?: string | undefined;
    readonly environmentHostPersonId?: AuthSessionId | undefined;
    readonly environmentHostDisplayName?: string | undefined;
    readonly groups: ReadonlyArray<{
      readonly members: ReadonlyArray<
        | { readonly kind: "bot" }
        | {
            readonly kind: "person";
            readonly personId: AuthSessionId;
            readonly displayName: string;
          }
      >;
    }>;
  } | null,
) {
  const bots = useRosterStore((state) => state.bots);

  return useMemo(() => {
    const people = new Map<string, Person>();

    const add = (personId: AuthSessionId | undefined, displayName: string | undefined) => {
      if (personId && displayName && !people.has(personId)) {
        people.set(personId, { kind: "person", personId, displayName });
      }
    };

    add(snapshot?.currentPersonId, snapshot?.currentPersonDisplayName);
    add(snapshot?.environmentHostPersonId, snapshot?.environmentHostDisplayName);

    for (const group of snapshot?.groups ?? []) {
      for (const member of group.members) {
        if (member.kind === "person") add(member.personId, member.displayName);
      }
    }

    return {
      people: [...people.values()],
      bots: bots.filter((bot) => bot.archivedAt === null),
      allBots: bots,
    };
  }, [bots, snapshot]);
}

export type WorkParticipants = ReturnType<typeof useWorkParticipants>;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function participantName(participant: WorkParticipant, bots: readonly Bot[]): string {
  if (participant.kind === "person") return participant.displayName;

  return bots.find((bot) => bot.id === participant.botId)?.name ?? participant.botId;
}

export function ParticipantAvatar({
  participant,
  bots,
  className,
}: {
  readonly participant: WorkParticipant;
  readonly bots: readonly Bot[];
  readonly className?: string;
}) {
  if (participant.kind === "bot") {
    const bot = bots.find((candidate) => candidate.id === participant.botId);

    if (bot)
      return (
        <BotAvatarView avatar={bot.avatar} name={bot.name} className={cn("size-5", className)} />
      );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-9px font-medium text-secondary-foreground",
        className,
      )}
    >
      {participant.kind === "person" ? initials(participant.displayName) : "?"}
    </span>
  );
}

/** Overlapping avatars, the way Linear shows a few assignees in a narrow column. */
export function ParticipantStack({
  participants,
  bots,
}: {
  readonly participants: readonly WorkParticipant[];
  readonly bots: readonly Bot[];
}) {
  const shown = participants.slice(0, 3);
  const extra = participants.length - shown.length;

  return (
    <span className="flex items-center">
      <span className="sr-only">
        {participants.map((participant) => participantName(participant, bots)).join(", ")}
      </span>
      {shown.map((participant) => (
        <ParticipantAvatar
          key={workParticipantKey(participant)}
          participant={participant}
          bots={bots}
          className="-ms-1 rounded-full ring-2 ring-background first:ms-0"
        />
      ))}
      {extra > 0 ? <span className="ms-1 text-xs text-muted-foreground">+{extra}</span> : null}
    </span>
  );
}

function parseParticipant(value: string, participants: WorkParticipants): WorkParticipant | null {
  const [kind, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];

  if (kind === "bot") {
    const bot = participants.bots.find((candidate) => candidate.id === id);

    return bot ? { kind: "bot", botId: BotId.make(bot.id) } : null;
  }

  return participants.people.find((person) => person.personId === id) ?? null;
}

/** One owner, a person or a bot, or nobody. */
export function OwnerSelect({
  value,
  onChange,
  participants,
}: {
  readonly value: WorkParticipant | null;
  readonly onChange: (owner: WorkParticipant | null) => void;
  readonly participants: WorkParticipants;
}) {
  const { t } = useI18n();

  return (
    <Select
      value={value ? workParticipantKey(value) : "none"}
      onValueChange={(next: string | null) =>
        onChange(next === null || next === "none" ? null : parseParticipant(next, participants))
      }
    >
      <SelectTrigger size="sm" className="w-auto min-w-0" aria-label={t("Owner")}>
        <SelectValue>
          <span className="flex items-center gap-1.5">
            {value ? (
              <ParticipantAvatar
                participant={value}
                bots={participants.allBots}
                className="size-4"
              />
            ) : (
              <RiUserLine aria-hidden className="size-3.5" />
            )}
            {value ? participantName(value, participants.allBots) : t("No owner")}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem hideIndicator value="none">
          {t("No owner")}
        </SelectItem>
        {[
          ...participants.people,
          ...participants.bots.map((bot) => ({ kind: "bot" as const, botId: BotId.make(bot.id) })),
        ].map((participant) => (
          <SelectItem
            key={workParticipantKey(participant)}
            hideIndicator
            value={workParticipantKey(participant)}
          >
            <span className="flex items-center gap-2">
              <ParticipantAvatar
                participant={participant}
                bots={participants.allBots}
                className="size-4"
              />
              {participantName(participant, participants.allBots)}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Any number of people and bots, toggled from one menu. */
export function AssigneesMenu({
  value,
  onChange,
  participants,
}: {
  readonly value: readonly WorkParticipant[];
  readonly onChange: (assignees: WorkParticipant[]) => void;
  readonly participants: WorkParticipants;
}) {
  const { t } = useI18n();
  const selected = new Set(value.map(workParticipantKey));

  const toggle = (participant: WorkParticipant, checked: boolean) =>
    onChange(
      checked
        ? [...value, participant]
        : value.filter((entry) => workParticipantKey(entry) !== workParticipantKey(participant)),
    );

  const bots = participants.bots.map(
    (bot): WorkParticipant => ({ kind: "bot", botId: BotId.make(bot.id) }),
  );

  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" aria-label={t("Assignees")} />}>
        {value.length > 0 ? (
          <ParticipantStack participants={value} bots={participants.allBots} />
        ) : (
          <RiUserLine aria-hidden />
        )}
        {value.length > 0 ? null : t("Assignees")}
      </MenuTrigger>
      <MenuPopup align="start">
        {participants.people.length > 0 ? (
          <MenuGroup>
            <MenuGroupLabel>{t("People")}</MenuGroupLabel>
            {participants.people.map((person) => (
              <MenuCheckboxItem
                key={workParticipantKey(person)}
                checked={selected.has(workParticipantKey(person))}
                onCheckedChange={(checked) => toggle(person, checked)}
              >
                <span className="flex items-center gap-2">
                  <ParticipantAvatar
                    participant={person}
                    bots={participants.allBots}
                    className="size-4"
                  />
                  {person.displayName}
                </span>
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
        ) : null}
        {bots.length > 0 ? (
          <MenuGroup>
            <MenuGroupLabel>{t("Bots")}</MenuGroupLabel>
            {bots.map((bot) => (
              <MenuCheckboxItem
                key={workParticipantKey(bot)}
                checked={selected.has(workParticipantKey(bot))}
                onCheckedChange={(checked) => toggle(bot, checked)}
              >
                <span className="flex items-center gap-2">
                  <ParticipantAvatar
                    participant={bot}
                    bots={participants.allBots}
                    className="size-4"
                  />
                  {participantName(bot, participants.allBots)}
                </span>
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
