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
  RiTimeFill,
  RiTimeLine,
} from "@remixicon/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useSidebar } from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { ReactElement, ReactNode } from "react";
import { ProfileMenu } from "@/components/profile-menu";

type Destination = {
  to: string;
  label: string;
  icon: RemixiconComponentType;
  activeIcon: RemixiconComponentType;
};

export const destinations: Destination[] = [
  {
    to: "/",
    label: "Inbox",
    icon: RiInboxLine,
    activeIcon: RiInboxFill,
  },
  {
    to: "/tasks",
    label: "Tasks",
    icon: RiCheckboxCircleLine,
    activeIcon: RiCheckboxCircleFill,
  },
  {
    to: "/projects",
    label: "Projects",
    icon: RiBox3Line,
    activeIcon: RiBox3Fill,
  },
  {
    to: "/chats",
    label: "Chats",
    icon: RiChat1Line,
    activeIcon: RiChat1Fill,
  },
  {
    to: "/schedules",
    label: "Schedules",
    icon: RiTimeLine,
    activeIcon: RiTimeFill,
  },
  {
    to: "/documents",
    label: "Documents",
    icon: RiFileTextLine,
    activeIcon: RiFileTextFill,
  },
  {
    to: "/files",
    label: "Files",
    icon: RiFolder3Line,
    activeIcon: RiFolder3Fill,
  },
];

function RailItem({
  label,
  active,
  render,
  children,
}: {
  label: string;
  active: boolean;
  render: ReactElement;
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
            // Renders a link, not a native <button>.
            nativeButton={false}
            render={render}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppRail() {
  const matchRoute = useMatchRoute();
  const { setOpen } = useSidebar();

  return (
    // Bars share one rule: p-2 around 32px buttons spaced gap-1, so the rail
    // is 48px wide. It sits on the frame; 12px on top puts its first button
    // level with the card's top bar buttons (8px card margin + 4px padding;
    // 4px under the desktop strip, where the card has no margin).
    <nav
      aria-label="App navigation"
      className="flex shrink-0 flex-col gap-1 p-2 pt-3 select-none group-data-desktop/sidebar-wrapper:pt-1"
    >
      {destinations.map(({ to, label, icon, activeIcon }) => {
        const active = Boolean(matchRoute({ to, fuzzy: to !== "/" }));
        const Icon = active ? activeIcon : icon;
        return (
          <RailItem
            key={to}
            label={label}
            active={active}
            render={<Link to={to} onClick={() => setOpen(true)} />}
          >
            <Icon />
          </RailItem>
        );
      })}

      <div className="mt-auto">
        <ProfileMenu />
      </div>
    </nav>
  );
}
