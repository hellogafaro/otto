import {
  type Actor,
  type ActivityEntry,
  type EnvironmentId,
  GENERAL_PROJECT_ID,
  type ProjectId,
  type TaskChanges,
  type WorkParticipant,
} from "@otto/contracts";
import { RiAttachment2, RiDeleteBinLine, RiEditLine, RiReplyLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { requestConfirmDialog } from "../../confirm-dialog";
import { useClientSettings } from "../../hooks/use-settings";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { activityEnvironment } from "../../state/activity";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestamp-format";
import ChatMarkdown from "../chat-markdown";
import { useLibraryFile, useLibraryUpload } from "../library/use-library";
import { useTaskCache } from "../../state/tasks";
import type { MessageReplyTarget } from "../chat/message-controls";
import { BotPromptComposer } from "../roster/bot-prompt-composer";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  activityEditDraft,
  activityMarkdown,
  activityPlainText,
  type MentionTarget,
  mentionTag,
  parseMentionHref,
  toActivityContent,
} from "./activity.logic";
import { useTaskPriorityLabel } from "./task-priority";
import { useTaskRepeatLabel } from "./task-repeat";
import { formatDuration } from "./work.logic";
import { WorkSectionHeader } from "./work-detail";
import { ParticipantAvatar, participantName, type WorkParticipants } from "./work-participants";
import { useWorkStatusLabel } from "./work-status";

/** Otto: the one mention look, a quiet info-tinted pill, for people and bots alike. */
const MENTION_CLASS_NAME =
  "rounded-sm bg-info/8 px-0.5 font-medium text-info-foreground dark:bg-info/16";

type Comment = Extract<ActivityEntry, { type: "comment" }>;

/**
 * Otto: a task's timeline, Shopify-style: the chat composer to leave a comment, then the
 * comments and what happened to the task, newest first.
 */
