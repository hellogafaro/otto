import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Textarea } from "@workspace/ui/components/textarea";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { ConfigurationChoice } from "@/components/agents-configuration-choice";
import {
  hasUncertainMutationOutcome,
  isDeniedDomainRead,
} from "@/components/agents-schedules-mutation-safety";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

export type Schedule = InferResponseType<
  (typeof workspaceApi.schedules)[":id"]["$get"]
>;

export function ScheduleEditor({
  open,
  onOpenChange,
  schedule,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: Schedule;
  onSaved?: (id: string) => void;
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
          <DialogTitle>
            {schedule ? "Edit schedule" : "New schedule"}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <ScheduleForm
            onPendingChange={setPending}
            initial={schedule}
            cancel={() => onOpenChange(false)}
            done={(id) => {
              onOpenChange(false);
              onSaved?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  initial,
  cancel,
  done,
  onPendingChange,
}: {
  initial?: Schedule;
  onPendingChange: (pending: boolean) => void;
  cancel: () => void;
  done: (id: string) => void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const directory = useDirectory();
  // The editor keeps the token it opened with; background refetch cannot bypass a stale edit fence.
  const submitting = useRef(false);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [schedule] = useState(initial);
  const [title, setTitle] = useState(schedule?.title ?? "");
  const [body, setBody] = useState(schedule?.body ?? "");
  const [type, setType] = useState<"prompt" | "script">(
    schedule?.type ?? "prompt",
  );
  const [agentId, setAgentId] = useState(schedule?.agentId ?? "");
  const [chatId, setChatId] = useState(schedule?.chatId ?? "");
  const [taskId, setTaskId] = useState(schedule?.taskId ?? "");
  const [ownerId, setOwnerId] = useState(schedule?.ownerId ?? "");
  const [trigger, setTrigger] = useState(schedule?.cron ? "cron" : "manual");
  const [cron, setCron] = useState(schedule?.cron ?? "");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "UTC");
  const [status, setStatus] = useState<Schedule["status"]>(
    schedule?.status ?? "disabled",
  );
  const [agentSearch, setAgentSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const owners = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedule-owner-choices"],
    enabled: !!schedule,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "name", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const agents = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedule-agents", agentSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.agents.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: "title",
            query: agentSearch || undefined,
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const chats = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedule-chats", chatSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.chats.$get({
          param: { workspaceId },
          query: {
            archived: "false",
            limit: "100",
            sort: "title",
            query: chatSearch || undefined,
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const outputChat = useQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId],
    enabled: !!chatId,
    queryFn: async () =>
      read(await api.chats[":id"].$get({ param: { workspaceId, id: chatId } })),
  });
  const projectId = isDeniedDomainRead(outputChat.error)
    ? undefined
    : outputChat.data?.projectId;
  const tasks = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "schedule-tasks", projectId],
    enabled: !!projectId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.tasks.$get({
          param: { workspaceId },
          query: {
            projectId: projectId ?? "",
            limit: "100",
            sort: "title",
            archived: "false",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const input = {
        title,
        body,
        type,
        agentId,
        chatId,
        taskId: taskId || undefined,
        cron: trigger === "cron" ? cron : "",
        timezone,
        status,
      };
      if (schedule)
        return read(
          await api.schedules[":id"].$patch({
            param: { workspaceId, id: schedule.id },
            json: { ...input, editToken: schedule.editToken, ownerId },
          }),
        );
      return read(
        await api.schedules.$post({ param: { workspaceId }, json: input }),
      );
    },
    onError: (error) => {
      if (!schedule && hasUncertainMutationOutcome(error)) {
        setCreateUncertain(true);
        void invalidate();
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async (result) => {
      await invalidate();
      toast.success(schedule ? "Schedule saved" : "Schedule created");
      done(result.id);
    },
  });
  useEffect(
    () => onPendingChange(mutation.isPending),
    [mutation.isPending, onPendingChange],
  );
  let validTimezone = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    validTimezone = false;
  }
  const validCron = trigger !== "cron" || cron.trim().split(/\s+/).length === 5;
  const agentList = isDeniedDomainRead(agents.error)
    ? []
    : (agents.data?.pages.flatMap((page) => page.items) ?? []);
  const chatList = isDeniedDomainRead(chats.error)
    ? []
    : (chats.data?.pages.flatMap((page) => page.items) ?? []);
  const taskList = isDeniedDomainRead(tasks.error)
    ? []
    : (tasks.data?.pages.flatMap((page) => page.items) ?? []);
  const original = (id: string | undefined, label: string) =>
    id ? { [id]: label } : {};
  const statuses: Record<string, string> =
    schedule?.status === "archived"
      ? { archived: "Archived", disabled: "Restore disabled" }
      : { disabled: "Disabled", enabled: "Enabled", archived: "Archived" };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || createUncertain) return;
        submitting.current = true;
        onPendingChange(true);
        mutation.mutate();
      }}
    >
      <fieldset disabled={mutation.isPending}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="schedule-title">Title</FieldLabel>
            <Input
              id="schedule-title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Type</FieldLabel>
            <ConfigurationChoice
              label="Schedule type"
              value={type}
              options={{ prompt: "Prompt", script: "Script" }}
              onChange={setType}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-body">
              {type === "script" ? "Script" : "Prompt"}
            </FieldLabel>
            <Textarea
              id="schedule-body"
              required
              maxLength={100000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-40"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-agent-search">Agent</FieldLabel>
            <Input
              id="schedule-agent-search"
              placeholder="Find agent by whole words"
              maxLength={200}
              value={agentSearch}
              onChange={(event) => setAgentSearch(event.target.value)}
            />
            <ConfigurationChoice
              label="Agent"
              value={agentId}
              options={{
                "": "Choose an Agent",
                ...original(schedule?.agentId, "Current Agent"),
                ...Object.fromEntries(
                  agentList.map((agent) => [agent.id, agent.title]),
                ),
              }}
              onChange={setAgentId}
              disabled={agents.isPending}
            />
            <QueryState
              pending={agents.isPending}
              error={agents.error}
              retry={agents.refetch}
            />
            {agents.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={agents.isFetchingNextPage}
                onClick={() => agents.fetchNextPage()}
              >
                More agents
              </Button>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-chat-search">Output Chat</FieldLabel>
            <Input
              id="schedule-chat-search"
              placeholder="Find chat by whole words"
              maxLength={200}
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
            />
            <ConfigurationChoice
              label="Output Chat"
              value={chatId}
              options={{
                "": "Choose a Chat",
                ...original(schedule?.chatId, "Current output Chat"),
                ...Object.fromEntries(
                  chatList.map((chat) => [chat.id, chat.title]),
                ),
              }}
              onChange={(id) => {
                setChatId(id);
                if (!schedule?.taskId) setTaskId("");
              }}
              disabled={chats.isPending}
            />
            <FieldDescription>
              Project and output audience derive from this Chat. The Agent needs
              current participation before a Run can launch.
            </FieldDescription>
            <QueryState
              pending={chats.isPending || (!!chatId && outputChat.isPending)}
              error={chats.error ?? outputChat.error}
              retry={() => {
                void chats.refetch();
                void outputChat.refetch();
              }}
            />
            {chats.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={chats.isFetchingNextPage}
                onClick={() => chats.fetchNextPage()}
              >
                More chats
              </Button>
            )}
          </Field>
          {projectId && (
            <Field>
              <FieldLabel>Associated Task (optional)</FieldLabel>
              <ConfigurationChoice
                label="Associated Task"
                value={taskId}
                options={{
                  ...(!schedule?.taskId ? { "": "No Task association" } : {}),
                  ...original(
                    schedule?.taskId ?? undefined,
                    "Current associated Task",
                  ),
                  ...Object.fromEntries(
                    taskList.map((task) => [task.id, task.title]),
                  ),
                }}
                onChange={setTaskId}
                disabled={tasks.isPending}
              />
              <QueryState
                pending={tasks.isPending}
                error={tasks.error}
                retry={tasks.refetch}
              />
              {tasks.hasNextPage && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={tasks.isFetchingNextPage}
                  onClick={() => tasks.fetchNextPage()}
                >
                  More tasks
                </Button>
              )}
            </Field>
          )}
          {schedule && (
            <Field>
              <FieldLabel>Owner</FieldLabel>
              <ConfigurationChoice
                label="Schedule owner"
                value={ownerId}
                options={{
                  [schedule.ownerId]: directory.actorOf(schedule.ownerId).name,
                  ...Object.fromEntries(
                    (
                      (!isDeniedDomainRead(owners.error)
                        ? owners.data
                        : undefined
                      )?.pages.flatMap((page) => page.items) ?? []
                    )
                      .filter((member) => member.role !== "viewer")
                      .map((member) => [member.userId, member.name]),
                  ),
                }}
                onChange={setOwnerId}
                disabled={owners.isPending}
              />
              <QueryState
                pending={owners.isPending}
                error={owners.error}
                retry={owners.refetch}
              />
              {owners.hasNextPage && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={owners.isFetchingNextPage}
                  onClick={() => owners.fetchNextPage()}
                >
                  More owners
                </Button>
              )}
              <FieldDescription>
                The new owner must have current writer access to the output
                Chat.
              </FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel>Trigger</FieldLabel>
            <ConfigurationChoice
              label="Trigger"
              value={trigger}
              options={{ manual: "Manual only", cron: "Cron" }}
              onChange={setTrigger}
            />
          </Field>
          {trigger === "cron" && (
            <Field data-invalid={!validCron}>
              <FieldLabel htmlFor="schedule-cron">Cron expression</FieldLabel>
              <Input
                id="schedule-cron"
                required
                maxLength={100}
                aria-invalid={!validCron}
                placeholder="0 9 * * 1-5"
                value={cron}
                onChange={(event) => setCron(event.target.value)}
              />
              <FieldDescription>
                Five fields: minute, hour, day of month, month, day of week. The
                server validates the exact expression.
              </FieldDescription>
            </Field>
          )}
          <Field data-invalid={!validTimezone}>
            <FieldLabel htmlFor="schedule-timezone">Timezone</FieldLabel>
            <Input
              id="schedule-timezone"
              required
              maxLength={100}
              aria-invalid={!validTimezone}
              placeholder="Europe/Berlin"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>State</FieldLabel>
            <ConfigurationChoice
              label="Schedule state"
              value={status}
              options={statuses}
              onChange={(value) => setStatus(value as Schedule["status"])}
            />
            <FieldDescription>
              Disabled allows owner-authorized manual Runs. Archived blocks
              admission; restore leaves it disabled.
            </FieldDescription>
          </Field>
          <QueryState
            error={mutation.error ?? directory.error}
            retry={directory.membersQuery.refetch}
          />
          {createUncertain && (
            <p role="alert">
              Otto may have created this Schedule. Close and check the Schedules
              list before creating again.
            </p>
          )}
          {mutation.error && (
            <p>
              Input is retained. Close and reopen to reload the latest edit
              token after a conflict.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createUncertain ||
                !title.trim() ||
                !body.trim() ||
                !agentId ||
                !chatId ||
                !validCron ||
                !validTimezone ||
                !!outputChat.error
              }
            >
              {mutation.isPending ? "Saving" : "Save schedule"}
            </Button>
          </div>
        </FieldGroup>
      </fieldset>
    </form>
  );
}
