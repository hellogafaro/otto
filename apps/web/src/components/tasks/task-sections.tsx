import { RiCloseLine, RiLinkM, RiTimeLine } from "@remixicon/react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { Input } from "@workspace/ui/components/input";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import { NewItem, Section } from "@/components/detail";
import { QueryState } from "@/components/query-state";
import { formatDuration, shortDate } from "@/components/task-meta";
import { TaskPicker } from "@/components/tasks/task-form";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import type { Task, TaskLink, Timesheet } from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

export function TaskLinksSection({
  task,
  canWrite,
}: {
  task: Task;
  canWrite: boolean;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const links = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "task-links", task.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      read(
        await api.tasks[":id"].links.$get(
          {
            param: { workspaceId, id: task.id },
            query: { sort: "type", limit: "100", after: pageParam },
          },
          { init: { signal } },
        ),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });
  const remove = useMutation({
    mutationFn: async (linkId: string) =>
      read(
        await api.tasks[":id"].links[":linkId"].$delete({
          param: { workspaceId, id: task.id, linkId },
        }),
      ),
    onSuccess: () => invalidate(),
  });
  const items = links.error
    ? []
    : (links.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <Section title="Links" count={items.length}>
      <QueryState
        pending={links.isPending}
        error={links.error ?? remove.error}
        retry={links.refetch}
      />
      {items.map((link) => (
        <TaskLinkItem
          key={link.id}
          link={link}
          canRemove={canWrite && !remove.isPending}
          onRemove={() => remove.mutate(link.id)}
        />
      ))}
      {!links.isPending && !links.error && !items.length && (
        <SidebarMenuItem>
          <SidebarMenuButton disabled>No links</SidebarMenuButton>
        </SidebarMenuItem>
      )}
      {links.hasNextPage && (
        <NewItem
          label="Load more links"
          disabled={links.isFetchingNextPage}
          onClick={() => links.fetchNextPage()}
        />
      )}
      {canWrite && <NewItem label="New link" onClick={() => setAdding(true)} />}
      {adding && (
        <TaskLinkForm
          task={task}
          canWrite={canWrite}
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}

function TaskLinkItem({
  link,
  canRemove,
  onRemove,
}: {
  link: TaskLink;
  canRemove: boolean;
  onRemove(): void;
}) {
  const { api, workspaceId } = useWorkspace();
  const target = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "task-link-target",
      link.type,
      link.reference,
    ],
    queryFn: async ({ signal }) => {
      const param = { workspaceId, id: link.reference };
      const options = { init: { signal } };
      if (link.type === "document")
        return read(await api.documents[":id"].$get({ param }, options));
      if (link.type === "chat")
        return read(await api.chats[":id"].$get({ param }, options));
      if (link.type === "file")
        return read(await api.files[":id"].$get({ param }, options));
      return { title: link.reference };
    },
    retry: false,
  });
  const fileProject =
    target.data && "projectId" in target.data && target.data.projectId
      ? `&project=${encodeURIComponent(target.data.projectId)}`
      : "";
  const href =
    link.type === "url"
      ? /^https?:\/\//i.test(link.reference)
        ? link.reference
        : undefined
      : link.type === "file"
        ? `/library?open=${encodeURIComponent(link.reference)}${fileProject}`
        : `/${link.type === "document" ? "documents" : "chats"}/${encodeURIComponent(link.reference)}`;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        disabled={!href || !target.data || Boolean(target.error)}
        render={
          href && target.data && !target.error ? (
            <a
              href={href}
              aria-label={target.data.title}
              target={link.type === "url" ? "_blank" : undefined}
              rel="noopener noreferrer"
            >
              {target.data.title}
            </a>
          ) : undefined
        }
      >
        <RiLinkM />
        <span>
          {target.error
            ? "Link unavailable"
            : (target.data?.title ?? "Loading link")}
        </span>
      </SidebarMenuButton>
      {target.error && (
        <Button variant="ghost" size="xs" onClick={() => target.refetch()}>
          Retry
        </Button>
      )}
      {canRemove && (
        <SidebarMenuAction
          showOnHover
          aria-label="Remove task link"
          onClick={onRemove}
        >
          <RiCloseLine />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );
}

function TaskLinkForm({
  task,
  canWrite,
  onClose,
}: {
  task: Task;
  canWrite: boolean;
  onClose(): void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [type, setType] = useState<TaskLink["type"]>("url");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const [inProject, setInProject] = useState(true);
  const [archived, setArchived] = useState(false);
  const targets = useInfiniteQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "task-link-choices",
      task.projectId,
      type,
      search,
      inProject,
      archived,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const input = {
        param: { workspaceId },
        query: {
          projectId: inProject ? task.projectId : undefined,
          archived: archived ? ("true" as const) : ("false" as const),
          query: search || undefined,
          sort: "title" as const,
          limit: "100",
          after: pageParam,
        },
      };
      const options = { init: { signal } };
      if (type === "document")
        return read(await api.documents.$get(input, options));
      if (type === "chat") return read(await api.chats.$get(input, options));
      if (type === "file") return read(await api.files.$get(input, options));
      return { items: [], next: null };
    },
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: type !== "url",
    retry: false,
  });
  const add = useMutation({
    mutationFn: async () =>
      read(
        await api.tasks[":id"].links.$post({
          param: { workspaceId, id: task.id },
          json: { type, reference },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
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
          <DialogTitle>New link</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>Type</FieldLabel>
              <TaskPicker
                label="Link type"
                icon={RiLinkM}
                value={type}
                options={{
                  url: "URL",
                  document: "Document",
                  chat: "Chat",
                  file: "File",
                }}
                disabled={add.isPending}
                onChange={(value) => {
                  setType(value as TaskLink["type"]);
                  setReference("");
                  setSearch("");
                }}
              />
            </Field>
            {type === "url" ? (
              <Field>
                <FieldLabel htmlFor="task-link-url">URL</FieldLabel>
                <Input
                  id="task-link-url"
                  type="url"
                  pattern="https?://.*"
                  required
                  maxLength={2048}
                  value={reference}
                  disabled={add.isPending}
                  onChange={(event) => setReference(event.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field orientation="horizontal">
                  <Checkbox
                    id="task-link-project"
                    checked={inProject}
                    disabled={add.isPending}
                    onCheckedChange={(value) => {
                      setInProject(value === true);
                      setReference("");
                    }}
                  />
                  <FieldLabel htmlFor="task-link-project">
                    Only this project
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="task-link-archived"
                    checked={archived}
                    disabled={add.isPending}
                    onCheckedChange={(value) => {
                      setArchived(value === true);
                      setReference("");
                    }}
                  />
                  <FieldLabel htmlFor="task-link-archived">
                    Archived targets
                  </FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-link-search">
                    Search whole words
                  </FieldLabel>
                  <Input
                    id="task-link-search"
                    value={search}
                    maxLength={200}
                    disabled={add.isPending}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setReference("");
                    }}
                  />
                </Field>
                <QueryState
                  pending={targets.isPending}
                  error={targets.error}
                  retry={targets.refetch}
                />
                <Field>
                  <FieldLabel>Link target</FieldLabel>
                  <TaskPicker
                    label="Link target"
                    icon={RiLinkM}
                    value={reference}
                    options={Object.fromEntries(
                      targets.data?.pages.flatMap((page) =>
                        page.items.map((item) => [item.id, item.title]),
                      ) ?? [],
                    )}
                    disabled={add.isPending || targets.isPending}
                    onChange={setReference}
                  />
                </Field>
                {targets.hasNextPage && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={targets.isFetchingNextPage}
                    onClick={() => targets.fetchNextPage()}
                  >
                    Load more targets
                  </Button>
                )}
              </>
            )}
            <QueryState error={add.error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={add.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  add.isPending ||
                  !canWrite ||
                  !reference ||
                  (type !== "url" && Boolean(targets.error))
                }
                type="submit"
              >
                {add.isPending ? "Saving" : "Add link"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskTimeSection({
  task,
  canWrite,
}: {
  task: Task;
  canWrite: boolean;
}) {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const [editing, setEditing] = useState<Timesheet | "new">();
  const entries = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "task-timesheets", task.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      read(
        await api.timesheets.$get(
          {
            param: { workspaceId },
            query: {
              taskId: task.id,
              limit: "100",
              sort: "createdAt",
              order: "desc",
              after: pageParam,
            },
          },
          { init: { signal } },
        ),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });
  const items = entries.error
    ? []
    : (entries.data?.pages.flatMap((page) => page.items) ?? []);
  const total = items.reduce((sum, entry) => sum + entry.duration, 0);
  const remove = useMutation({
    mutationFn: async (id: string) =>
      read(await api.timesheets[":id"].$delete({ param: { workspaceId, id } })),
    onSuccess: () => invalidate(),
  });
  return (
    <Section
      title="Time"
      count={
        total
          ? `${formatDuration(total)}${entries.hasNextPage ? " loaded" : ""}`
          : undefined
      }
    >
      <QueryState
        pending={entries.isPending}
        error={entries.error ?? remove.error}
        retry={entries.refetch}
      />
      {items.map((entry) => (
        <TimeEntryItem
          key={entry.id}
          entry={entry}
          canEdit={canWrite && entry.createdBy === user.id && !remove.isPending}
          onEdit={() => setEditing(entry)}
          onDelete={() => remove.mutate(entry.id)}
        />
      ))}
      {!entries.isPending && !entries.error && !items.length && (
        <SidebarMenuItem>
          <SidebarMenuButton disabled>No time entries</SidebarMenuButton>
        </SidebarMenuItem>
      )}
      {entries.hasNextPage && (
        <NewItem
          label="Load more time entries"
          disabled={entries.isFetchingNextPage}
          onClick={() => entries.fetchNextPage()}
        />
      )}
      {canWrite && (
        <NewItem label="New time entry" onClick={() => setEditing("new")} />
      )}
      {editing && (
        <TimeEntryForm
          taskId={task.id}
          canWrite={canWrite}
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Section>
  );
}

function TimeEntryItem({
  entry,
  canEdit,
  onEdit,
  onDelete,
}: {
  entry: Timesheet;
  canEdit: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const { actorOf } = useDirectory();
  return (
    <SidebarMenuItem>
      <HoverCard>
        <HoverCardTrigger
          render={
            <SidebarMenuButton
              onClick={canEdit ? onEdit : undefined}
              aria-label={canEdit ? "Edit time entry" : "Time entry"}
            />
          }
        >
          <RiTimeLine />
          <span>
            {formatDuration(entry.duration)} ·{" "}
            {shortDate.format(new Date(entry.createdAt))}
          </span>
        </HoverCardTrigger>
        <HoverCardContent side="left" align="start">
          <span>
            {formatDuration(entry.duration)} by {actorOf(entry.createdBy).name}
          </span>
          <span>
            {new Date(entry.createdAt).toLocaleDateString("en", {
              dateStyle: "medium",
            })}
          </span>
          {entry.notes && (
            <span className="whitespace-pre-line">{entry.notes}</span>
          )}
        </HoverCardContent>
      </HoverCard>
      {canEdit && (
        <SidebarMenuAction
          showOnHover
          aria-label="Delete time entry"
          onClick={onDelete}
        >
          <RiCloseLine />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );
}

function TimeEntryForm({
  taskId,
  canWrite,
  entry,
  onClose,
}: {
  taskId: string;
  canWrite: boolean;
  entry?: Timesheet;
  onClose(): void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [duration, setDuration] = useState(String(entry?.duration ?? ""));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const json = { duration: Number(duration), notes: notes || null };
      if (entry)
        return read(
          await api.timesheets[":id"].$patch({
            param: { workspaceId, id: entry.id },
            json,
          }),
        );
      try {
        return await read(
          await api.timesheets.$post({
            param: { workspaceId },
            json: { ...json, taskId },
          }),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new Error(
          "Could not confirm whether this time entry was saved. Check the time list before submitting again.",
        );
      }
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>
            {entry ? "Edit time entry" : "New time entry"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-time-minutes">Minutes</FieldLabel>
              <Input
                id="task-time-minutes"
                type="number"
                min={1}
                max={2147483647}
                step={1}
                required
                value={duration}
                disabled={save.isPending}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-time-notes">Notes</FieldLabel>
              <Textarea
                id="task-time-notes"
                maxLength={4000}
                value={notes}
                disabled={save.isPending}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <QueryState error={save.error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  !canWrite ||
                  !Number.isInteger(Number(duration)) ||
                  Number(duration) < 1
                }
              >
                {save.isPending ? "Saving" : "Save time entry"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
