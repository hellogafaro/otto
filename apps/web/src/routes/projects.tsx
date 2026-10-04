import { RiAddLine, RiBox3Line } from "@remixicon/react";
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
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { mention } from "@/components/mentions";
import { Page } from "@/components/page";
import {
  ProjectEmpty,
  type ProjectFilters,
  ProjectForm,
  ProjectListFilters,
  validateProjectFilters,
} from "@/components/project-controls";
import { QueryState } from "@/components/query-state";
import { read } from "@/lib/api";
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
  return (
    <Page
      title="Projects"
      width="wide"
      actions={
        admin && (
          <IconAction
            label="New project"
            icon={RiAddLine}
            onClick={() => setCreating(true)}
          />
        )
      }
    >
      <ProjectListFilters
        key={search.query ?? ""}
        value={search}
        onChange={(next) =>
          navigate({ search: { ...next, archived: search.archived } })
        }
      />
      <Button
        variant="ghost"
        className="self-start"
        onClick={() =>
          navigate({
            search: {
              ...search,
              archived: search.archived ? undefined : true,
              after: undefined,
            },
          })
        }
      >
        {search.archived ? "Show active projects" : "Show archived projects"}
      </Button>
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
          <ProjectEmpty
            title={
              search.query
                ? "No matching projects"
                : search.archived
                  ? "No archived projects"
                  : "No projects"
            }
            description="Projects gather tasks, chats, documents and files around one goal."
          />
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
      {creating && (
        <ProjectForm
          title="New project"
          onClose={() => setCreating(false)}
          save={async (input) => {
            const project = await read(
              await api.projects.$post({
                param: { workspaceId },
                json: {
                  title: input.title,
                  repositoryUrl: input.repositoryUrl || undefined,
                },
              }),
            );
            await invalidate();
            await navigate({
              to: "/projects/$projectId",
              params: { projectId: project.id },
            });
          }}
        />
      )}
    </Page>
  );
}
