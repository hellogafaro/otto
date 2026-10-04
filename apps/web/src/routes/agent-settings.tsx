import { RiMoreLine } from "@remixicon/react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Textarea } from "@workspace/ui/components/textarea";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { ConfigurationChoice } from "@/components/agents-configuration-choice";
import { AgentSkills } from "@/components/agents-skills";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { Group, Row } from "@/features/settings/controls";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

type Agent = InferResponseType<(typeof workspaceApi.agents)[":id"]["$get"]>;

export function AgentSettingsPage({ agentId }: { agentId: string }) {
  const { api, workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "agent", agentId],
    queryFn: async () =>
      read(
        await api.agents[":id"].$get({ param: { workspaceId, id: agentId } }),
      ),
  });
  if (!query.data)
    return (
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
    );
  return (
    <AgentSettings
      key={query.data.id}
      agent={query.data}
      reload={query.refetch}
    />
  );
}

function AgentSettings({
  agent,
  reload,
}: {
  agent: Agent;
  reload: () => unknown;
}) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const directory = useDirectory();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editingPending, setEditingPending] = useState(false);
  const writer = workspace.role !== "viewer";
  const canEdit = agent.createdBy === user.id && writer;
  const archive = useMutation({
    mutationFn: async () =>
      read(
        await api.agents[":id"].archive.$post({
          param: { workspaceId, id: agent.id },
          json: { archived: !agent.archived },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      toast.success(agent.archived ? "Agent restored" : "Agent archived");
    },
  });
  return (
    <Page
      title={agent.title}
      actions={
        canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More"
                  disabled={archive.isPending}
                />
              }
            >
              <RiMoreLine />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => archive.mutate()}>
                  {agent.archived ? "Restore" : "Archive"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <QueryState
        error={archive.error ?? directory.error}
        retry={() => {
          void reload();
          void directory.membersQuery.refetch();
        }}
      />
      <div className="flex flex-col gap-8">
        <Group title="Profile">
          <Row title="Title">{agent.title}</Row>
          <Row title="Who can use it">
            {agent.visibility === "user" ? "Only you" : "Workspace"}
          </Row>
          <Row
            title="Project"
            description="Project scope is set when an agent is created."
          >
            {agent.projectId
              ? (directory.projects.find(
                  (project) => project.id === agent.projectId,
                )?.title ?? "Unavailable project")
              : "Workspace"}
          </Row>
          <Row title="State">{agent.archived ? "Archived" : "Active"}</Row>
        </Group>
        <Group
          title="Instructions"
          description="Added to every run of this agent."
        >
          <p className="px-4 py-3 whitespace-pre-wrap">
            {agent.instructions || "No instructions"}
          </p>
        </Group>
        <Group title="Model">
          <Row
            title="Account"
            description="Runs use this exact account; no fallback."
          >
            {agent.subscriptionId ? (
              <AccountTitle id={agent.subscriptionId} />
            ) : (
              "No account selected"
            )}
          </Row>
          <Row title="Model">{agent.model}</Row>
        </Group>
        {canEdit && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setEditing(true)}
          >
            Edit agent
          </Button>
        )}
        {editing && (
          <Dialog
            open
            onOpenChange={(open, details) => {
              if (!open && editingPending) details.cancel();
              else if (!open) setEditing(false);
            }}
          >
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit agent</DialogTitle>
              </DialogHeader>
              <AgentConfiguration
                key={agent.id}
                agent={agent}
                onPendingChange={setEditingPending}
                onCancel={() => setEditing(false)}
                onSaved={() => setEditing(false)}
              />
            </DialogContent>
          </Dialog>
        )}
        <AgentSkills
          selected={agent.skillIds}
          projectId={agent.projectId}
          canManage={writer}
        />
        <Group
          title="Connections"
          description="Connection owners grant specific resources, operations and audiences. Agent visibility does not grant access."
        >
          <Row title="Manage grants">
            <Button
              variant="outline"
              size="compact"
              nativeButton={false}
              render={
                <Link
                  to="/settings/$section"
                  params={{ section: "connections" }}
                />
              }
            >
              Connections
            </Button>
          </Row>
        </Group>
        <Button
          variant="ghost"
          className="self-start"
          onClick={() =>
            navigate({
              to: "/settings/$section",
              params: { section: "agents" },
            })
          }
        >
          All agents
        </Button>
      </div>
    </Page>
  );
}

