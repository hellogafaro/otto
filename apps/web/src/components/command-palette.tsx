import {
  type RemixiconComponentType,
  RiAddLine,
  RiBox3Line,
  RiFileTextLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { destinations } from "@/components/app-rail";
import { ActorAvatar, resourceIcons, statuses } from "@/components/task-meta";
import {
  agents,
  documents,
  projects,
  resources,
  tasks,
  users,
} from "@/mock/tasks";

// One command palette for the whole app: ⌘K / Ctrl+K anywhere, or a page's
// search button with its category already selected. Tab and Shift+Tab switch
// categories; picking a result goes there.
const categories = [
  "all",
  "tasks",
  "people",
  "projects",
  "documents",
  "resources",
  "actions",
] as const;
export type PaletteCategory = (typeof categories)[number];

const labels: Record<PaletteCategory, string> = {
  all: "All",
  tasks: "Tasks",
  people: "People",
  projects: "Projects",
  documents: "Documents",
  resources: "Resources",
  actions: "Actions",
};

const hints = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["↵"], label: "Open" },
  { keys: ["Tab"], label: "Category" },
  { keys: ["Esc"], label: "Close" },
];

const PaletteContext = createContext<(category?: PaletteCategory) => void>(
  () => {},
);

export const useCommandPalette = () => useContext(PaletteContext);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PaletteCategory>("all");

  const show = (next: PaletteCategory = "all") => {
    setCategory(next);
    setOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCategory("all");
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <PaletteContext value={show}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search tasks, people, projects and actions"
        className="sm:max-w-[720px]"
      >
        <Palette
          category={category}
          onCategory={setCategory}
          onDone={() => setOpen(false)}
        />
      </CommandDialog>
    </PaletteContext>
  );
}

function Palette({
  category,
  onCategory,
  onDone,
}: {
  category: PaletteCategory;
  onCategory: (category: PaletteCategory) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const shows = (group: PaletteCategory) =>
    category === "all" || category === group;
  const go = (to: () => void) => () => {
    to();
    onDone();
  };

  return (
    <Command
      // Plain "contains" matching on names, not fuzzy letters.
      filter={(_value, search, keywords) =>
        keywords?.join(" ").toLowerCase().includes(search.toLowerCase()) ? 1 : 0
      }
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        const index = categories.indexOf(category);
        onCategory(
          categories[(index + step + categories.length) % categories.length],
        );
      }}
    >
      <CommandInput placeholder="Search tasks, people, projects, documents, resources and actions" />
      {/* 28px tabs, 4px apart, 8px above and below; tab text lands 16px in like
          everything else. */}
      <div className="flex gap-1 px-1.75 py-2">
        {categories.map((value) => (
          <Button
            key={value}
            variant={value === category ? "secondary" : "ghost"}
            size="compact"
            aria-pressed={value === category}
            onClick={() => onCategory(value)}
          >
            {labels[value]}
          </Button>
        ))}
      </div>
      {/* The tab row already spaces 8px below; the list adds no top padding. */}
      <CommandList className="pt-0">
        <CommandEmpty>No results</CommandEmpty>
        {shows("tasks") && (
          <CommandGroup heading="Tasks">
            {tasks.map((task) => {
              const status = statuses[task.status];
              return (
                <CommandItem
                  key={task.id}
                  value={`task-${task.id}`}
                  keywords={[task.title]}
                  onSelect={go(() =>
                    navigate({
                      to: "/tasks/$taskId",
                      params: { taskId: task.id },
                    }),
                  )}
                >
                  <Slot>
                    <status.icon className={status.className} />
                  </Slot>
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {projects[task.projectId as keyof typeof projects].title}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {shows("people") && (
          <CommandGroup heading="People">
            {[...Object.entries(users), ...Object.entries(agents)].map(
              ([id, actor]) => {
                const name = "name" in actor ? actor.name : actor.title;
                const agent = id in agents;
                return (
                  <CommandItem
                    key={id}
                    value={`person-${id}`}
                    keywords={[name]}
                    onSelect={go(() =>
                      navigate({
                        to: "/tasks",
                        search: agent ? { assignee: id } : { owner: id },
                      }),
                    )}
                  >
                    <ActorAvatar actorId={id} />
                    {name}
                    <span className="ml-auto text-muted-foreground">
                      {agent ? "Assigned tasks" : "Owned tasks"}
                    </span>
                  </CommandItem>
                );
              },
            )}
          </CommandGroup>
        )}
        {shows("projects") && (
          <CommandGroup heading="Projects">
            {Object.entries(projects).map(([id, project]) => (
              <CommandItem
                key={id}
                value={`project-${id}`}
                keywords={[project.title]}
                onSelect={go(() =>
                  navigate({
                    to: "/projects/$projectId",
                    params: { projectId: id },
                  }),
                )}
              >
                <Slot>
                  <RiBox3Line />
                </Slot>
                {project.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shows("documents") && (
          <CommandGroup heading="Documents">
            {documents.map((document) => (
              <CommandItem
                key={document.id}
                value={`document-${document.id}`}
                keywords={[document.title]}
                onSelect={go(() =>
                  navigate({
                    to: "/documents/$documentId",
                    params: { documentId: document.id },
                  }),
                )}
              >
                <Slot>
                  <RiFileTextLine />
                </Slot>
                <span className="min-w-0 truncate">{document.title}</span>
                {document.projectId && (
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {projects[document.projectId].title}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shows("resources") && (
          <CommandGroup heading="Resources">
            {resources.map((resource) => {
              const Icon = resourceIcons[resource.kind];
              return (
                <CommandItem
                  key={resource.id}
                  value={`resource-${resource.id}`}
                  keywords={[resource.title]}
                  onSelect={go(() =>
                    navigate({
                      to: "/resources",
                      search: { open: resource.id },
                    }),
                  )}
                >
                  <Slot>
                    <Icon />
                  </Slot>
                  <span className="min-w-0 truncate">{resource.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {shows("actions") && (
          <CommandGroup heading="Actions">
            {/* Not wired yet. */}
            <CommandItem
              value="action-new-task"
              keywords={["New task"]}
              onSelect={onDone}
            >
              <Slot>
                <RiAddLine />
              </Slot>
              New task
            </CommandItem>
            {destinations.map(({ to, label, icon }) => (
              <Action
                key={to}
                label={`Go to ${label}`}
                icon={icon}
                onSelect={go(() => navigate({ to }))}
              />
            ))}
            <Action
              label="Go to Settings"
              icon={RiSettings3Line}
              onSelect={go(() => navigate({ to: "/settings" }))}
            />
          </CommandGroup>
        )}
      </CommandList>
      {/* Full-width top border; 48px like the search bar, hints 16px in. */}
      <div className="flex h-12 shrink-0 items-center justify-end gap-4 border-t border-foreground/10 px-4 text-xs text-muted-foreground">
        {hints.map(({ keys, label }) => (
          <span key={label} className="flex items-center gap-2">
            <KbdGroup>
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
            {label}
          </span>
        ))}
      </div>
    </Command>
  );
}

function Action({
  label,
  icon: Icon,
  onSelect,
}: {
  label: string;
  icon: RemixiconComponentType;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`action-${label}`}
      keywords={[label]}
      onSelect={onSelect}
    >
      <Slot>
        <Icon />
      </Slot>
      {label}
    </CommandItem>
  );
}

// 20px slot so icon rows line up with avatar rows.
function Slot({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}
