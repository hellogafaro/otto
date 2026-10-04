import {
  type RemixiconComponentType,
  RiBox3Line,
  RiFileTextLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
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
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select";
import {
  createContext,
  type ReactNode,
  useContext,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import { destinations } from "@/components/app-rail";
import { QueryState } from "@/components/query-state";
import { TabBar } from "@/components/tab-bar";
import {
  ActorAvatar,
  resourceIcons,
  resourceKindOf,
  statuses,
} from "@/components/task-meta";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

// One command palette for the whole app: ⌘K / Ctrl+K anywhere, or a page's
// search button with its category already selected. Tab and Shift+Tab switch
// categories; picking a result goes there.
const categories = [
  "all",
  "tasks",
  "people",
  "projects",
  "documents",
  "files",
  "actions",
] as const;
export type PaletteCategory = (typeof categories)[number];

const labels: Record<PaletteCategory, string> = {
  all: "All",
  tasks: "Tasks",
  people: "People",
  projects: "Projects",
  documents: "Documents",
  files: "Files",
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
          open={open}
          onCategory={setCategory}
          onDone={() => setOpen(false)}
        />
      </CommandDialog>
    </PaletteContext>
  );
}

function Palette({
  category,
  open,
  onCategory,
  onDone,
}: {
  category: PaletteCategory;
  open: boolean;
  onCategory: (category: PaletteCategory) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const { api, workspaceId } = useWorkspace();
  const directory = useDirectory();
  const [text, setText] = useState("");
  const query = useDeferredValue(text.trim().slice(0, 200));
  const [projectSelection, setProjectSelection] = useState("");
  const projectId =
    projectSelection || params.projectId || directory.projects[0]?.id;
  const shows = (group: PaletteCategory) =>
    category === "all" || category === group;
  const search = {
    query: query || undefined,
    limit: "5",
    sort: "updatedAt" as const,
    order: "desc" as const,
  };
  const projects = useQuery({
    queryKey: ["workspace", workspaceId, "palette-projects", query],
    enabled: open && shows("projects"),
    queryFn: async () =>
      read(await api.projects.$get({ param: { workspaceId }, query: search })),
  });
  const tasks = useQuery({
    queryKey: ["workspace", workspaceId, "palette-tasks", projectId, query],
    enabled: open && shows("tasks") && Boolean(projectId),
    queryFn: async () =>
      read(
        await api.tasks.$get({
          param: { workspaceId },
          query: { ...search, projectId: projectId ?? "" },
        }),
      ),
  });
  const documents = useQuery({
    queryKey: ["workspace", workspaceId, "palette-documents", query],
    enabled: open && shows("documents"),
    queryFn: async () =>
      read(await api.documents.$get({ param: { workspaceId }, query: search })),
  });
  const files = useQuery({
    queryKey: ["workspace", workspaceId, "palette-files", query],
    enabled: open && shows("files"),
    queryFn: async () =>
      read(await api.files.$get({ param: { workspaceId }, query: search })),
  });
  const members = useQuery({
    queryKey: ["workspace", workspaceId, "palette-members", query],
    enabled: open && shows("people"),
    queryFn: async () =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: { query: query || undefined, limit: "5", sort: "name" },
        }),
      ),
  });
  const agents = useQuery({
    queryKey: ["workspace", workspaceId, "palette-agents", query],
    enabled: open && shows("people"),
    queryFn: async () =>
      read(await api.agents.$get({ param: { workspaceId }, query: search })),
  });
  const errors = [
    { key: "projects", result: projects },
    { key: "tasks", result: tasks },
    { key: "documents", result: documents },
    { key: "files", result: files },
    { key: "members", result: members },
    { key: "agents", result: agents },
  ].filter(({ result }) => result.error);
  const actions = destinations.filter(
    ({ label }) =>
      !query || `go to ${label}`.toLowerCase().includes(query.toLowerCase()),
  );
  const showsSettings =
    !query || "go to settings".includes(query.toLowerCase());
  const searching = [projects, tasks, documents, files, members, agents].some(
    (result) => result.isFetching,
  );
  const go = (to: () => unknown) => () => {
    to();
    onDone();
  };
  return (
    <Command
      shouldFilter={false}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.target instanceof HTMLSelectElement)
          return;
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        const index = categories.indexOf(category);
        onCategory(
          categories[(index + step + categories.length) % categories.length],
        );
      }}
    >
      <CommandInput value={text} onValueChange={setText} placeholder="Search" />
      <TabBar
        label="Categories"
        className="flex-nowrap px-1.75 py-2"
        tabs={categories.map((value) => ({ value, label: labels[value] }))}
        value={category}
        onChange={onCategory}
      />
      {shows("tasks") && directory.projects.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <NativeSelect
            aria-label="Task search project"
            value={projectId ?? ""}
            onChange={(event) => setProjectSelection(event.target.value)}
          >
            <NativeSelectOption value="">Choose project</NativeSelectOption>
            {directory.projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <CommandList className="pt-0">
        {errors.map(({ key, result }) => (
          <QueryState
            key={key}
            error={result.error}
            retry={() => result.refetch()}
          />
        ))}
        {searching && (
          <div role="status" className="px-4 py-2">
            Searching
          </div>
        )}
        {query && !searching && errors.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}
        {shows("tasks") && Boolean(tasks.data?.items.length) && (
          <CommandGroup heading="Tasks">
            {tasks.data?.items.map((task) => {
              const status = statuses[task.status];
              return (
                <CommandItem
                  key={task.id}
                  value={`task-${task.id}`}
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
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {shows("people") &&
          Boolean(members.data?.items.length || agents.data?.items.length) && (
            <CommandGroup heading="People">
              {members.data?.items.map((member) => (
                <CommandItem
                  key={member.userId}
                  value={`person-${member.userId}`}
                  onSelect={go(() =>
                    navigate({
                      to: "/tasks",
                      search: { owner: member.userId },
                    }),
                  )}
                >
                  <ActorAvatar actorId={member.userId} />
                  {member.name}
                </CommandItem>
              ))}
              {agents.data?.items.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent-${agent.id}`}
                  onSelect={go(() =>
                    navigate({
                      to: "/settings/agents/$agentId",
                      params: { agentId: agent.id },
                    }),
                  )}
                >
                  <ActorAvatar actorId={agent.id} />
                  {agent.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        {shows("projects") && Boolean(projects.data?.items.length) && (
          <CommandGroup heading="Projects">
            {projects.data?.items.map((project) => (
              <CommandItem
                key={project.id}
                value={`project-${project.id}`}
                onSelect={go(() =>
                  navigate({
                    to: "/projects/$projectId",
                    params: { projectId: project.id },
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
        {shows("documents") && Boolean(documents.data?.items.length) && (
          <CommandGroup heading="Documents">
            {documents.data?.items.map((document) => (
              <CommandItem
                key={document.id}
                value={`document-${document.id}`}
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
                {document.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shows("files") && Boolean(files.data?.items.length) && (
          <CommandGroup heading="Files">
            {files.data?.items.map((file) => {
              const Icon = resourceIcons[resourceKindOf(file.mediaType)];
              return (
                <CommandItem
                  key={file.id}
                  value={`file-${file.id}`}
                  onSelect={go(() =>
                    navigate({ to: "/files", search: { open: file.id } }),
                  )}
                >
                  <Slot>
                    <Icon />
                  </Slot>
                  {file.title}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {shows("actions") && (actions.length > 0 || showsSettings) && (
          <CommandGroup heading="Actions">
            {actions.map(({ to, label, icon }) => (
              <Action
                key={to}
                label={`Go to ${label}`}
                icon={icon}
                onSelect={go(() => navigate({ to }))}
              />
            ))}
            {showsSettings && (
              <Action
                label="Go to Settings"
                icon={RiSettings3Line}
                onSelect={go(() => navigate({ to: "/settings" }))}
              />
            )}
          </CommandGroup>
        )}
      </CommandList>
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
