import { BotId, type WorkParticipant } from "@otto/contracts";

import { cn } from "../../lib/utils";
import { ParticipantAvatar } from "../work/work-participants";
import { groupBotMembers, groupPersonMembers } from "./roster.logic";
import type { Bot, Group } from "./types";

/**
 * Otto: Each size scales the stack, its faces' initials and the ring that cuts the front face
 * out of the one behind it.
 */
const STACK_SIZES = {
  sm: { stack: "size-4", face: "text-7px ring-1" },
  md: { stack: "size-5", face: "text-8px ring-1" },
  lg: { stack: "size-16", face: "text-sm ring-2" },
} as const;

/**
 * Otto: A group's first two members on one diagonal, drawn as the same participant circles as
 * work assignees, so bots and people alike sit on a backing fill with their initials or face.
 */
export function GroupMemberStack({
  group,
  bots,
  size = "sm",
  ringClassName = "ring-background",
  className,
}: {
  readonly group: Group;
  readonly bots: ReadonlyArray<Bot>;
  readonly size?: keyof typeof STACK_SIZES;
  /** Colours the ring after the surface the stack sits on, such as `ring-sidebar`. */
  readonly ringClassName?: string;
  readonly className?: string;
}) {
  const groupBots = groupBotMembers(group, bots)
    .filter((bot) => bot.archivedAt === null)
    .sort((a, b) => {
      if (a.id === group.bossBotId) return -1;

      if (b.id === group.bossBotId) return 1;

      return 0;
    });

  const faces: WorkParticipant[] = [
    ...groupBots.map((bot) => ({ kind: "bot" as const, botId: BotId.make(bot.id) })),
    ...groupPersonMembers(group).map((person) => ({
      kind: "person" as const,
      personId: person.personId,
      displayName: person.displayName,
    })),
  ].slice(0, 2);

  return (
    <div className={cn("relative inline-flex shrink-0", STACK_SIZES[size].stack, className)}>
      {faces.map((face, index) => (
        <ParticipantAvatar
          key={face.kind === "bot" ? face.botId : face.personId}
          participant={face}
          bots={bots}
          className={cn(
            "absolute size-17/25",
            STACK_SIZES[size].face,
            ringClassName,
            index === 0 ? "left-0 top-0" : "bottom-0 right-0 z-10",
          )}
        />
      ))}
    </div>
  );
}
