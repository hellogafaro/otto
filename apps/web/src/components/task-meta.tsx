import {
  type RemixiconComponentType,
  RiArtboardLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiFileLine,
  RiFileTextLine,
  RiImageLine,
  RiLockLine,
  RiMusic2Line,
  RiProgress4Line,
  RiTeamLine,
  RiUserLine,
  RiVideoLine,
} from "@remixicon/react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@workspace/ui/components/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { type ComponentType, type ReactNode, useEffect } from "react";
import { MascotIcon } from "@/components/mascot";
import { useDirectory } from "@/lib/directory";

export type Look = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  className?: string;
};
export const statuses: Record<"todo" | "doing" | "done", Look> = {
  todo: { label: "Todo", icon: RiCircleLine, className: "text-status-todo" },
  doing: {
    label: "In progress",
    icon: RiProgress4Line,
    className: "text-status-doing",
  },
  done: {
    label: "Done",
    icon: RiCheckboxCircleFill,
    className: "text-status-done",
  },
};
export type FileKind =
  | "video"
  | "audio"
  | "image"
  | "document"
  | "canvas"
  | "file";

export function ActorAvatar({
  actorId,
  size = "sm",
}: {
  actorId: string;
  size?: "sm" | "md" | "default";
}) {
  const directory = useDirectory();
  const actor = actorId === "none" ? null : directory.actorOf(actorId);
  const found =
    directory.members.some((item) => item.userId === actorId) ||
    directory.agents.some((item) => item.id === actorId);
  const { membersQuery, agentsQuery } = directory;
  useEffect(() => {
    if (found || actorId === "none") return;
    if (
      membersQuery.hasNextPage &&
      !membersQuery.isFetchingNextPage &&
      !membersQuery.error
    )
      void membersQuery.fetchNextPage();
    if (
      agentsQuery.hasNextPage &&
      !agentsQuery.isFetchingNextPage &&
      !agentsQuery.error
    )
      void agentsQuery.fetchNextPage();
  }, [actorId, found, membersQuery, agentsQuery]);
  return (
    <Avatar size={size}>
      <AvatarFallback>
        {!actor ? (
          <RiUserLine />
        ) : actor.agent ? (
          <MascotIcon mascot="robot" className={nameColors[actor.color]} />
        ) : (
          actor.initials
        )}
      </AvatarFallback>
    </Avatar>
  );
}
export function People({ ids }: { ids: string[] }) {
  const { actorOf } = useDirectory();
  const names = ids.map((id) => actorOf(id).name).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger render={<AvatarGroup />} aria-label={names}>
        {ids.map((id) => (
          <ActorAvatar key={id} actorId={id} />
        ))}
      </TooltipTrigger>
      <TooltipContent>{names}</TooltipContent>
    </Tooltip>
  );
}

export const nameColors = [
  "text-[oklch(0.55_0.18_25)] dark:text-[oklch(0.74_0.14_25)]", // red
  "text-[oklch(0.58_0.15_60)] dark:text-[oklch(0.78_0.13_65)]", // orange
  "text-[oklch(0.52_0.14_150)] dark:text-[oklch(0.77_0.14_150)]", // green
  "text-[oklch(0.53_0.1_195)] dark:text-[oklch(0.77_0.1_195)]", // teal
  "text-[oklch(0.52_0.18_300)] dark:text-[oklch(0.75_0.14_300)]", // purple
  "text-[oklch(0.56_0.19_350)] dark:text-[oklch(0.75_0.15_350)]", // pink
];

export const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

// Time tracking: whole minutes shown as "2h", "45m" or "1h 30m".
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  return hours ? `${hours}h` : `${rest}m`;
}

// A resource's type: its icon in lists, its name in hover details.
export const resourceIcons: Record<FileKind, RemixiconComponentType> = {
  video: RiVideoLine,
  audio: RiMusic2Line,
  image: RiImageLine,
  document: RiFileTextLine,
  canvas: RiArtboardLine,
  file: RiFileLine,
};

// A file's type from its MIME type.
export function resourceKindOf(type: string): FileKind {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type === "text/html") return "canvas";
  if (type.startsWith("text/") || type === "application/pdf") return "document";
  return "file";
}

export const resourceTypes: Record<FileKind, string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  document: "Document",
  canvas: "Canvas",
  file: "File",
};

// Who can see a document: only its creator, or the whole workspace.
export const visibilityLooks: Record<"user" | "workspace", Look> = {
  user: { label: "Only me", icon: RiLockLine },
  workspace: { label: "Workspace", icon: RiTeamLine },
};

// A count right after its label, softer than it, like "Pinned 2". It takes the
// parent's gap, the same as icon to label, so the spacing stays proportional.
export function Count({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground/70 tabular-nums">{children}</span>
  );
}
