import {
  RiAddLine,
  RiArchiveLine,
  RiCalendarScheduleLine,
  RiChat1Line,
  RiCodeSSlashLine,
  RiEditLine,
  RiLinkM,
  RiMoreLine,
  RiPauseCircleLine,
  RiPlayLine,
  RiRobot3Line,
  RiShapesLine,
  RiUserLine,
} from "@remixicon/react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { useRef, useState } from "react";
import { Timeline, TimelineItem } from "@/components/activity";
import { ConfigurationChoice } from "@/components/agents-configuration-choice";
import { DetailView, Section } from "@/components/detail";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  NoResults,
} from "@/components/filters";
import { FloatingChat, useAskAgent } from "@/components/floating-chat";
import { IconAction } from "@/components/icon-action";
import { ListGroup } from "@/components/list-group";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { type Schedule, ScheduleEditor } from "@/components/schedules-editor";
import { type Look, People } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

const kinds: Record<Schedule["type"], Look> = {
  prompt: { label: "Prompt", icon: RiChat1Line },
  script: { label: "Script", icon: RiCodeSSlashLine },
};
const states: Record<Schedule["status"], Look> = {
  enabled: { label: "Enabled", icon: RiPlayLine },
  disabled: { label: "Disabled", icon: RiPauseCircleLine },
  archived: { label: "Archived", icon: RiArchiveLine },
};
const order: Schedule["status"][] = ["enabled", "disabled", "archived"];
export type SchedulesSearch = {
  type?: Schedule["type"];
  agent?: string;
  owner?: string;
  status?: Schedule["status"];
  query?: string;
  sort?: "title" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
  after?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateSchedulesSearch(
  search: Record<string, unknown>,
): SchedulesSearch {
  const string = (value: unknown, max: number) =>
    typeof value === "string" && value.length > 0 && value.length <= max
      ? value
      : undefined;
  const sort =
    search.sort === "title" ||
    search.sort === "createdAt" ||
    search.sort === "updatedAt"
      ? search.sort
      : undefined;
  return {
    type:
      search.type === "prompt" || search.type === "script"
        ? search.type
        : undefined,
    agent:
      typeof search.agent === "string" && uuid.test(search.agent)
        ? search.agent
        : undefined,
    owner: string(search.owner, 128),
    status:
      search.status === "enabled" ||
      search.status === "disabled" ||
      search.status === "archived"
        ? search.status
        : undefined,
    query: string(search.query, 200),
    sort,
    order:
      sort && (search.order === "asc" || search.order === "desc")
        ? search.order
        : undefined,
    after: string(search.after, 4096),
  };
}

export function SchedulesPage({ search }: { search: SchedulesSearch }) {
  const { api, workspaceId, user, workspace } = useWorkspace();
  const directory = useDirectory();
  const navigate = useNavigate({ from: "/schedules" });
  const [creating, setCreating] = useState(false);
  const writer = workspace.role !== "viewer";
  const list = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedules", search],
    initialPageParam: search.after,
    queryFn: async ({ pageParam }) =>
      read(
        await api.schedules.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: search.sort ?? "title",
            order: search.order ?? "asc",
            after: pageParam,
            type: search.type,
            agentId: search.agent,
            ownerId: search.owner === "me" ? user.id : search.owner,
            status: search.status,
            query: search.query,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const visible = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filters: FilterDef<"type" | "agent" | "owner" | "status">[] = [
    { key: "type", label: "Type", icon: RiShapesLine, options: kinds },
    {
      key: "status",
      label: "State",
      icon: RiCalendarScheduleLine,
      options: states,
    },
    {
      key: "agent",
      label: "Agent",
      icon: RiRobot3Line,
      people: true,
      options: {
        ...(search.agent
          ? { [search.agent]: { label: "Selected Agent", icon: RiRobot3Line } }
          : {}),
        ...Object.fromEntries(
          directory.agents.map((agent) => [
            agent.id,
            { label: agent.title, icon: RiRobot3Line },
          ]),
        ),
      },
    },
    {
      key: "owner",
      label: "Owner",
      icon: RiUserLine,
      people: true,
      options: {
        ...(search.owner && search.owner !== "me"
          ? { [search.owner]: { label: "Selected owner", icon: RiUserLine } }
          : {}),
        me: { label: "Me", icon: RiUserLine },
        ...Object.fromEntries(
          directory.members
            .filter((member) => member.userId !== user.id)
            .map((member) => [
              member.userId,
              { label: member.name, icon: RiUserLine },
            ]),
        ),
      },
    },
  ];
  const change = (key: keyof SchedulesSearch, value: string | undefined) =>
    navigate({
      search: (previous) => ({ ...previous, [key]: value, after: undefined }),
    });
  const clear = () => navigate({ search: {} });
  return (
    <Page
      title="Schedules"
      width="wide"
      floating={<FloatingChat about="your schedules" />}
      actions={
        <>
          <FilterMenu filters={filters} values={search} onChange={change} />
          {writer && (
            <IconAction
              label="New schedule"
              icon={RiAddLine}
              onClick={() => setCreating(true)}
            />
          )}
        </>
      }
    >
      <FilterBar
        filters={filters}
        values={search}
        onChange={change}
        onClear={clear}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search schedules by whole words"
          placeholder="Search by whole words"
          maxLength={200}
          value={search.query ?? ""}
          onChange={(event) => change("query", event.target.value || undefined)}
          className="max-w-xs"
        />
        <ConfigurationChoice
          label="Sort schedules"
          value={search.sort ?? "title"}
          options={{
            title: "Title",
            createdAt: "Created",
            updatedAt: "Updated",
          }}
          onChange={(value) => change("sort", value)}
        />
        <ConfigurationChoice
          label="Sort order"
          value={search.order ?? "asc"}
          options={{ asc: "Ascending", desc: "Descending" }}
          onChange={(value) =>
            navigate({
              search: (previous) => ({
                ...previous,
                sort: previous.sort ?? "title",
                order: value,
                after: undefined,
              }),
            })
          }
        />
      </div>
      <QueryState
        pending={list.isPending}
        error={list.error ?? directory.error}
        retry={() => {
          void list.refetch();
          void directory.agentsQuery.refetch();
          void directory.membersQuery.refetch();
        }}
      />
      {list.data && visible.length === 0 ? (
        search.type ||
        search.agent ||
        search.owner ||
        search.status ||
        search.query ||
        search.after ? (
          <NoResults what="schedules" onClear={clear} />
        ) : (
          <EmptyPage
            icon={RiCalendarScheduleLine}
            title="No schedules"
            description="Run a prompt or script and post the result to an existing Chat."
          >
            {writer && (
              <Button onClick={() => setCreating(true)}>New schedule</Button>
            )}
          </EmptyPage>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {order.map((status) => (
            <ListGroup
              key={status}
              look={states[status]}
              count={visible.filter((item) => item.status === status).length}
              defaultOpen={status !== "archived"}
            >
              {visible
                .filter((item) => item.status === status)
                .map((schedule) => (
                  <ScheduleRow key={schedule.id} schedule={schedule} />
                ))}
            </ListGroup>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading" : "More schedules"}
        </Button>
      )}
      <ScheduleEditor
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) =>
          navigate({ to: "/schedules/$scheduleId", params: { scheduleId: id } })
        }
      />
    </Page>
  );
}

export function ScheduleRow({
  schedule,
  grouped = true,
  when,
}: {
  schedule: Schedule;
  grouped?: boolean;
  when?: string;
}) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const navigate = useNavigate();
  const ask = useAskAgent();
  const canEdit = schedule.ownerId === user.id && workspace.role !== "viewer";
  const mutation = useMutation({
    mutationFn: async () =>
      read(
        await api.schedules[":id"].$patch({
          param: { workspaceId, id: schedule.id },
          json: {
            editToken: schedule.editToken,
            status: schedule.status === "archived" ? "disabled" : "archived",
          },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      toast.success(
        schedule.status === "archived"
          ? "Schedule restored disabled"
          : "Schedule archived",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const look = states[schedule.status];
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <Item
          size="xs"
          render={
            <Link
              to="/schedules/$scheduleId"
              params={{ scheduleId: schedule.id }}
            />
          }
        >
          {grouped && <span className="size-3.5 shrink-0" aria-hidden />}
          <ItemMedia variant="icon">
            <look.icon aria-label={look.label} />
          </ItemMedia>
          <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-2">
            <ItemTitle>{schedule.title}</ItemTitle>
            <People ids={[schedule.ownerId, schedule.agentId]} />
          </ItemContent>
          <ItemActions>
            <span className="w-44 text-right text-xs text-muted-foreground">
              {when ??
                (schedule.cron
                  ? `${schedule.cron} · ${schedule.timezone}`
                  : "Manual only")}
            </span>
          </ItemActions>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuGroup>
          <ContextMenuItem
            onClick={() =>
              navigate({
                to: "/schedules/$scheduleId",
                params: { scheduleId: schedule.id },
              })
            }
          >
            Open
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => ask(`About the schedule “${schedule.title}”, `)}
          >
            Ask about it
          </ContextMenuItem>
          <ContextMenuItem onClick={() => copyScheduleLink(schedule.id)}>
            Copy link
          </ContextMenuItem>
          {canEdit && (
            <ContextMenuItem
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {schedule.status === "archived" ? "Restore disabled" : "Archive"}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function copyScheduleLink(id: string) {
  try {
    await navigator.clipboard.writeText(`${location.origin}/schedules/${id}`);
    toast.success("Link copied");
  } catch {
    toast.error("Unable to copy the link.");
  }
}

export function SchedulePage({ scheduleId }: { scheduleId: string }) {
  const { api, workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "schedule", scheduleId],
    queryFn: async () =>
      read(
        await api.schedules[":id"].$get({
          param: { workspaceId, id: scheduleId },
        }),
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
    <ScheduleView
      key={query.data.id}
      schedule={query.data}
      reload={query.refetch}
    />
  );
}

function ScheduleView({
  schedule,
  reload,
}: {
  schedule: Schedule;
  reload: () => unknown;
}) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const directory = useDirectory();
  const [editing, setEditing] = useState(false);
  const [manualRunId, setManualRunId] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const canEdit = schedule.ownerId === user.id && workspace.role !== "viewer";
  const update = useMutation({
    mutationFn: async (status: Schedule["status"]) =>
      read(
        await api.schedules[":id"].$patch({
          param: { workspaceId, id: schedule.id },
          json: { editToken: schedule.editToken, status },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      toast.success("Schedule saved");
    },
  });
  const run = useMutation({
    mutationFn: async () => {
      requestId.current ??= crypto.randomUUID();
      return read(
        await api.schedules[":id"].run.$post({
          param: { workspaceId, id: schedule.id },
          json: { requestId: requestId.current },
        }),
      );
    },
    onSuccess: async (result) => {
      setManualRunId(result.id);
      requestId.current = undefined;
      await invalidate();
      toast.success("Run admitted");
    },
  });
  const history = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedule-history", schedule.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.schedules[":id"].history.$get({
          param: { workspaceId, id: schedule.id },
          query: {
            limit: "100",
            sort: "receivedAt",
            order: "desc",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const busy = update.isPending || run.isPending;
  const state = states[schedule.status];
  const kind = kinds[schedule.type];
  const chat = useQuery({
    queryKey: ["workspace", workspaceId, "chat", schedule.chatId],
    queryFn: async () =>
      read(
        await api.chats[":id"].$get({
          param: { workspaceId, id: schedule.chatId },
        }),
      ),
  });
  return (
    <>
      <DetailView
        parent={{
          label: "Schedules",
          icon: RiCalendarScheduleLine,
          link: <Link to="/schedules" search={{}} />,
        }}
        current={state}
        title={schedule.title}
        type="schedule"
        archives
        people={<People ids={[schedule.ownerId, schedule.agentId]} />}
        ask={<FloatingChat about="this schedule" />}
        panel={
          <>
            <Section title="Properties">
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <state.icon />
                  {state.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <kind.icon />
                  {kinds[schedule.type].label}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <RiCalendarScheduleLine />
                  <span>
                    {schedule.cron
                      ? `${schedule.cron} · ${schedule.timezone}`
                      : "Manual only"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {canEdit && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    disabled={busy}
                    onClick={() => setEditing(true)}
                  >
                    <RiEditLine />
                    Edit properties
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </Section>
            <Section title="Chat">
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <Link
                      to="/chats/$chatId"
                      params={{ chatId: schedule.chatId }}
                    />
                  }
                >
                  <RiChat1Line />
                  {chat.data?.title ?? "Output Chat"}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <QueryState
                pending={chat.isPending}
                error={chat.error}
                retry={chat.refetch}
              />
            </Section>
          </>
        }
        actions={
          canEdit &&
          schedule.status !== "archived" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run.mutate()}
            >
              <RiPlayLine data-icon="inline-start" />
              {run.isPending
                ? "Admitting"
                : run.error
                  ? "Retry Run"
                  : "Run now"}
            </Button>
          )
        }
        more={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More" />
              }
            >
              <RiMoreLine />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => copyScheduleLink(schedule.id)}>
                  <RiLinkM />
                  Copy link
                </DropdownMenuItem>
                {canEdit && (
                  <>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => setEditing(true)}
                    >
                      <RiEditLine />
                      Edit schedule
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() =>
                        update.mutate(
                          schedule.status === "archived"
                            ? "disabled"
                            : "archived",
                        )
                      }
                    >
                      <RiArchiveLine />
                      {schedule.status === "archived"
                        ? "Restore disabled"
                        : "Archive"}
                    </DropdownMenuItem>
                    {schedule.status !== "archived" && (
                      <DropdownMenuItem
                        disabled={busy}
                        onClick={() =>
                          update.mutate(
                            schedule.status === "enabled"
                              ? "disabled"
                              : "enabled",
                          )
                        }
                      >
                        {schedule.status === "enabled" ? "Disable" : "Enable"}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <QueryState
          error={update.error ?? run.error ?? directory.error}
          retry={() => {
            void reload();
            void directory.membersQuery.refetch();
          }}
        />
        {run.error && (
          <p>
            Retry uses the same admission request until Otto acknowledges it.
            Check the output Chat if the outcome is uncertain.
          </p>
        )}
        {schedule.type === "script" ? (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
            {schedule.body}
          </pre>
        ) : (
          <p className="whitespace-pre-wrap">{schedule.body}</p>
        )}
        {manualRunId && (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium">Manual Run</h2>
            <ScheduleRun id={manualRunId} canControl={canEdit} />
          </section>
        )}
        <section className="flex flex-col gap-5">
          <h2 className="text-base font-medium">Delivery history</h2>
          <QueryState
            pending={history.isPending}
            error={history.error}
            retry={history.refetch}
          />
          {history.data?.pages.every((page) => page.items.length === 0) && (
            <p className="text-muted-foreground">
              No scheduled deliveries yet.
            </p>
          )}
          <Timeline>
            {history.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <TimelineItem key={item.id}>
                  <Card size="sm">
                    <CardContent>
                      <p>
                        {item.outcome} ·{" "}
                        {new Date(item.receivedAt).toLocaleString()}
                      </p>
                      {item.runId && (
                        <ScheduleRun id={item.runId} canControl={canEdit} />
                      )}
                    </CardContent>
                  </Card>
                </TimelineItem>
              ))}
          </Timeline>
          {history.hasNextPage && (
            <Button
              variant="outline"
              className="self-start"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              More history
            </Button>
          )}
        </section>
      </DetailView>
      <ScheduleEditor
        open={editing}
        onOpenChange={setEditing}
        schedule={schedule}
      />
    </>
  );
}

function ScheduleRun({ id, canControl }: { id: string; canControl: boolean }) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "run", id],
    queryFn: async () =>
      read(await api.runs[":id"].$get({ param: { workspaceId, id } })),
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "launching", "running"].includes(query.state.data.state)
        ? 2000
        : false,
  });
  const stop = useMutation({
    mutationFn: async () =>
      read(await api.runs[":id"].stop.$post({ param: { workspaceId, id } })),
    onSuccess: async () => {
      await invalidate();
      toast.success("Stop acknowledged");
    },
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
    <div className="flex flex-col gap-2">
      <p>
        {query.data.state}
        {query.data.outcome ? ` · ${query.data.outcome}` : ""}
      </p>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="compact"
          nativeButton={false}
          render={
            <Link to="/chats/$chatId" params={{ chatId: query.data.chatId }} />
          }
        >
          Open output Chat
        </Button>
        {canControl &&
          ["queued", "launching", "running", "uncertain"].includes(
            query.data.state,
          ) && (
            <Button
              variant="outline"
              size="compact"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              {stop.isPending ? "Stopping" : "Stop Run"}
            </Button>
          )}
      </div>
      <QueryState error={stop.error ?? query.error} retry={query.refetch} />
    </div>
  );
}
