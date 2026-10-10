import {
  type RemixiconComponentType,
  RiBox3Fill,
  RiBox3Line,
  RiChat1Fill,
  RiChat1Line,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
  RiFolder3Fill,
  RiFolder3Line,
  RiInboxFill,
  RiInboxLine,
  RiTimeFill,
  RiTimeLine,
} from "@remixicon/react";

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
    to: "/library",
    label: "Library",
    icon: RiFolder3Line,
    activeIcon: RiFolder3Fill,
  },
];
