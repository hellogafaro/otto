import {
  type RemixiconComponentType,
  RiAddLine,
  RiSignpostLine,
} from "@remixicon/react";
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
import { FloatingChat, useAskAgent } from "@/components/floating-chat";
import { FloatingLayer } from "@/components/page";

// A page with nothing to show: no title or actions, just the empty state
// centered both ways, with one or two buttons and the floating chat.
// With `ask`, the main button starts it (AI-first:
// "New schedule" puts "Every " in the bar, it doesn't open a form).
export function EmptyPage({
  icon: Icon,
  title,
  description,
  ask,
  children,
}: {
  icon: RemixiconComponentType;
  title: string;
  description: string;
  ask?: {
    /** What the floating chat is about, e.g. "your schedules". */
    about: string;
    /** The main button, e.g. "New schedule". */
    action: string;
    /** How the sentence starts in the bar, e.g. "Every ". */
    start: string;
  };
  /** Other buttons (e.g. Upload file), after the main one. */
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col p-5 pb-22">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {ask && <AskButton action={ask.action} start={ask.start} />}
          {children}
        </EmptyContent>
      </Empty>
      <FloatingLayer>
        <FloatingChat about={ask?.about ?? "this page"} />
      </FloatingLayer>
    </div>
  );
}

function AskButton({ action, start }: { action: string; start: string }) {
  const askAgent = useAskAgent();
  return (
    <Button size="sm" onClick={() => askAgent(start)}>
      <RiAddLine data-icon="inline-start" />
      {action}
    </Button>
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
