import {
  type RemixiconComponentType,
  RiAlignLeft,
  RiArchiveLine,
  RiBox3Line,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiFileLine,
  RiFileTextLine,
  RiFolder3Line,
  RiMoreLine,
} from "@remixicon/react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AvatarGroup } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { useState } from "react";
import { DetailView, Section } from "@/components/detail";
import { FloatingChat } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { Page } from "@/components/page";
import {
  ProjectEmpty,
  type ProjectFilters,
  ProjectForm,
  ProjectListFilters,
  validateProjectFilters,
} from "@/components/project-controls";
import { QueryState } from "@/components/query-state";
import { TabBar } from "@/components/tab-bar";
import { ActorAvatar, statuses } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useProjectMembership } from "@/lib/project-membership";
import { useWorkspace } from "@/lib/workspace";

const tabs = ["overview", "tasks", "documents", "files"] as const;
type ProjectTab = (typeof tabs)[number];
export interface ProjectSearch extends ProjectFilters {
  tab?: Exclude<ProjectTab, "overview">;
}
export function validateProjectSearch(
  search: Record<string, unknown>,
): ProjectSearch {
  const tab = tabs.find((value) => value === search.tab);
  return {
    ...validateProjectFilters(search),
    tab: tab === "overview" ? undefined : tab,
  };
}

export function ProjectPage({
  projectId,
  search,
}: {
  projectId: string;
  search: ProjectSearch;
}) {
  const { api, workspaceId } = useWorkspace();
  const project = useQuery({
    queryKey: ["workspace", workspaceId, "project", projectId],
    queryFn: async () =>
      read(
        await api.projects[":id"].$get({
          param: { workspaceId, id: projectId },
        }),
      ),
  });
  if (!project.data || project.error)
    return (
      <Page title="Project">
        <QueryState
          pending={project.isPending}
          error={project.error}
          retry={() => project.refetch()}
        />
      </Page>
    );
  return <ProjectView key={projectId} project={project.data} search={search} />;
}

type ProjectRecord =
  Awaited<
    ReturnType<
      ReturnType<typeof useWorkspace>["api"]["projects"][":id"]["$get"]
    >
  > extends { json(): Promise<infer T> }
    ? T
    : never;