function AccountTitle({ id }: { id: string }) {
  const { api, workspaceId } = useWorkspace();
  const account = useQuery({
    queryKey: ["workspace", workspaceId, "subscription", id],
    queryFn: async () =>
      read(await api.subscriptions[":id"].$get({ param: { workspaceId, id } })),
  });
  return account.data ? (
    <span>
      {account.data.title} · {account.data.status}
    </span>
  ) : (
    <QueryState
      pending={account.isPending}
      error={account.error}
      retry={account.refetch}
    />
  );
}

/** Settings lane can mount this stock dialog for creation without inventing a default Agent. */
export function AgentCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && pending) details.cancel();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
        </DialogHeader>
        {open && (
          <AgentConfiguration
            onPendingChange={setPending}
            onCancel={() => onOpenChange(false)}
            onSaved={(id) => {
              onOpenChange(false);
              onCreated?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentConfiguration({
  agent: initialAgent,
  onCancel,
  onSaved,
  onPendingChange,
}: {
  agent?: Agent;
  onPendingChange?: (pending: boolean) => void;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const directory = useDirectory();
  const [agent] = useState(initialAgent);
  const [title, setTitle] = useState(agent?.title ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [visibility, setVisibility] = useState<"user" | "workspace">(
    agent?.visibility ?? "user",
  );
  const [projectId, setProjectId] = useState(agent?.projectId ?? "");
  const [subscriptionId, setSubscriptionId] = useState(
    agent?.subscriptionId ?? "",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [skillIds, setSkillIds] = useState(agent?.skillIds ?? []);
  const projects = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "agent-project-choices"],
    enabled: !agent,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.projects.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const subscriptions = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "agent-accounts"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.subscriptions.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const models = useQuery({
    queryKey: ["workspace", workspaceId, "account-models", subscriptionId],
    enabled: !!subscriptionId,
    retry: false,
    queryFn: async () =>
      read(
        await api.subscriptions[":id"].models.$get({
          param: { workspaceId, id: subscriptionId },
        }),
      ),
  });
  const skills = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "agent-selectable-skills"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.skills.$get({
          param: { workspaceId },
          query: {
            archived: "false",
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (agent)
        return read(
          await api.agents[":id"].$patch({
            param: { workspaceId, id: agent.id },
            json: {
              title,
              instructions,
              visibility,
              subscriptionId: subscriptionId || null,
              model,
              skillIds:
                JSON.stringify(skillIds.slice().sort()) ===
                JSON.stringify(agent.skillIds.slice().sort())
                  ? undefined
                  : skillIds,
              editToken: agent.editToken,
            },
          }),
        );
      const result = await read(
        await api.agents.$post({
          param: { workspaceId },
          json: {
            title,
            instructions,
            visibility,
            projectId: projectId || undefined,
            subscriptionId: subscriptionId || undefined,
            model,
            skillIds,
          },
        }),
      );
      return result.agent;
    },
    onSuccess: async (result) => {
      await invalidate();
      toast.success(agent ? "Agent saved" : "Agent created");
      onSaved(result.id);
    },
  });
  useEffect(() => {
    onPendingChange?.(mutation.isPending);
  }, [mutation.isPending, onPendingChange]);
  const accounts =
    subscriptions.data?.pages.flatMap((page) => page.items) ?? [];
  const skillList = skills.data?.pages.flatMap((page) => page.items) ?? [];
  const savedAccount = agent?.subscriptionId === subscriptionId;
  const modelUnchanged = savedAccount && model === agent?.model;
  // An unchanged saved configuration may be edited even while its gateway is unavailable.
  const modelValid = !subscriptionId
    ? !!model.trim()
    : modelUnchanged || !!models.data?.items.some((item) => item.id === model);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <fieldset
        disabled={mutation.isPending}
        className="flex min-w-0 flex-col gap-5"
      >
        <Group title="Profile">
          <Row title="Title">
            <Input
              aria-label="Agent title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Row>
          <Row title="Who can use it">
            <ConfigurationChoice
              label="Visibility"
              value={visibility}
              options={{ user: "Only you", workspace: "Workspace" }}
              onChange={setVisibility}
            />
          </Row>
          {!agent && (
            <Row title="Project">
              <ConfigurationChoice
                label="Project"
                value={projectId}
                options={{
                  "": "Workspace",
                  ...Object.fromEntries(
                    (
                      projects.data?.pages.flatMap((page) => page.items) ?? []
                    ).map((project) => [project.id, project.title]),
                  ),
                }}
                onChange={setProjectId}
                disabled={projects.isPending}
              />
              {projects.hasNextPage && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={projects.isFetchingNextPage}
                  onClick={() => projects.fetchNextPage()}
                >
                  More projects
                </Button>
              )}
              <QueryState
                pending={projects.isPending}
                error={projects.error}
                retry={projects.refetch}
              />
            </Row>
          )}
        </Group>
        <Group title="Instructions">
          <Textarea
            aria-label="Agent instructions"
            maxLength={100000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            className="min-h-40"
          />
        </Group>
        <Group title="Model">
          <Row title="Account">
            <ConfigurationChoice
              label="Account"
              value={subscriptionId}
              options={{
                "": "No account (scripts only)",
                ...Object.fromEntries(
                  accounts
                    .filter(
                      (item) =>
                        item.status === "enabled" ||
                        item.id === agent?.subscriptionId,
                    )
                    .map((item) => [item.id, `${item.title} · ${item.status}`]),
                ),
              }}
              onChange={(id) => {
                setSubscriptionId(id);
                setModel("");
              }}
              disabled={subscriptions.isPending}
            />
          </Row>
          <QueryState
            pending={subscriptions.isPending}
            error={subscriptions.error}
            retry={subscriptions.refetch}
          />
          {subscriptions.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={subscriptions.isFetchingNextPage}
              onClick={() => subscriptions.fetchNextPage()}
            >
              More accounts
            </Button>
          )}
          {subscriptionId ? (
            <>
              <Row title="Model">
                <ConfigurationChoice
                  label="Model"
                  value={model}
                  options={{
                    ...(modelUnchanged ? { [model]: model } : {}),
                    ...Object.fromEntries(
                      models.data?.items.map((item) => [item.id, item.id]) ??
                        [],
                    ),
                  }}
                  onChange={setModel}
                  disabled={models.isPending || !!models.error}
                />
              </Row>
              <QueryState
                pending={models.isPending}
                error={models.error}
                retry={models.refetch}
              />
              {models.data?.items.length === 0 && (
                <p>No configured models are available for this account.</p>
              )}
            </>
          ) : (
            <Row
              title="Configured model ID"
              description="Required configuration; prompt runs also require an authorized account."
            >
              <Input
                aria-label="Configured model ID"
                required
                maxLength={200}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </Row>
          )}
        </Group>
        <Group
          title="Skills"
          description="Select up to 50 current skills. Archived or inaccessible selections can be removed."
        >
          <QueryState
            pending={skills.isPending}
            error={skills.error}
            retry={skills.refetch}
          />
          {skillList.map((skill) => (
            <Row
              key={skill.id}
              title={skill.title}
              media={
                <Checkbox
                  aria-label={`Select ${skill.title}`}
                  checked={skillIds.includes(skill.id)}
                  disabled={
                    !skillIds.includes(skill.id) && skillIds.length >= 50
                  }
                  onCheckedChange={(checked) =>
                    setSkillIds((ids) =>
                      checked
                        ? [...ids, skill.id]
                        : ids.filter((id) => id !== skill.id),
                    )
                  }
                />
              }
            />
          ))}
          {skillIds
            .filter((id) => !skillList.some((skill) => skill.id === id))
            .map((id) => (
              <Row key={id} title="Selected skill outside the loaded list">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setSkillIds((ids) => ids.filter((item) => item !== id))
                  }
                >
                  Remove
                </Button>
              </Row>
            ))}
          {skills.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={skills.isFetchingNextPage}
              onClick={() => skills.fetchNextPage()}
            >
              More skills
            </Button>
          )}
        </Group>
        <QueryState
          error={mutation.error ?? directory.error}
          retry={() => {
            void directory.projectsQuery.refetch();
          }}
        />
        {mutation.error && (
          <p>
            Close and reopen this editor to load the latest configuration before
            retrying a conflicting save.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !title.trim() || !modelValid || skills.isPending || !!skills.error
            }
          >
            {mutation.isPending ? "Saving" : "Save agent"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
