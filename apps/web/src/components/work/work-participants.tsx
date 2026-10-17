import {
  type AuthSessionId,
  BotId,
  type WorkParticipant,
  workParticipantKey,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { RiUserLine } from "@remixicon/react";
import { Match } from "effect";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { BotAvatarView } from "../roster/bot-avatar-view";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerSelectControl,
} from "../chat/composer-control";
import { personImageAtom } from "../../state/people";
import { useRosterStore } from "../roster/roster-store";
import type { Bot } from "../roster/types";
import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Person = Extract<WorkParticipant, { kind: "person" }>;

/** Everyone work can go to: the people this workspace knows and its live bots. */
export function useWorkParticipants(
  snapshot: {
    readonly currentPersonId?: AuthSessionId | undefined;
    readonly currentPersonDisplayName?: string | undefined;
    readonly environmentHostPersonId?: AuthSessionId | undefined;
    readonly environmentHostDisplayName?: string | undefined;
    readonly people?:
      | ReadonlyArray<{ readonly personId: AuthSessionId; readonly displayName: string }>
      | undefined;
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

    for (const person of snapshot?.people ?? []) add(person.personId, person.displayName);

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

/**
 * Otto: A participant is always a perfect circle on a backing fill, its face clipped inside, so
 * image, blob and initials avatars line up in rows and stacks.
 */
export function ParticipantAvatar({
  participant,
  bots,
  className,
}: {
  readonly participant: WorkParticipant;
  readonly bots: readonly Bot[];
  readonly className?: string;
}) {
  const bot =
    participant.kind === "bot"
      ? bots.find((candidate) => candidate.id === participant.botId)
      : undefined;

  const image = useAtomValue(
    personImageAtom(participant.kind === "person" ? participant.personId : ""),
  );

  return (
    <span
      aria-hidden
      className={cn(
        "isolate flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-9px font-medium text-secondary-foreground",
        className,
      )}
    >
      {bot ? (
        <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-full" />
      ) : participant.kind === "person" && image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : participant.kind === "person" ? (
        initials(participant.displayName)
      ) : (
        "?"
      )}
    </span>
  );
}

/**
 * Overlapping avatars, the way Linear shows a few assignees in a narrow column. The first sits
 * on top, and each face is cut out of the surface behind it by a ring in that surface's colour.
 */
export function ParticipantStack({
  participants,
  bots,
  avatarClassName,
}: {
  readonly participants: readonly WorkParticipant[];
  readonly bots: readonly Bot[];
  /** Sizes the avatars and colours their ring after the surface, such as `size-4 ring-popover`. */
  readonly avatarClassName?: string;
}) {
  const shown = participants.slice(0, 3);
  const extra = participants.length - shown.length;

  return (
    <span className="flex items-center">
      <span className="sr-only">
        {participants.map((participant) => participantName(participant, bots)).join(", ")}
      </span>
      {/* Reversed in the DOM so later faces paint first and the first face lands on top. */}
      <span className="flex flex-row-reverse">
        {shown.toReversed().map((participant) => (
          <ParticipantAvatar
            key={workParticipantKey(participant)}
            participant={participant}
            bots={bots}
            className={cn("-ms-1 ring-2 ring-background last:ms-0", avatarClassName)}
          />
        ))}
      </span>
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

/** People and bots in one list by name: who does the work matters, not what they are. */
function participantsByName(participants: WorkParticipants): WorkParticipant[] {
  return [
    ...participants.people,
    ...participants.bots.map(
      (bot): WorkParticipant => ({ kind: "bot", botId: BotId.make(bot.id) }),
    ),
  ].toSorted((left, right) =>
    participantName(left, participants.allBots).localeCompare(
      participantName(right, participants.allBots),
    ),
  );
}

/** One owner, a person or a bot, or nobody. */
export function OwnerSelect({
  value,
  onChange,
  participants,
  variant,
}: {
  readonly value: WorkParticipant | null;
  readonly onChange: (owner: WorkParticipant | null) => void;
  readonly participants: WorkParticipants;
  /** `ghost` is the quiet property row on a task page; `composer` a composer control. */
  readonly variant?: "ghost" | "composer";
}) {
  const { t } = useI18n();
  const Trigger = variant === "composer" ? ComposerSelectControl : SelectTrigger;

  return (
    <Select
      value={value ? workParticipantKey(value) : "none"}
      onValueChange={(next: string | null) =>
        onChange(next === null || next === "none" ? null : parseParticipant(next, participants))
      }
    >
      <Trigger
        size="sm"
        variant={variant === "ghost" ? "ghost" : undefined}
        className="w-auto min-w-0"
        aria-label={t("Owner")}
      >
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
      </Trigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem hideIndicator value="none">
          {t("No owner")}
        </SelectItem>
        {participantsByName(participants).map((participant) => (
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
  variant = "outline",
  label,
}: {
  readonly value: readonly WorkParticipant[];
  readonly onChange: (assignees: WorkParticipant[]) => void;
  readonly participants: WorkParticipants;
  /**
   * `ghost` is the quiet property row on a task page; `composer` is a composer control that
   * names who is chosen, as New chat's members.
   */
  readonly variant?: "outline" | "ghost" | "composer";
  /** Names the menu in place of Assignees. */
  readonly label?: string;
}) {
  const { t } = useI18n();
  const selected = new Set(value.map(workParticipantKey));

  const toggle = (participant: WorkParticipant, checked: boolean) =>
    onChange(
      checked
        ? [...value, participant]
        : value.filter((entry) => workParticipantKey(entry) !== workParticipantKey(participant)),
    );

  const everyone = participantsByName(participants);
  const menuLabel = label ?? t("Assignees");

  return (
    <Menu>
      {Match.value(variant).pipe(
        Match.when("composer", () => (
          <MenuTrigger
            render={<ComposerControl aria-label={menuLabel} className="max-w-64 min-w-0" />}
          >
            {value.length > 0 ? (
              <ParticipantStack
                participants={value.slice(0, 3)}
                bots={participants.allBots}
                avatarClassName="size-4.5 ring-popover"
              />
            ) : (
              <RiUserLine aria-hidden />
            )}
            <span className="min-w-0 truncate">
              {value.length > 0
                ? value
                    .map((participant) => participantName(participant, participants.allBots))
                    .join(", ")
                : menuLabel}
            </span>
            <ComposerControlChevron />
          </MenuTrigger>
        )),
        Match.when("ghost", () => (
          <MenuTrigger
            render={
              <SelectButton
                size="sm"
                variant="ghost"
                className="w-auto min-w-0"
                aria-label={menuLabel}
              />
            }
          >
            <span className="flex items-center gap-1.5">
              {value.length > 0 ? (
                <ParticipantStack participants={value} bots={participants.allBots} />
              ) : (
                <RiUserLine aria-hidden className="size-3.5" />
              )}
              {value.length > 0 ? null : t("No assignees")}
            </span>
          </MenuTrigger>
        )),
        Match.orElse(() => (
          <MenuTrigger render={<Button size="sm" variant="outline" aria-label={menuLabel} />}>
            {value.length > 0 ? (
              <ParticipantStack participants={value} bots={participants.allBots} />
            ) : (
              <RiUserLine aria-hidden />
            )}
            {value.length > 0 ? null : menuLabel}
          </MenuTrigger>
        )),
      )}
      <MenuPopup align="start">
        {everyone.map((participant) => (
          <MenuCheckboxItem
            key={workParticipantKey(participant)}
            checked={selected.has(workParticipantKey(participant))}
            onCheckedChange={(checked) => toggle(participant, checked)}
          >
            <span className="flex items-center gap-2">
              <ParticipantAvatar
                participant={participant}
                bots={participants.allBots}
                className="size-4"
              />
              {participantName(participant, participants.allBots)}
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
