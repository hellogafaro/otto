import { cn } from "../../lib/utils";
import { BotAvatarView } from "./BotAvatarView";
import { PersonAvatar } from "./PersonAvatar";
import { groupBotMembers, groupPersonMembers } from "./roster.logic";
import type { Bot, Group } from "./types";

export function GroupMemberStack({
  group,
  bots,
  sizeClassName = "size-6",
  className,
  initials = false,
}: {
  readonly group: Group;
  readonly bots: ReadonlyArray<Bot>;
  readonly sizeClassName?: string;
  readonly className?: string;
  /** Show people's initials; only the large sidebar stack has room for them. */
  readonly initials?: boolean;
}) {
  const groupBots = groupBotMembers(group, bots)
    .filter((bot) => bot.archivedAt === null)
    .sort((a, b) => {
      if (a.id === group.bossBotId) return -1;

      if (b.id === group.bossBotId) return 1;

      return 0;
    });

  const faces = [
    ...groupBots.map((bot) => ({ kind: "bot" as const, key: bot.id, bot })),
    ...groupPersonMembers(group).map((person) => ({
      kind: "person" as const,
      key: person.personId,
      name: person.displayName,
    })),
  ].slice(0, 2);

  return (
    <div className={cn("relative inline-flex shrink-0", sizeClassName, className)}>
      {faces.map((face, index) => {
        const position = cn(
          "absolute size-17/25",
          index === 0 ? "left-0 top-0" : "bottom-0 right-0 z-10",
        );

        return face.kind === "bot" ? (
          <BotAvatarView
            key={face.key}
            avatar={face.bot.avatar}
            name={face.bot.name}
            className={position}
          />
        ) : (
          <PersonAvatar key={face.key} name={face.name} className={position} initials={initials} />
        );
      })}
    </div>
  );
}
