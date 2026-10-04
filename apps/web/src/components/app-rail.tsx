import {
  type RemixiconComponentType,
  RiBookShelfFill,
  RiBookShelfLine,
  RiBox3Fill,
  RiBox3Line,
  RiChat3Fill,
  RiChat3Line,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
  RiFileTextFill,
  RiFileTextLine,
  RiHome5Fill,
  RiHome5Line,
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
    label: "Home",
    icon: RiHome5Line,
    activeIcon: RiHome5Fill,
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
    to: "/conversations",
    label: "Conversations",
    icon: RiChat3Line,
    activeIcon: RiChat3Fill,
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
    to: "/resources",
    label: "Resources",
    icon: RiBookShelfLine,
    activeIcon: RiBookShelfFill,
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
    // is 48px wide (the top bar is 48px tall) and its buttons sit 8px from
    // every edge.
    <nav
      aria-label="App navigation"
      className="sticky top-0 z-20 flex h-svh shrink-0 flex-col gap-1 bg-background p-2 select-none"
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
