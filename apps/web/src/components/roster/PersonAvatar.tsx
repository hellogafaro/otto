import { cn } from "../../lib/utils";

/** The initials of a person's name, for people in group chats. */
export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words.slice(0, 1);

  return letters.map((word) => word.charAt(0).toUpperCase()).join("") || "?";
}

/** A person's initials avatar; `initials={false}` leaves a plain face where text would not fit. */
export function PersonAvatar({
  name,
  className,
  initials = true,
}: {
  name: string;
  className?: string;
  initials?: boolean;
}) {
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
