import { RiArrowDownSLine } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import type { ReactNode } from "react";
import { Count, type Look } from "@/components/task-meta";

// A list's group, as Tasks and Schedules show them: a header row (secondary
// button: chevron, the group's icon, its name and count) that folds its
// rows. Header and rows share one column grid: both have a 1px border and
// 8px padding, the header chevron and the row spacer are 14px wide, and both
// use an 8px gap, so status icons and titles line up without offsets. The
// group reaches 9px out of the page column (its 1px border and 8px padding)
// so the chevron sits on the page title's line. Empty groups don't show.
export function ListGroup({
  look,
  count,
  defaultOpen = true,
  children,
}: {
  look: Look;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className="-mx-[9px]">
      {/* The whole header row toggles the group. */}
      <CollapsibleTrigger
        render={
          <Button
            variant="secondary"
            className="group/trigger w-full justify-start"
          />
        }
      >
        <RiArrowDownSLine className="-rotate-90 text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-0" />
        <look.icon className={look.className} />
        {look.label}
        <Count>{count}</Count>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col pt-1">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
