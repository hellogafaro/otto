import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

// One row of a plain list in a card (the floating chat's chats that need
// you): 32px, like a sidebar row. What leads or ends it sits in a 20px slot
// 6px in (5px + the 1px border), as far from the side as from the top: its
// icon or avatar, then one thing at the end (a status, else a time).
export function ListRow({
  media,
  title,
  end,
  onClick,
}: {
  media: ReactNode;
  title: string;
  end?: ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-1.25 font-normal text-foreground"
        onClick={onClick}
      >
        <Slot>{media}</Slot>
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {end && <Slot className="text-xs text-muted-foreground">{end}</Slot>}
      </Button>
    </li>
  );
}

function Slot({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-5 min-w-5 shrink-0 items-center justify-center",
        className,
      )}
    >
      {children}
    </span>
  );
}