export function ActivitySection({
  environmentId,
  entity,
  projectId,
  refreshKey,
  participants,
  projects,
  currentPersonId,
}: {
  readonly environmentId: EnvironmentId;
  readonly entity: { readonly entityType: "task"; readonly entityId: string };
  /** The task's project, whose Library folder holds the comments' files. */
  readonly projectId: ProjectId | null;
  /** Changes whenever the task changes, so its new entries show up. */
  readonly refreshKey: string;
  readonly participants: WorkParticipants;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly currentPersonId: string | null;
}) {
  const { t } = useI18n();
  const tasks = useTaskCache(environmentId);
  const query = useEnvironmentQuery(activityEnvironment.list({ environmentId, input: entity }));
  const createComment = useAtomCommand(activityEnvironment.createComment);
  const { upload } = useLibraryUpload();
  const refreshRef = useRef(query.refresh);
  refreshRef.current = query.refresh;
  const firstKey = useRef(refreshKey);

  useEffect(() => {
    if (firstKey.current !== refreshKey) refreshRef.current();
  }, [refreshKey]);

  const targets: MentionTarget[] = [
    ...participants.people.map((person) => ({
      type: "person" as const,
      id: person.personId,
      label: person.displayName,
    })),
    ...participants.bots.map((bot) => ({ type: "bot" as const, id: bot.id, label: bot.name })),
    ...projects
      .filter((project) => project.id !== GENERAL_PROJECT_ID)
      .map((project) => ({
        type: "project" as const,
        id: project.id,
        label: project.title,
      })),
    ...[...tasks.values()].map((task) => ({
      type: "task" as const,
      id: task.id,
      label: task.title,
    })),
  ];

  const actorParticipant = (actor: Actor | null): WorkParticipant | null =>
    Match.value(actor).pipe(
      Match.when(null, () => null),
      Match.when({ type: "bot" }, (bot) => ({ kind: "bot" as const, botId: bot.id })),
      Match.orElse((person) => ({
        kind: "person" as const,
        personId: person.id,
        displayName:
          participants.people.find((candidate) => candidate.personId === person.id)?.displayName ??
          t("Someone"),
      })),
    );

  const entries = (query.data?.entries ?? []).toReversed();
  const [replyTo, setReplyTo] = useState<MessageReplyTarget | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} className="flex flex-col gap-3">
      <WorkSectionHeader label={t("Activity")} />
      <div className="px-4">
        <BotPromptComposer
          botName={t("Comment")}
          draftKey={`activity:${entity.entityType}:${entity.entityId}`}
          disabled={false}
          layout="inline"
          inputLabel={t("Leave a comment…")}
          submitLabel={t("Post comment")}
          mentionBots={participants.bots}
          mentionPeople={participants.people}
          mentionWork={environmentId}
          replyPreview={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSubmit={async (draft, attached) => {
            const reply =
              replyTo === null
                ? ""
                : `${mentionTag({ type: "comment", id: replyTo.messageId, label: replyTo.label })} `;

            const content = (reply + toActivityContent(draft, targets)).trim();

            const fileIds =
              attached.length > 0
                ? await upload(environmentId, attached, {
                    folderId: null,
                    ...(projectId ? { projectId } : {}),
                  })
                : [];

            if (content.length === 0 && fileIds.length === 0) return false;

            const result = await createComment({
              environmentId,
              input: { ...entity, content, fileIds },
            });

            if (!AsyncResult.isSuccess(result)) return false;

            setReplyTo(null);
            query.refresh();

            return true;
          }}
        />
      </div>
      {entries.length > 0 ? (
        <ol className="flex flex-col">
          {entries.map((entry) =>
            entry.type === "comment" ? (
              <CommentRow
                key={entry.id}
                environmentId={environmentId}
                comment={entry}
                author={actorParticipant(entry.actor)}
                participants={participants}
                targets={targets}
                own={entry.actor?.type === "person" && entry.actor.id === currentPersonId}
                onChanged={query.refresh}
                onReply={(target) => {
                  setReplyTo(target);
                  sectionRef.current?.querySelector("textarea")?.focus();
                }}
              />
            ) : (
              <EventRows
                key={entry.id}
                entry={entry}
                actor={actorParticipant(entry.actor)}
                participants={participants}
                projects={projects}
              />
            ),
          )}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * The timeline's vertical line, centered under the composer's + and each card's avatar (21px
 * in from the content edge), from the first row's middle to the last's.
 */
function TimelineLine() {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 start-6.75 flex w-5 justify-center group-first/row:top-1/2 group-last/row:bottom-1/2"
    >
      <span className="w-px bg-border" />
    </span>
  );
}

/** When a comment was last edited, as the Edited marker's tooltip says it. */
function EditedTime({ updatedAt }: { readonly updatedAt: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  return <>{formatChatTimestampTooltip(updatedAt, timestampFormat)}</>;
}

function EntryTime({ createdAt }: { readonly createdAt: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={createdAt} />}
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {formatDayAwareTimestamp(createdAt, timestampFormat)}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {formatChatTimestampTooltip(createdAt, timestampFormat)}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A comment's Markdown with mention pills, as stored in a comment. */
function ActivityContent({ content }: { readonly content: string }) {
  const navigate = useNavigate();

  return (
    <ChatMarkdown
      cwd={undefined}
      text={activityMarkdown(content)}
      lineBreaks
      parseRawHtml={false}
      className="text-13px text-foreground"
      renderLink={(href, children) => {
        const mention = parseMentionHref(href);

        if (mention === null) return null;

        if (mention.type === "task" || mention.type === "project") {
          return (
            <button
              type="button"
              className={MENTION_CLASS_NAME}
              onClick={() =>
                void (mention.type === "task"
                  ? navigate({ to: "/tasks/$taskId", params: { taskId: mention.id } })
                  : navigate({ to: "/projects/$projectId", params: { projectId: mention.id } }))
              }
            >
              @{children}
            </button>
          );
        }

        if (mention.type !== "comment") {
          return <span className={MENTION_CLASS_NAME}>@{children}</span>;
        }

        return (
          <button
            type="button"
            className={cn(MENTION_CLASS_NAME, "inline-flex items-center gap-0.5 align-bottom")}
            onClick={() =>
              document
                .getElementById(`activity-${mention.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            <RiReplyLine aria-hidden className="size-3.5" />
            {children}
          </button>
        );
      }}
    />
  );
}

/**
 * Otto: A comment card. Its author edits it in place (the history keeps the earlier text and
 * the card says Edited); anyone on the task deletes it, after a confirm.
 */
function CommentRow({
  environmentId,
  comment,
  author,
  participants,
  targets,
  own,
  onChanged,
  onReply,
}: {
  readonly environmentId: EnvironmentId;
  readonly comment: Comment;
  readonly author: WorkParticipant | null;
  readonly participants: WorkParticipants;
  readonly targets: ReadonlyArray<MentionTarget>;
  readonly own: boolean;
  readonly onChanged: () => void;
  readonly onReply: (target: MessageReplyTarget) => void;
}) {
  const { t } = useI18n();
  const authorName = author ? participantName(author, participants.allBots) : t("Someone");
  const deleteComment = useAtomCommand(activityEnvironment.deleteComment);
  const updateComment = useAtomCommand(activityEnvironment.updateComment);
  const [editing, setEditing] = useState<{ readonly prefix: string; draft: string } | null>(null);

  const remove = async () => {
    const confirmed = await requestConfirmDialog(t("Delete this comment?"), {
      variant: "destructive",
      confirmLabel: t("Delete"),
    });

    if (confirmed === false) return;

    const result = await deleteComment({ environmentId, input: { id: comment.id } });

    if (AsyncResult.isSuccess(result)) onChanged();
  };

  const save = async () => {
    if (editing === null) return;

    const content = (editing.prefix + toActivityContent(editing.draft, targets)).trim();

    if (content === comment.content) return setEditing(null);

    if (content.length === 0 && comment.fileIds.length === 0) return;

    const result = await updateComment({ environmentId, input: { id: comment.id, content } });

    if (!AsyncResult.isSuccess(result)) return;

    setEditing(null);
    onChanged();
  };

  return (
    <li id={`activity-${comment.id}`} className="group/row relative px-4 py-2">
      <TimelineLine />
      <div className="relative flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5">
        <div className="flex h-7 items-center gap-1">
          <span className="flex size-7 shrink-0 items-center justify-center">
            {author ? <ParticipantAvatar participant={author} bots={participants.allBots} /> : null}
          </span>
          <span className="min-w-0 truncate text-13px font-medium text-foreground">
            {authorName}
          </span>
          <span className="ms-1">
            <EntryTime createdAt={comment.createdAt} />
          </span>
          {comment.updatedAt ? (
            <Tooltip>
              <TooltipTrigger
                render={<span />}
                className="ms-1 shrink-0 text-xs text-muted-foreground"
              >
                {t("Edited")}
              </TooltipTrigger>
              <TooltipPopup side="top">
                <EditedTime updatedAt={comment.updatedAt} />
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <span className="ms-auto" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={t("Reply")}
                  onClick={() =>
                    onReply({
                      messageId: comment.id,
                      label: authorName,
                      text: activityPlainText(comment.content),
                    })
                  }
                />
              }
            >
              <RiReplyLine />
            </TooltipTrigger>
            <TooltipPopup side="top">{t("Reply")}</TooltipPopup>
          </Tooltip>
          {own && editing === null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    aria-label={t("Edit comment")}
                    onClick={() => setEditing(activityEditDraft(comment.content))}
                  />
                }
              >
                <RiEditLine />
              </TooltipTrigger>
              <TooltipPopup side="top">{t("Edit comment")}</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={t("Delete comment")}
                  onClick={() => void remove()}
                />
              }
            >
              <RiDeleteBinLine />
            </TooltipTrigger>
            <TooltipPopup side="top">{t("Delete comment")}</TooltipPopup>
          </Tooltip>
        </div>
        {editing !== null ? (
          <form
            className="flex flex-col gap-1.5 px-1 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Textarea
              autoFocus
              aria-label={t("Edit comment")}
              value={editing.draft}
              maxLength={20_000}
              onChange={(event) => setEditing({ ...editing, draft: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(null);
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            <div className="flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" size="sm">
                {t("Save")}
              </Button>
            </div>
          </form>
        ) : comment.content.length > 0 ? (
          <div className="px-1 pb-1">
            <ActivityContent content={comment.content} />
          </div>
        ) : null}
        {comment.fileIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1">
            {comment.fileIds.map((fileId) => (
              <CommentFile key={fileId} environmentId={environmentId} fileId={fileId} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A file attached to a comment: a document opens its page, any other file the Library's
 * lightbox in its folder; a file gone or hidden reads as deleted.
 */
function CommentFile({
  environmentId,
  fileId,
}: {
  readonly environmentId: EnvironmentId;
  readonly fileId: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { file, loading } = useLibraryFile(environmentId, fileId);

  if (loading) return <Skeleton className="h-6 w-24 rounded-md" />;

  return (
    <Button
      size="xs"
      variant="outline"
      disabled={file === null}
      onClick={() => {
        if (!file) return;

        void (file.type === "document"
          ? navigate({ to: "/library/$fileId", params: { fileId } })
          : navigate({
              to: "/library",
              search: { ...(file.folderId ? { folder: file.folderId } : {}), preview: file.id },
            }));
      }}
    >
      <RiAttachment2 />
      {file?.title ?? t("Deleted file")}
    </Button>
  );
}

/** One quiet line per thing that happened; an update that changed three fields is three lines. */
function EventRows({
  entry,
  actor,
  participants,
  projects,
}: {
  readonly entry: Exclude<ActivityEntry, Comment>;
  readonly actor: WorkParticipant | null;
  readonly participants: WorkParticipants;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}) {
  const { t } = useI18n();
  const statusLabel = useWorkStatusLabel();
  const repeatLabel = useTaskRepeatLabel();
  const priorityLabel = useTaskPriorityLabel();
  const name = actor === null ? t("Someone") : participantName(actor, participants.allBots);

  const names = (list: ReadonlyArray<WorkParticipant>) =>
    list.map((participant) => participantName(participant, participants.allBots)).join(", ");

  const changeLines = (changes: TaskChanges): ReadonlyArray<string> => [
    ...(changes.title
      ? [t("{name} renamed this task to {title}", { name, title: changes.title.to })]
      : []),
    ...(changes.status
      ? [
          t("{name} changed the status from {from} to {to}", {
            name,
            from: statusLabel(changes.status.from),
            to: statusLabel(changes.status.to),
          }),
        ]
      : []),
    ...(changes.owner ? [ownerLine(changes.owner.to)] : []),
    ...(changes.assignees ? assigneeLines(changes.assignees) : []),
    ...(changes.dueDate
      ? [
          changes.dueDate.to === null
            ? t("{name} removed the due date", { name })
            : t("{name} set the due date to {date}", { name, date: changes.dueDate.to }),
        ]
      : []),
    ...(changes.priority
      ? [
          changes.priority.to === null
            ? t("{name} removed the priority", { name })
            : t("{name} set the priority to {priority}", {
                name,
                priority: priorityLabel(changes.priority.to),
              }),
        ]
      : []),
    ...(changes.repeat
      ? [
          changes.repeat.to === null
            ? t("{name} stopped repeating this task", { name })
            : t("{name} set the repeat to {repeat}", {
                name,
                repeat: repeatLabel(changes.repeat.to),
              }),
        ]
      : []),
    ...(changes.projectId
      ? [
          t("{name} moved this task to {project}", {
            name,
            project:
              projects.find((project) => project.id === changes.projectId?.to)?.title ??
              t("another project"),
          }),
        ]
      : []),
    ...(changes.resources ? [t("{name} updated the resources", { name })] : []),
    ...(changes.description ? [t("{name} updated the description", { name })] : []),
  ];

  function ownerLine(owner: WorkParticipant | null) {
    if (owner === null) return t("{name} removed the owner", { name });

    const ownerName = participantName(owner, participants.allBots);

    return t("{name} made {owner} the owner", { name, owner: ownerName });
  }

  function assigneeLines(change: NonNullable<TaskChanges["assignees"]>) {
    const key = (participant: WorkParticipant) =>
      participant.kind === "bot" ? participant.botId : participant.personId;

    const before = new Set(change.from.map(key));
    const after = new Set(change.to.map(key));
    const added = change.to.filter((participant) => !before.has(key(participant)));
    const removed = change.from.filter((participant) => !after.has(key(participant)));

    return [
      ...(added.length > 0 ? [t("{name} assigned {people}", { name, people: names(added) })] : []),
      ...(removed.length > 0
        ? [t("{name} unassigned {people}", { name, people: names(removed) })]
        : []),
    ];
  }

  const personName = (personId: string | undefined) =>
    personId === undefined
      ? undefined
      : (participants.people.find((person) => person.personId === personId)?.displayName ??
        t("Someone"));

  const dayLabel = (date: string | undefined) => {
    if (date === undefined) return undefined;
    const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);

    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const loggedLine = (logged: Extract<ActivityEntry, { type: "time_logged" }>) => {
    const duration = formatDuration(logged.duration);
    const person = personName(logged.personId);
    const date = dayLabel(logged.date);

    // Otto: time a person logs for themself reads as before; someone else's names whose it is.
    const line =
      person !== undefined && !(actor?.kind === "person" && actor.personId === logged.personId)
        ? t("{name} logged {duration} for {person}", { name, duration, person })
        : t("{name} logged {duration}", { name, duration });

    return [line, date, logged.description]
      .filter((part) => part !== undefined && part.length > 0)
      .join(" · ");
  };

  const lines: ReadonlyArray<string> = Match.value(entry).pipe(
    Match.when({ type: "created" }, () => [
      actor === null ? t("Task created") : t("{name} created this task", { name }),
    ]),
    Match.when({ type: "changed" }, (changed) => changeLines(changed.changes)),
    Match.when({ type: "time_logged" }, (logged) => [loggedLine(logged)]),
    Match.when({ type: "time_deleted" }, (deleted) => [
      t("{name} deleted {duration} of {person}'s time", {
        name,
        duration: formatDuration(deleted.duration),
        person: personName(deleted.personId) ?? t("someone"),
      }),
    ]),
    Match.when({ type: "comment_updated" }, () => [t("{name} edited a comment", { name })]),
    Match.when({ type: "comment_deleted" }, () => [t("{name} deleted a comment", { name })]),
    Match.when({ type: "task_deleted" }, (deleted) => [
      t("{name} deleted the task {title}", { name, title: deleted.title }),
    ]),
    Match.exhaustive,
  );

  return lines.map((line) => (
    <li
      key={`${entry.id}:${line}`}
      className="group/row relative flex min-h-10 items-center gap-2 ps-6.75 pe-4 text-13px text-muted-foreground"
    >
      <TimelineLine />
      <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
        {actor ? (
          <ParticipantAvatar participant={actor} bots={participants.allBots} />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        )}
      </span>
      <span className="min-w-0 flex-1">{line}</span>
      <EntryTime createdAt={entry.createdAt} />
    </li>
  ));
}
