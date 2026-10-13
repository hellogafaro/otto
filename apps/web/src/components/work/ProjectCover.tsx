import { cn } from "../../lib/utils";
import { BLOB_BODY_PATHS } from "../roster/BotAvatarView";
import { projectCover } from "./work.logic";

/**
 * A generated 16:9 cover: a tinted field with a dot grid and one large blob
 * from the bot avatar set, all picked from the project id.
 */
export function ProjectCover({
  seed,
  className,
}: {
  readonly seed: string;
  readonly className?: string;
}) {
  const cover = projectCover(seed);
  const patternId = `project-cover-dots-${seed}`;

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className={cn("block aspect-video w-full text-(--cover-color)", className)}
      style={{ "--cover-color": cover.color }}
    >
      <rect width="320" height="180" className="fill-card" />
      <rect width="320" height="180" fill="currentColor" fillOpacity="0.14" />
      <defs>
        <pattern id={patternId} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="currentColor" fillOpacity="0.28" />
        </pattern>
      </defs>
      <rect width="320" height="180" fill={`url(#${patternId})`} />
      <g transform={`translate(176 44) scale(1.5) rotate(${cover.rotate} 50 50)`}>
        <path d={BLOB_BODY_PATHS[cover.shape]} fill="currentColor" fillOpacity="0.88" />
      </g>
    </svg>
  );
}
