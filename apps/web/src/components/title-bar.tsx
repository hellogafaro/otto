import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { destinations } from "@/components/app-rail";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

// The desktop app (Electron) adds a 40px title strip above the shell; the web
// app has none (the browser has its own tabs and back). `?desktop` previews
// it in a browser for this session; `?desktop=0` turns it off.
export function useDesktop() {
  const [desktop] = useState(() => {
    const asked = new URLSearchParams(location.search).get("desktop");
    if (asked !== null)
      sessionStorage.setItem("otto-desktop", asked === "0" ? "" : "1");
    return !!sessionStorage.getItem("otto-desktop");
  });
  return desktop;
}

export const TITLE_BAR_HEIGHT = "2.5rem";

// What a tab shows for a page: its section's icon and the page's title.
function pageLook(path: string): {
  icon: RemixiconComponentType;
  title: string;
} {
  const pathname = path.split("?")[0];
  if (pathname === "/settings")
    return { icon: RiSettings3Line, title: "Settings" };
  const section =
    destinations.find(({ to }) => to !== "/" && pathname.startsWith(to)) ??
    destinations[0];
  return { icon: section.icon, title: section.label };
}

type Tab = { id: number; path: string };

// Traffic lights (drawn by macOS; stand-ins here), back and forward, then one
// tab per open page. Empty space drags the window; controls don't.
export function TitleBar() {
  const router = useRouter();
  const here = useLocation({ select: (location) => location.href });
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: 1, path: here }]);
  const [active, setActive] = useState(1);
  const activeRef = useRef(1);
  const nextId = useRef(2);

  // The open tab follows navigation, like a browser tab.
  useEffect(() => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeRef.current ? { ...tab, path: here } : tab,
      ),
    );
  }, [here]);

  const show = (tab: Tab) => {
    activeRef.current = tab.id;
    setActive(tab.id);
    if (tab.path !== here) router.history.push(tab.path);
  };

  const open = () => {
    const tab = { id: nextId.current++, path: "/" };
    setTabs((current) => [...current, tab]);
    show(tab);
  };

  const close = (id: number) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const rest = tabs.filter((tab) => tab.id !== id);
    if (rest.length === 0) rest.push({ id: nextId.current++, path: "/" });
    setTabs(rest);
    if (id === activeRef.current) show(rest[Math.min(index, rest.length - 1)]);
  };

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 pr-2 select-none [-webkit-app-region:drag]">
      {/* The first light's center (24px) sits over the rail's icon column. */}
      <div aria-hidden className="flex w-19.5 shrink-0 gap-2 pl-4.5">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
        <StripButton
          label="Back"
          icon={RiArrowLeftLine}
          onClick={() => router.history.back()}
        />
        <StripButton
          label="Forward"
          icon={RiArrowRightLine}
          onClick={() => router.history.forward()}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-2 [-webkit-app-region:no-drag]">
        {tabs.map((tab) => {
          const { icon: Icon, title } = pageLook(tab.path);
          const current = tab.id === active;
          return (
            <div key={tab.id} className="group/tab relative min-w-0">
              <Button
                variant={current ? "secondary" : "ghost"}
                size="sm"
                aria-current={current ? "page" : undefined}
                className="w-40 max-w-full justify-start pr-8"
                onClick={() => show(tab)}
              >
                <Icon data-icon="inline-start" />
                <TabTitle path={tab.path} fallback={title} />
              </Button>
              {/* 24px close, 4px inside the tab (sm 6, like every 24px button).
                  Shown on the open tab and on hover. */}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${title}`}
                className={cn(
                  "absolute top-1 right-1 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
                  current && "opacity-100",
                )}
                onClick={() => close(tab.id)}
              >
                <RiCloseLine />
              </Button>
            </div>
          );
        })}
        <StripButton label="New tab" icon={RiAddLine} onClick={open} />
      </div>
    </header>
  );
}

function StripButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: RemixiconComponentType;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TabTitle({ path, fallback }: { path: string; fallback: string }) {
  const { api, workspaceId } = useWorkspace();
  const [kind, id] = path.split("?")[0].split("/").slice(1);
  const supported =
    ["tasks", "projects", "documents", "chats", "schedules"].includes(kind) &&
    Boolean(id) &&
    id !== "new";
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "tab-title", kind, id],
    enabled: supported,
    queryFn: async () => {
      const param = { workspaceId, id };
      switch (kind) {
        case "tasks":
          return read(await api.tasks[":id"].$get({ param }));
        case "projects":
          return read(await api.projects[":id"].$get({ param }));
        case "documents":
          return read(await api.documents[":id"].$get({ param }));
        case "chats":
          return read(await api.chats[":id"].$get({ param }));
        case "schedules":
          return read(await api.schedules[":id"].$get({ param }));
        default:
          throw new Error("Unsupported title");
      }
    },
  });
  return (
    <span className="truncate">
      {query.error ? "Unavailable item" : (query.data?.title ?? fallback)}
    </span>
  );
}
