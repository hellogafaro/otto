import type { RemixiconComponentType } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { Count } from "@/components/task-meta";

export type Tab<T extends string> = {
  value: T;
  label: string;
  icon?: RemixiconComponentType;
  /** Shown after the label only when there is something (no "0"). */
  count?: number;
};

// Tabs, one pattern everywhere (a project's sections, the command palette's
// categories): 32px buttons (28px compact) 4px apart, the open one filled (secondary), the
// rest ghost; an optional icon, and a count right after the label.
export function TabBar<T extends string>({
  label,
  tabs,
  value,
  onChange,
  size = "sm",
  className,
}: {
  /** What the tabs choose, for screen readers. */
  label: string;
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "compact";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex flex-wrap gap-1", className)}
    >
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === value}
          variant={tab.value === value ? "secondary" : "ghost"}
          size={size}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon && <tab.icon data-icon="inline-start" />}
          {tab.label}
          {!!tab.count && <Count>{tab.count}</Count>}
        </Button>
      ))}
    </div>
  );
}
