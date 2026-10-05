import {
  type RemixiconComponentType,
  RiBox3Fill,
  RiBox3Line,
  RiChat1Fill,
  RiChat1Line,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
  RiFileTextFill,
  RiFileTextLine,
  RiFolder3Fill,
  RiFolder3Line,
  RiInboxFill,
  RiInboxLine,
  RiSearchLine,
  RiSettings3Fill,
  RiSettings3Line,
  RiTimeFill,
  RiTimeLine,
} from "@remixicon/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { ReactNode } from "react";

type Destination = {
  label: string;
  icon: RemixiconComponentType;
  activeIcon: RemixiconComponentType;
  /** Only Settings links for now; the rest are in place, not linked yet. */
  to?: "/settings";
};

const destinations: Destination[] = [
  { label: "Inbox", icon: RiInboxLine, activeIcon: RiInboxFill },
  { label: "Search", icon: RiSearchLine, activeIcon: RiSearchLine },
  { label: "Tasks", icon: RiCheckboxCircleLine, activeIcon: RiCheckboxCircleFill },
  { label: "Projects", icon: RiBox3Line, activeIcon: RiBox3Fill },
  { label: "Chats", icon: RiChat1Line, activeIcon: RiChat1Fill },
  { label: "Schedules", icon: RiTimeLine, activeIcon: RiTimeFill },
  { label: "Documents", icon: RiFileTextLine, activeIcon: RiFileTextFill },
  { label: "Files", icon: RiFolder3Line, activeIcon: RiFolder3Fill },
];

function RailButton({
  label,
  active,
  to,
  children,
}: {
  label: string;
  active: boolean;
  to?: "/settings";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            // A link when it has somewhere to go, a plain button otherwise.
            nativeButton={!to}
            render={to ? <Link to={to} /> : undefined}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// Bars share one rule: p-2 around 32px buttons spaced gap-1, so the rail is
// 48px wide. It sits on the frame; 12px on top puts its first button level
// with the card's top bar buttons (8px card margin + 4px padding).
export function AppRail() {
  const matchRoute = useMatchRoute();
  const settingsActive = Boolean(matchRoute({ to: "/settings", fuzzy: true }));
  const SettingsIcon = settingsActive ? RiSettings3Fill : RiSettings3Line;
  return (
    <nav
      aria-label="App navigation"
      className="flex shrink-0 flex-col gap-1 p-2 pt-3 select-none"
    >
      {destinations.map(({ label, icon: Icon }) => (
        <RailButton key={label} label={label} active={false}>
          <Icon />
        </RailButton>
      ))}
      <div className="mt-auto">
        <RailButton label="Settings" active={settingsActive} to="/settings">
          <SettingsIcon />
        </RailButton>
      </div>
    </nav>
  );
}
