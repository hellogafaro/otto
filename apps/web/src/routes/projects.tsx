import {
  RiAddLine,
  RiArchiveLine,
  RiBox3Line,
  RiSearchLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu";
import { toast } from "@workspace/ui/components/sonner";
import { useState } from "react";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  NoResults,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { mention } from "@/components/mentions";
import { Page } from "@/components/page";
import {
  type ProjectFilters,
  ProjectForm,
  validateProjectFilters,
} from "@/components/project-controls";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export interface ProjectsSearch extends ProjectFilters {
  archived?: boolean;
}
export function validateProjectsSearch(
  search: Record<string, unknown>,
): ProjectsSearch {
  return {
    ...validateProjectFilters(search),
    archived:
      search.archived === true || search.archived === "true" ? true : undefined,
  };
}

export function ProjectsPage({ search = {} }: { search?: ProjectsSearch }) {
  const { api, workspaceId, workspace, invalidate } = useWorkspace();
  const navigate = useNavigate({ from: "/projects" });
  const [creating, setCreating] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string>();
  const [createUncertain, setCreateUncertain] = useState(false);
  const ask = useAskAgent();
  const list = useQuery({
    queryKey: ["workspace", workspaceId, "projects", search],
    queryFn: async () =>
      read(
        await api.projects.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: search.sort ?? "title",
            order: search.order ?? "asc",
            query: search.query,
            after: search.after,
            archived: search.archived ? "true" : "false",
          },
        }),
      ),
  });
  const admin = workspace.role === "owner" || workspace.role === "admin";
  const openPalette = useCommandPalette();
  const startCreating = () => {
    setCreatedProjectId(undefined);
    setCreateUncertain(false);
    setCreating(true);
  };
  const filters: FilterDef<"archived">[] = [
    {
      key: "archived",
      label: "Archive",
      icon: RiArchiveLine,
      options: { true: { label: "Archived", icon: RiArchiveLine } },
    },
  ];
  const values = { archived: search.archived ? "true" : undefined };
  const change = (_key: "archived", value: string | undefined) =>
    navigate({
      search: {
        ...search,
        archived: value ? true : undefined,
        after: undefined,
      },
    });
  const clear = () => navigate({ search: {} });
  const createDialog = creating && (
    <ProjectForm
      title="New project"
      onClose={() => setCreating(false)}
      creation={
        createUncertain ? "uncertain" : createdProjectId ? "saved" : undefined
      }
      checkProjects={async (title) => {
        await invalidate();
        await navigate({
          to: "/projects",
          search: {
            query: title || undefined,
            sort: "title",
            order: "asc",
          },
        });
        setCreating(false);
      }}
      save={async (input) => {
        let projectId = createdProjectId;
        if (!projectId) {
          try {
            const project = await read(
              await api.projects.$post({
                param: { workspaceId },
                json: {
                  title: input.title,
                  repositoryUrl: input.repositoryUrl || undefined,
                },
              }),
            );
            projectId = project.id;
            setCreatedProjectId(project.id);
          } catch (error) {
            // Creation has no request identity: a lost ACK cannot safely repeat POST.
            if (!(error instanceof ApiError) || error.status >= 500) {
              setCreateUncertain(true);
              throw new Error(
                "Otto did not confirm whether the project was saved.",
              );
            }
            throw error;
          }
        }
        await invalidate();
        await navigate({
          to: "/projects/$projectId",
          params: { projectId },
        });
      }}
    />
  );
  if (
    list.data &&
    !list.error &&
    list.data.items.length === 0 &&
    !search.archived &&
    !search.query &&
    !search.after
  )
    return (
      <>
        <EmptyPage
          icon={RiBox3Line}
          title="No projects"
          description="Projects gather tasks, chats, documents and files around one goal."
        >
          {admin && <Button onClick={startCreating}>New project</Button>}
        </EmptyPage>
        {createDialog}
      </>
    );
  return (
    <Page
      title="Projects"
      width="wide"
      actions={
        <>
          <FilterMenu filters={filters} values={values} onChange={change} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("projects")}
          />
          {admin && (
            <IconAction
              label="New project"
              icon={RiAddLine}
              onClick={startCreating}
            />
          )}
        </>
      }
    >
      <FilterBar
        filters={filters}
        values={values}
        onChange={change}
        onClear={clear}
      />
      <QueryState
        pending={list.isPending}
        error={list.error}
        retry={() => list.refetch()}
      />
      {list.data &&
        !list.error &&
        (list.data.items.length ? (
          <Gallery columns={3}>
            {list.data.items.map((project) => (
              <GalleryItem
                key={project.id}
                render={
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                  />
                }
                className="aspect-video bg-muted"
                icon={RiBox3Line}
                title={project.title}
                menu={
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuItem
                        onClick={() =>
                          navigate({
                            to: "/projects/$projectId",
                            params: { projectId: project.id },
                          })
                        }
                      >
                        Open
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          ask(
                            `${mention({ type: "project", id: project.id, label: project.title })} `,
                          )
                        }
                      >
                        Ask about it
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              new URL(
                                `/projects/${project.id}`,
                                location.origin,
                              ).href,
                            );
                            toast.success("Link copied");
                          } catch {
                            toast.error("Unable to copy the link.");
                          }
                        }}
                      >
                        Copy link
                      </ContextMenuItem>
                    </ContextMenuGroup>
                  </ContextMenuContent>
                }
              />
            ))}
          </Gallery>
        ) : (
          <NoResults what="projects" onClear={clear} />
        ))}
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
      {createDialog}
    </Page>
  );
}