function ProjectView({
  project,
  search,
}: {
  project: ProjectRecord;
  search: ProjectSearch;
}) {
  const { api, workspaceId, workspace, user, invalidate } = useWorkspace();
  const directory = useDirectory();
  const navigate = useNavigate({ from: "/projects/$projectId" });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const tab = search.tab ?? "overview";
  const param = { workspaceId, id: project.id };
  const members = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "project", project.id, "members"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.projects[":id"].members.$get({
          param,
          query: { limit: "100", sort: "name", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const membership = useProjectMembership(project.id);
  const admin =
    (workspace.role === "admin" || workspace.role === "owner") &&
    !membership.error &&
    membership.data?.role === "contributor";
  const archive = useMutation({
    mutationFn: async () =>
      read(
        await api.projects[":id"].archive.$post({
          param,
          json: { archived: !project.archived },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      toast.success(project.archived ? "Project restored" : "Project archived");
    },
    onError: () => invalidate(),
  });
  const changeMember = useMutation({
    mutationFn: async (input: {
      userId: string;
      role?: "viewer" | "contributor";
    }) => {
      const memberParam = { ...param, userId: input.userId };
      return input.role
        ? read(
            await api.projects[":id"].members[":userId"].$patch({
              param: memberParam,
              json: { role: input.role },
            }),
          )
        : read(
            await api.projects[":id"].members[":userId"].$delete({
              param: memberParam,
            }),
          );
    },
    onSuccess: () => invalidate(),
    onError: () => invalidate(),
  });
  const chats = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "project", project.id, "chats"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.chats.$get({
          param: { workspaceId },
          query: {
            projectId: project.id,
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const people = members.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <DetailView
      parent={{
        label: "Projects",
        icon: RiBox3Line,
        link: <Link to="/projects" />,
      }}
      current={{ icon: RiBox3Line }}
      title={project.title}
      type="project"
      people={
        <div className="flex flex-wrap items-center gap-2">
          {members.data && !members.error && (
            <>
              <AvatarGroup>
                {people.slice(0, 8).map((member) => (
                  <ActorAvatar key={member.userId} actorId={member.userId} />
                ))}
              </AvatarGroup>
              <span>
                {people.length}
                {members.hasNextPage ? "+" : ""} members
              </span>
            </>
          )}
          {project.archived && <Badge variant="secondary">Archived</Badge>}
        </div>
      }
      ask={
        <FloatingChat
          about="this project"
          projectId={project.id}
          subject={{ type: "project", id: project.id, label: project.title }}
        />
      }
      more={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="More" />}
          >
            <RiMoreLine />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      new URL(`/projects/${project.id}`, location.origin).href,
                    );
                    toast.success("Link copied");
                  } catch {
                    toast.error("Unable to copy the link.");
                  }
                }}
              >
                Copy link
              </DropdownMenuItem>
              {admin && (
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  Edit project
                </DropdownMenuItem>
              )}
              {admin && (
                <DropdownMenuItem
                  disabled={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  <RiArchiveLine />
                  {archive.isPending
                    ? "Saving"
                    : project.archived
                      ? "Restore"
                      : "Archive"}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      panel={
        <>
          <Section title="Project">
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <RiBox3Line />
                <span>{project.archived ? "Archived" : "Active"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {project.repositoryUrl &&
              safeRepositoryUrl(project.repositoryUrl) && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <a
                        href={project.repositoryUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    <RiFolder3Line />
                    <span>Repository</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
          </Section>
          <Section title="Chats">
            <QueryState
              pending={chats.isPending}
              error={chats.error}
              retry={() => chats.refetch()}
            />
            {!chats.error &&
              chats.data?.pages
                .flatMap((page) => page.items)
                .map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      render={
                        <Link
                          to="/chats/$chatId"
                          params={{ chatId: chat.id }}
                        />
                      }
                    >
                      <RiChat1Line />
                      <span>{chat.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            {chats.data &&
              !chats.error &&
              !chats.data.pages[0].items.length && (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>No chats</SidebarMenuButton>
                </SidebarMenuItem>
              )}
            {chats.hasNextPage && !chats.error && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  disabled={chats.isFetchingNextPage}
                  onClick={() => chats.fetchNextPage()}
                >
                  More chats
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {!project.archived &&
              workspace.role !== "viewer" &&
              !membership.error &&
              membership.data?.role === "contributor" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Link
                        to="/chats/new"
                        search={{ project: project.id, with: undefined }}
                      />
                    }
                  >
                    <RiChat1Line />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
          </Section>
        </>
      }
    >
      <QueryState
        pending={membership.isPending}
        error={membership.error}
        retry={() => membership.refetch()}
      />
      {archive.error && <p role="alert">{archive.error.message}</p>}
      <TabBar
        label="Project sections"
        className="-ml-2.25"
        tabs={tabs.map((value) => ({ value, ...tabLooks[value] }))}
        value={tab}
        onChange={(value) =>
          navigate({
            search: { tab: value === "overview" ? undefined : value },
          })
        }
      />
      {tab === "overview" && (
        <>
          <FieldGroup>
            <Field>
              <FieldLabel>Repository URL</FieldLabel>
              {project.repositoryUrl ? (
                <p>
                  {safeRepositoryUrl(project.repositoryUrl) ? (
                    <a
                      href={project.repositoryUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {project.repositoryUrl}
                    </a>
                  ) : (
                    project.repositoryUrl
                  )}
                </p>
              ) : (
                <p>No repository linked.</p>
              )}
            </Field>
          </FieldGroup>
          {admin && (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setEditing(true)}
            >
              Edit project
            </Button>
          )}
          <div className="flex items-center justify-between gap-2">
            <h2>Members</h2>
            {admin && (
              <Button variant="ghost" onClick={() => setAdding(true)}>
                Add member
              </Button>
            )}
          </div>
          <QueryState
            pending={members.isPending}
            error={members.error}
            retry={() => members.refetch()}
          />
          {changeMember.error && (
            <p role="alert">
              {changeMember.error.message} Open tasks must be transferred before
              removing or demoting their owner.
            </p>
          )}
          {!members.error && (
            <ul className="flex flex-col gap-2">
              {people.map((member) => (
                <li key={member.userId} className="flex items-center gap-2">
                  <ActorAvatar actorId={member.userId} />
                  <span className="min-w-0 flex-1 truncate">
                    {member.name ?? directory.actorOf(member.userId).name}
                  </span>
                  <Badge variant="secondary">
                    {member.role === "viewer" ? "Viewer" : "Contributor"}
                  </Badge>
                  {admin && member.userId !== user.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            disabled={changeMember.isPending}
                          />
                        }
                      >
                        Manage
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuGroup>
                          <DropdownMenuRadioGroup
                            value={member.role}
                            onValueChange={(role) => {
                              if (role === "viewer" || role === "contributor")
                                changeMember.mutate({
                                  userId: member.userId,
                                  role,
                                });
                            }}
                          >
                            <DropdownMenuRadioItem value="viewer">
                              Viewer
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="contributor">
                              Contributor
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          <DropdownMenuItem
                            onClick={() =>
                              changeMember.mutate({ userId: member.userId })
                            }
                          >
                            Remove member
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          )}
          {members.hasNextPage && !members.error && (
            <Button
              variant="outline"
              className="self-start"
              disabled={members.isFetchingNextPage}
              onClick={() => members.fetchNextPage()}
            >
              More members
            </Button>
          )}
        </>
      )}
      {tab !== "overview" && (
        <ProjectContent
          key={tab}
          projectId={project.id}
          tab={tab}
          search={search}
        />
      )}
      {editing && (
        <ProjectForm
          title="Edit project"
          initial={project}
          onClose={() => setEditing(false)}
          save={async (input, changed) => {
            if (!changed.title && !changed.repositoryUrl) return;
            await read(
              await api.projects[":id"].$patch({
                param,
                json: {
                  ...(changed.title ? { title: input.title } : {}),
                  ...(changed.repositoryUrl
                    ? { repositoryUrl: input.repositoryUrl || null }
                    : {}),
                },
              }),
            );
            await invalidate();
          }}
        />
      )}
      {adding && (
        <AddProjectMember
          projectId={project.id}
          onClose={() => setAdding(false)}
        />
      )}
    </DetailView>
  );
}

function safeRepositoryUrl(value: string) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function ProjectContent({
  projectId,
  tab,
  search,
}: {
  projectId: string;
  tab: Exclude<ProjectTab, "overview">;
  search: ProjectSearch;
}) {
  const { api, workspaceId } = useWorkspace();
  const navigate = useNavigate({ from: "/projects/$projectId" });
  const query = {
    projectId,
    query: search.query,
    sort: search.sort ?? "title",
    order: search.order ?? "asc",
    after: search.after,
    limit: "100",
  };
  const tasks = useQuery({
    queryKey: ["workspace", workspaceId, "project", projectId, "tasks", query],
    enabled: tab === "tasks",
    queryFn: async () =>
      read(await api.tasks.$get({ param: { workspaceId }, query })),
  });
  const documents = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "project",
      projectId,
      "documents",
      query,
    ],
    enabled: tab === "documents",
    queryFn: async () =>
      read(await api.documents.$get({ param: { workspaceId }, query })),
  });
  const files = useQuery({
    queryKey: ["workspace", workspaceId, "project", projectId, "files", query],
    enabled: tab === "files",
    queryFn: async () =>
      read(await api.files.$get({ param: { workspaceId }, query })),
  });
  const list =
    tab === "tasks" ? tasks : tab === "documents" ? documents : files;
  const directory = useDirectory();
  return (
    <>
      <ProjectListFilters
        key={search.query ?? ""}
        value={search}
        onChange={(next) => navigate({ search: { ...next, tab } })}
      />
      <QueryState
        pending={list.isPending}
        error={list.error}
        retry={() => list.refetch()}
      />
      {list.data && !list.error && !list.data.items.length && (
        <ProjectEmpty
          title={`No ${search.query ? "matching " : ""}${tab}`}
          description={`Readable ${tab} in this project appear here.`}
        />
      )}
      {tab === "tasks" && tasks.data && !tasks.error && (
        <div className="flex flex-col gap-5">
          {(["todo", "doing", "done"] as const).map((status) => {
            const group = tasks.data.items.filter(
              (task) => task.status === status,
            );
            const StatusIcon = statuses[status].icon;
            return (
              group.length > 0 && (
                <section key={status} className="flex flex-col gap-2">
                  <h2>{statuses[status].label}</h2>
                  <ul className="flex flex-col gap-1">
                    {group.map((task) => (
                      <li key={task.id}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                          nativeButton={false}
                          render={
                            <Link
                              to="/tasks/$taskId"
                              params={{ taskId: task.id }}
                            />
                          }
                        >
                          <StatusIcon
                            className={statuses[status].className}
                            data-icon="inline-start"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {task.title}
                          </span>
                          <span>{directory.actorOf(task.ownerId).name}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            );
          })}
        </div>
      )}
      {tab === "documents" && documents.data && !documents.error && (
        <Gallery columns={4}>
          {documents.data.items.map((document) => (
            <GalleryItem
              key={document.id}
              title={document.title}
              icon={RiFileTextLine}
              className="aspect-4/5 bg-muted"
              render={
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: document.id }}
                />
              }
            />
          ))}
        </Gallery>
      )}
      {tab === "files" && files.data && !files.error && (
        <Gallery columns={4}>
          {files.data.items.map((file) => (
            <GalleryItem
              key={file.id}
              title={file.title}
              icon={RiFileLine}
              className="aspect-square bg-muted"
              render={
                <Link
                  to="/files"
                  search={{ project: projectId, open: file.id }}
                />
              }
            />
          ))}
        </Gallery>
      )}
      {(search.after || (list.data && !list.error)) && (
        <div className="flex gap-2">
          {search.after && (
            <Button
              variant="ghost"
              onClick={() =>
                navigate({ search: { ...search, after: undefined } })
              }
            >
              First page
            </Button>
          )}
          {!list.error && list.data?.next && (
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  search: { ...search, after: list.data?.next ?? undefined },
                })
              }
            >
              Next page
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function AddProjectMember({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [after, setAfter] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [role, setRole] = useState<"viewer" | "contributor">("viewer");
  const candidates = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "project-member-candidates",
      search,
      after,
    ],
    queryFn: async () =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: {
            query: search || undefined,
            sort: "name",
            limit: "100",
            after,
          },
        }),
      ),
  });
  const add = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Choose a workspace member.");
      const current = await read(
        await api.projects[":id"].members.$get({
          param: { workspaceId, id: projectId },
          query: { limit: "100" },
        }),
      );
      // Existing roles use PATCH so demotion cannot bypass ownership checks. Search remaining pages too.
      let found = current.items.some((member) => member.userId === userId);
      let cursor = current.next;
      while (!found && cursor) {
        const page = await read(
          await api.projects[":id"].members.$get({
            param: { workspaceId, id: projectId },
            query: { limit: "100", after: cursor },
          }),
        );
        found = page.items.some((member) => member.userId === userId);
        cursor = page.next;
      }
      if (found)
        throw new Error(
          "This person is already a project member. Use Manage to change their role.",
        );
      await read(
        await api.projects[":id"].members.$post({
          param: { workspaceId, id: projectId },
          json: { userId, role },
        }),
      );
      await invalidate();
    },
    onSuccess: onClose,
    onError: () => invalidate(),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !add.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!add.isPending}>
        <DialogHeader>
          <DialogTitle>Add project member</DialogTitle>
          <DialogDescription>
            Choose a current workspace member and their project role.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-member-query">
              Search by whole words
            </FieldLabel>
            <Input
              id="project-member-query"
              value={query}
              maxLength={200}
              disabled={add.isPending}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSearch(query.trim());
                  setAfter(undefined);
                  setUserId(undefined);
                }
              }}
            />
          </Field>
          <Button
            variant="outline"
            disabled={add.isPending}
            onClick={() => {
              setSearch(query.trim());
              setAfter(undefined);
              setUserId(undefined);
            }}
          >
            Search
          </Button>
          <QueryState
            pending={candidates.isPending}
            error={candidates.error}
            retry={() => candidates.refetch()}
          />
          <Field>
            <FieldLabel>Workspace member</FieldLabel>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    disabled={
                      add.isPending ||
                      !candidates.data ||
                      Boolean(candidates.error)
                    }
                  />
                }
              >
                {candidates.data?.items.find(
                  (member) => member.userId === userId,
                )?.name ?? "Choose member"}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-48 overflow-y-auto">
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup
                    value={userId ?? ""}
                    onValueChange={setUserId}
                  >
                    {!candidates.error &&
                      candidates.data?.items.map((member) => (
                        <DropdownMenuRadioItem
                          key={member.userId}
                          value={member.userId}
                        >
                          {member.name}
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
          {candidates.data &&
            !candidates.error &&
            !candidates.data.items.length && (
              <p>No matching workspace members.</p>
            )}
          {candidates.data && !candidates.error && (
            <div className="flex gap-2">
              {after && (
                <Button
                  variant="ghost"
                  disabled={add.isPending}
                  onClick={() => {
                    setAfter(undefined);
                    setUserId(undefined);
                  }}
                >
                  First page
                </Button>
              )}
              {candidates.data.next && (
                <Button
                  variant="ghost"
                  disabled={add.isPending}
                  onClick={() => {
                    setAfter(candidates.data.next ?? undefined);
                    setUserId(undefined);
                  }}
                >
                  Next page
                </Button>
              )}
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" disabled={add.isPending} />}
            >
              Role: {role === "viewer" ? "Viewer" : "Contributor"}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={role}
                  onValueChange={(next) => {
                    if (next === "viewer" || next === "contributor")
                      setRole(next);
                  }}
                >
                  <DropdownMenuRadioItem value="viewer">
                    Viewer
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="contributor">
                    Contributor
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {add.error && <p role="alert">{add.error.message}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={add.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!userId || add.isPending || Boolean(candidates.error)}
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Saving" : "Add member"}
            </Button>
          </DialogFooter>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}

const tabLooks: Record<
  ProjectTab,
  { label: string; icon: RemixiconComponentType }
> = {
  overview: { label: "Overview", icon: RiAlignLeft },
  tasks: { label: "Tasks", icon: RiCheckboxCircleLine },
  documents: { label: "Documents", icon: RiFileTextLine },
  files: { label: "Files", icon: RiFolder3Line },
};
