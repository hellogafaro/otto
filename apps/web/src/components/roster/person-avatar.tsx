import { useAtomValue } from "@effect/atom-react";

import { cn } from "../../lib/utils";
import { personImageAtom } from "../../state/people";

/** The initials of a person's name, for people in group chats. */
export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words.slice(0, 1);

  return letters.map((word) => word.charAt(0).toUpperCase()).join("") || "?";
}

/**
 * A person's photo, or their initials without one; `initials={false}` leaves a plain face where
 * text would not fit. A `personId` finds their photo; an explicit `image` replaces that lookup.
 */
export function PersonAvatar({
  name,
  personId,
  image,
  className,
  initials = true,
}: {
  name: string;
  personId?: string | null | undefined;
  image?: string | null | undefined;
  className?: string;
  initials?: boolean;
}) {
  const knownImage = useAtomValue(personImageAtom(personId ?? ""));
  const photo = image === undefined ? knownImage : image;

  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        aria-hidden="true"
        className={cn("shrink-0 select-none rounded-full bg-muted object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted text-xs font-medium leading-none text-muted-foreground",
        className,
      )}
    >
      {initials ? personInitials(name) : null}
    </span>
  );
}
