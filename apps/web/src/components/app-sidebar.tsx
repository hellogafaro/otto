import {
  type RemixiconComponentType,
  RiAddLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiBookOpenLine,
  RiBox3Line,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiEditBoxLine,
  RiFileTextLine,
  RiGlobalLine,
  RiHashtag,
  RiImageLine,
  RiMoreFill,
  RiSearchLine,
  RiSparklingLine,
  RiUserLine,
} from "@remixicon/react";
import { useMatchRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { destinations } from "@/components/app-rail";

type Item = { title: string; icon?: RemixiconComponentType };
type Section = {
  title: string;
  create: Item;
  nav?: Item[];
  groups: { title: string; items: Item[] }[];
  footer?: Item;
};

// Static mock content per rail destination; not wired to data.
const sections: Record<string, Section> = {
  "/": {
    title: "Home",
    create: { title: "New task", icon: RiEditBoxLine },
    nav: [
      { title: "My tasks", icon: RiCheckboxCircleLine },
      { title: "Needs me", icon: RiUserLine },
    ],
    groups: [
      {
        title: "Projects",
        items: [
          { title: "Otto web", icon: RiBox3Line },
          { title: "Launch site", icon: RiBox3Line },
          { title: "Onboarding", icon: RiBox3Line },
        ],
      },
    ],
  },
  "/conversations": {
    title: "Conversations",
    create: { title: "New conversation", icon: RiEditBoxLine },
    groups: [
      {
        title: "Channels",
        items: [
          { title: "general", icon: RiHashtag },
          { title: "launch", icon: RiHashtag },
        ],
      },
      {
        title: "Recents",
        items: [
          { title: "Fix sign-in redirect loop" },
          { title: "Welcome copy for the landing page" },
          { title: "Competitor pricing research" },
          { title: "Onboarding drop-off between steps 2 and 3" },
          { title: "Workspace invite emails" },
        ],
      },
    ],
    footer: { title: "Archive", icon: RiArchiveLine },
  },
  "/schedules": {
    title: "Schedules",
    create: { title: "New schedule", icon: RiEditBoxLine },
    groups: [
      {
        title: "Scheduled",
        items: [
          { title: "Daily standup summary", icon: RiCalendarLine },
          { title: "Weekly dependency check", icon: RiCalendarLine },
        ],
      },
    ],
  },
  "/documents": {
    title: "Documents",
    create: { title: "New document", icon: RiEditBoxLine },
    nav: [
      { title: "All", icon: RiFileTextLine },
      { title: "Skills", icon: RiSparklingLine },
    ],
    groups: [
      {
        title: "Recents",
        items: [
          { title: "Otto plan", icon: RiFileTextLine },
          { title: "Brand guidelines", icon: RiFileTextLine },
          { title: "Release checklist", icon: RiBookOpenLine },
        ],
      },
    ],
    footer: { title: "Archive", icon: RiArchiveLine },
  },
  "/library": {
    title: "Library",
    create: { title: "Upload", icon: RiAddLine },
    nav: [
      { title: "All", icon: RiBookOpenLine },
      { title: "Images", icon: RiImageLine },
      { title: "Sites", icon: RiGlobalLine },
    ],
    groups: [
      {
        title: "Recents",
        items: [
          { title: "pricing-comparison.pdf", icon: RiFileTextLine },
          { title: "landing-hero.png", icon: RiImageLine },
        ],
      },
    ],
  },
};

function MenuRow({ item, active }: { item: Item; active?: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active}>
        {Icon && <Icon />}
        <span>{item.title}</span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover aria-label={`More for ${item.title}`}>
        <RiMoreFill />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const matchRoute = useMatchRoute();
  const current =
    destinations.find(({ to }) => matchRoute({ to, fuzzy: to !== "/" }))?.to ??
    "/";
  const section = sections[current] ?? sections["/"];
  const CreateIcon = section.create.icon;

  return (
    // Offset past the rail; floating sidebars size to their content.
    <Sidebar variant="floating" className="data-[side=left]:left-13">
      <SidebarHeader>
        <div className="flex items-center gap-1 pl-2">
          <h2 className="flex-1 truncate font-medium">{section.title}</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Search">
            <RiSearchLine />
          </Button>
          <SidebarTrigger />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {CreateIcon && <CreateIcon />}
              <span>{section.create.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {section.nav && (
          <SidebarGroup>
            <SidebarMenu>
              {section.nav.map((item, index) => (
                <MenuRow key={item.title} item={item} active={index === 0} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {section.groups.map((group) => (
          <Collapsible
            key={group.title}
            defaultOpen
            render={<SidebarGroup className="group/section" />}
          >
            <SidebarGroupLabel
              render={<CollapsibleTrigger className="group/label" />}
            >
              {group.title}
              <RiArrowDownSLine className="ml-1 -rotate-90 opacity-0 transition-[rotate,opacity] group-hover/section:opacity-100 group-data-panel-open/label:rotate-0" />
            </SidebarGroupLabel>
            <SidebarGroupAction
              aria-label={`Add to ${group.title}`}
              className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100"
            >
              <RiAddLine />
            </SidebarGroupAction>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <MenuRow key={item.title} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </SidebarContent>

      {section.footer && (
        <SidebarFooter>
          <SidebarMenu>
            <MenuRow item={section.footer} />
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
