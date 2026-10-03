import { type RemixiconComponentType, RiSignpostLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import type { ReactNode } from "react";

// A page with nothing to show: no title or actions, just the empty state
// centered both ways, with one or two buttons.
export function EmptyPage({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: RemixiconComponentType;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-5">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{children}</EmptyContent>
      </Empty>
    </div>
  );
}

// Missing pages and records, with a way home.
export function NotFound({
  icon = RiSignpostLine,
  title = "Page not found",
  description = "The link may be broken, or the page was moved or deleted.",
}: {
  icon?: RemixiconComponentType;
  title?: string;
  description?: string;
}) {
  return (
    <EmptyPage icon={icon} title={title} description={description}>
      <Button size="sm" nativeButton={false} render={<Link to="/" />}>
        Go home
      </Button>
    </EmptyPage>
  );
}
