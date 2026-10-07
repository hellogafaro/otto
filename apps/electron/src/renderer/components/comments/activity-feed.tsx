/**
 * ActivityFeed - the activity of a task or a project (`entity`: `task:<id>`, `project:<id>`), for their pages under
 * the description (Otto v1's Activity): one chronological feed of events ("Maria changed the status from ○ Todo to
 * ✓ Done", a quiet line with the actor's small avatar; consecutive ones set closer, `layoutActivity`) and comments
 * (28px avatar, name in the transcript's colors, "You" for yours, time, "edited", the markdown with its mentions as
 * chips) along one hairline, oldest first; the newest 50 first, "{n} earlier" loads the 50 before. Then the comment
 * box: "Leave a comment", Attach (a file goes to the Library and its chip into the text) and Send. A comment is
 * sent, never autosaved: Send or ⌘/Ctrl+Enter, and a comment you wrote has a right-click menu (never a ⋯) with Edit
 * (in place, Save / Cancel) and Delete (asks first); events cannot be changed. Typing `@` opens a list of people; picking one
 * puts their token (`user:<id>`) in the text, which notifies them. Events never notify. New items show at once
 * here and, through the live push, for everyone else.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ChevronUp, Paperclip, Pencil, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@workspace/ui/components/context-menu'
import { Kbd } from '@workspace/ui/components/kbd'
import { messageAuthorColors } from '@workspace/ui/components/message'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/sonner'
import { Textarea } from '@workspace/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { getDateLocale } from '@otto/shared/i18n'
import { MAX_FILE_BYTES } from '@otto/shared/library/limits'
import { formatHotkeyDisplay } from '@/actions/registry'
import { useTranscriptPeople, type TranscriptPerson } from '@/components/app-shell/chat-message'
import { authorNameClass } from '@/components/app-shell/chat-transcript'
import { MENU_LIST, MENU_ROW, MENU_ROW_HIGHLIGHT, MENU_SURFACE } from '@/components/ui/menu-styles'
import { useEntityData } from '@/components/entities/entity-chip'
import { EntityText } from '@/components/entities/entity-text'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { useActivity } from '@/hooks/use-activity'
import { useProjects } from '@/hooks/use-projects'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { cn } from '@/lib/utils'
import { readFileAsBase64 } from '@/pages/library/library-items'
import { useDuration } from '@/pages/tasks/task-time-section'
import { statusLabelKey } from '@/pages/tasks/task-row'
import { shortTimeAgo } from '@/utils/session'
import type { ActivityEvent, Comment, TaskStatus } from '../../../shared/types'
import { assigneeChange, layoutActivity } from './activity-feed-model'
import { getMentionCandidates, getMentionQuery, insertMention, type MentionQuery } from './comment-mentions'

const SEND_KEY = formatHotkeyDisplay('mod+↵')

/**
 * One item on the timeline: the hairline runs from its marker (the avatar, the dot) to the next item's, under the
 * markers, which are ringed in the surface's color (`--activity-bg`, the card's unless the caller sets it).
 */
const ITEM = 'relative before:absolute before:top-3 before:-bottom-4 before:left-[13.5px] before:w-px before:bg-border last:before:hidden'

/** A failed comment write as one toast, by its error code. */
function commentError(t: (key: string) => string, code: string, fallback: string): string {
  if (code === 'conflict') return t('common.changedElsewhere')
  if (code === 'forbidden') return t('comments.forbidden')
  return t(fallback)
}

/**
 * A textarea that grows (up to 240px) with the `@` people list: ↑↓ move, Enter or Tab picks, Escape closes it.
 * Without the list open, ⌘/Ctrl+Enter submits and Escape cancels.
 */
function MentionTextarea({
  value,
  onValueChange,
  onSubmit,
  onCancel,
  className,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const listId = React.useId()
  const { members, me } = useWorkspaceMembers()
  const [mention, setMention] = React.useState<MentionQuery | null>(null)
  // The `@` the person closed with Escape: the list stays shut for it.
  const [dismissed, setDismissed] = React.useState<number | null>(null)
  const [index, setIndex] = React.useState(0)

  const candidates = mention ? getMentionCandidates(members.filter((member) => member.actor !== me), mention.query) : []
  const open = mention !== null && mention.start !== dismissed

  const track = (el: HTMLTextAreaElement) => {
    const next = getMentionQuery(el.value, el.selectionStart)
    if (next?.start !== mention?.start || next?.query !== mention?.query) setIndex(0)
    if (!next) setDismissed(null)
    setMention(next)
  }

  const pick = (actor: string) => {
    if (!mention) return
    const next = insertMention(value, mention, actor)
    onValueChange(next.text)
    setMention(null)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && mention) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (candidates.length) setIndex((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && candidates[index]) {
        event.preventDefault()
        pick(candidates[index]!.actor)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(mention.start)
        return
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSubmit()
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  // The list floats over the page under the box (above it when there is no room), as wide as the box up to 288px.
  // Measured in viewport pixels; the page may be zoomed (`html` zoom on small screens), so they are divided by it.
  const rect = open ? ref.current?.getBoundingClientRect() : undefined
  const zoom = rect ? parseFloat(getComputedStyle(document.documentElement).zoom) || 1 : 1
  const below = rect ? window.innerHeight - rect.bottom > 260 : true
  const position: React.CSSProperties | undefined = rect && {
    left: rect.left / zoom,
    width: Math.min(rect.width / zoom, 288),
    ...(below ? { top: (rect.bottom + 4) / zoom } : { bottom: (window.innerHeight - rect.top + 4) / zoom }),
  }
  const active = open && candidates[index] ? `${listId}-${index}` : undefined

  return (
    <>
      <Textarea
        ref={ref}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value)
          track(event.target)
        }}
        onSelect={(event) => track(event.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setMention(null)}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={active}
        className={cn('max-h-60 min-h-0', className)}
        {...props}
      />
      {open && position && createPortal(
        <div id={listId} role="listbox" aria-label={t('comments.mentionPeople')} style={position} className={cn(MENU_SURFACE, 'fixed z-50')}>
          <div className={MENU_LIST}>
            {candidates.length === 0 ? (
              <div className={cn(MENU_ROW, 'text-muted-foreground')}>{t('comments.noResults')}</div>
            ) : candidates.map((member, i) => (
              <div
                key={member.actor}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(member.actor)
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn(MENU_ROW, 'pl-1', i === index && MENU_ROW_HIGHLIGHT)}
              >
                <ActorAvatar actor={member.actor} name={member.name} />
                <span className="max-w-[70%] shrink-0 truncate">{member.name}</span>
                {member.email && member.email !== member.name && <span className="min-w-0 truncate text-muted-foreground">{member.email}</span>}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Send (28px primary, a spinner while it sends), its key in the tooltip; or the edit's Save. */
function SubmitButton({ label, pending, disabled, onClick }: { label: string; pending: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="compact" disabled={disabled} loading={pending} onClick={onClick} />}>
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <Kbd>{SEND_KEY}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** Uploads the picked files to the Library and gives their tokens (`library:<id>`); a failure toasts and is skipped. */
function useAttach() {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const attach = async (files: File[]): Promise<string[]> => {
    setPending(true)
    const tokens: string[] = []
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(t('library.tooLarge', { title: file.name }))
          continue
        }
        const data = await readFileAsBase64(file)
        const item = await window.electronAPI.createLibraryItem({ title: file.name, mime: file.type || 'application/octet-stream', content: { encoding: 'base64', data } })
        tokens.push(`library:${item.id}`)
      } catch {
        toast.error(t('library.uploadFailed', { title: file.name }))
      }
    }
    setPending(false)
    return tokens
  }
  return { attach, pending }
}

function CommentComposer({ onSend }: { onSend: (content: string) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [value, setValue] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const { attach, pending: attaching } = useAttach()
  const send = async () => {
    if (!value.trim() || pending || attaching) return
    setPending(true)
    const sent = await onSend(value)
    setPending(false)
    if (sent) setValue('')
  }
  const addFiles = async (files: File[]) => {
    const tokens = await attach(files)
    if (tokens.length) setValue((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${tokens.join(' ')} `)
  }
  return (
    <div className="flex flex-col gap-2">
      <MentionTextarea
        value={value}
        onValueChange={setValue}
        onSubmit={() => void send()}
        placeholder={t('comments.placeholder')}
        aria-label={t('comments.placeholder')}
        readOnly={pending}
      />
      <div className="flex items-center justify-between">
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-compact" aria-label={t('comments.attach')} loading={attaching} disabled={pending} onClick={() => fileRef.current?.click()} />}
          >
            {!attaching && <Paperclip />}
          </TooltipTrigger>
          <TooltipContent>{t('comments.attach')}</TooltipContent>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length) void addFiles(files)
          }}
        />
        <SubmitButton label={t('comments.send')} pending={pending} disabled={!value.trim() || attaching} onClick={() => void send()} />
      </div>
    </div>
  )
}

const Value = ({ children }: { children?: React.ReactNode }) => <span className="text-foreground">{children}</span>

/** A status with its icon, inline on the 20px line. */
function StatusValue({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex h-5 items-center gap-1 align-top text-foreground">
      <TaskStatusIcon status={status as TaskStatus} />
      {t(statusLabelKey(status as TaskStatus))}
    </span>
  )
}

/** People, each with their 16px avatar, comma separated. */
function PeopleValue({ actors }: { actors: string[] }) {
  const { nameOf } = useWorkspaceMembers()
  return actors.map((actor, index) => (
    <React.Fragment key={actor}>
      {index > 0 && ', '}
      <span className="inline-flex h-5 items-center gap-1 align-top text-foreground">
        <ActorAvatar actor={actor} name={nameOf(actor)} className="data-[size=sm]:size-4" />
        {nameOf(actor)}
      </span>
    </React.Fragment>
  ))
}

/** One event as a sentence with the actor's name and the values in the text color ("Maria changed the status from ○ Todo to ✓ Done"). */
function EventText({ event, actor }: { event: ActivityEvent; actor: string }) {
  const { t, i18n } = useTranslation()
  const { nameOf } = useWorkspaceMembers()
  const { projects } = useProjects()
  const duration = useDuration()
  const locale = getDateLocale(i18n.language)
  const name = <Value>{nameOf(actor)}</Value>
  const say = (key: string, parts: Record<string, React.ReactElement> = {}, values?: Record<string, unknown>) => (
    <Trans t={t} i18nKey={key} values={values} components={{ actor: name, ...parts }} />
  )
  const day = (at: number) => <Value>{format(at, 'MMM d, yyyy', { locale })}</Value>
  const project = (id: string) => <Value>{projects.find((p) => p.id === id)?.title ?? t('activity.unavailable')}</Value>
  switch (event.kind) {
    case 'created': return say('activity.created')
    case 'status': return say('activity.status', { from: <StatusValue status={event.from} />, to: <StatusValue status={event.to} /> })
    case 'title': return say('activity.renamed', { from: <Value>{event.from}</Value>, to: <Value>{event.to}</Value> })
    case 'due':
      if (event.to === null) return say('activity.dueRemoved')
      if (event.from === null) return say('activity.dueSet', { to: day(event.to) })
      return say('activity.dueChanged', { from: day(event.from), to: day(event.to) })
    case 'project': return say('activity.project', { from: project(event.from), to: project(event.to) })
    case 'assignees': {
      const { added, removed } = assigneeChange(event)
      if (added.length && removed.length) return say('activity.reassigned', { added: <PeopleValue actors={added} />, removed: <PeopleValue actors={removed} /> })
      return removed.length
        ? say('activity.unassigned', { people: <PeopleValue actors={removed} /> })
        : say('activity.assigned', { people: <PeopleValue actors={added} /> })
    }
    case 'links': {
      const { added, removed } = event
      if (added.length && removed.length) return say('activity.linksChanged')
      const list = added.length ? added : removed
      if (list.length === 1) return say(added.length ? 'activity.linkAdded' : 'activity.linkRemoved', { link: <Value>{list[0]!.title}</Value> })
      return say(added.length ? 'activity.linksAdded' : 'activity.linksRemoved', {}, { count: list.length })
    }
    case 'time': return say('activity.time', { duration: <Value>{duration(event.time)}</Value> })
  }
}

/** The compact time ("now", "5m"), the full date and time on hover. */
function When({ at }: { at: number }) {
  const { i18n } = useTranslation()
  return (
    <time dateTime={new Date(at).toISOString()} title={format(at, 'PPpp', { locale: getDateLocale(i18n.language) })} className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {shortTimeAgo(at)}
    </time>
  )
}

/** An event: one quiet line, the actor's 20px avatar on the timeline, the sentence, " · " and the time. */
function EventItem({ comment, className }: { comment: Comment; className?: string }) {
  const { nameOf } = useWorkspaceMembers()
  return (
    <li data-kind="event" className={cn(ITEM, 'min-h-5 pl-10 text-sm/5 text-muted-foreground', className)}>
      <span className="absolute top-0 left-1 z-10 flex rounded-xs ring-4 ring-(--activity-bg)">
        <ActorAvatar actor={comment.createdBy} name={nameOf(comment.createdBy)} />
      </span>
      <span className="break-words">{comment.event && <EventText event={comment.event} actor={comment.createdBy} />}</span>
      <span aria-hidden> · </span>
      <When at={comment.createdAt} />
    </li>
  )
}

/**
 * A comment: the author's 28px avatar on the timeline, their name in their transcript color ("You" for your own),
 * the time and "Edited", the markdown under it. Your own has a right-click menu (a long press on touch, the menu
 * key when focused): Edit E and Delete ⌫; never a ⋯ button.
 */
function CommentItem({
  comment,
  person,
  nameClass,
  mine,
  onSave,
  onDelete,
  className,
}: {
  comment: Comment
  person: TranscriptPerson
  nameClass: string
  mine: boolean
  onSave: (comment: Comment, content: string) => Promise<boolean>
  onDelete: (comment: Comment) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const save = async () => {
    if (draft === null || !draft.trim() || pending) return
    if (draft === comment.content) return setDraft(null)
    setPending(true)
    const saved = await onSave(comment, draft)
    setPending(false)
    if (saved) setDraft(null)
  }

  const content = (
    <>
      <span className="relative z-10 h-fit rounded-sm bg-(--activity-bg) ring-4 ring-(--activity-bg)">{person.avatar}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span className={cn('truncate text-sm font-medium', nameClass)}>{person.name}</span>
          {person.isAgent && <span className="shrink-0 rounded-xs bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{t('entities.type_agent')}</span>}
          <When at={comment.createdAt} />
          {comment.updatedAt > comment.createdAt && <span className="shrink-0 text-xs text-muted-foreground">{t('comments.edited')}</span>}
        </div>
        {draft === null ? (
          <EntityText content={comment.content} className="min-w-0 text-sm break-words" />
        ) : (
          <div className="flex flex-col gap-2">
            <MentionTextarea
              value={draft}
              onValueChange={setDraft}
              onSubmit={() => void save()}
              onCancel={() => setDraft(null)}
              aria-label={t('comments.editLabel')}
              readOnly={pending}
              autoFocus
            />
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="compact" disabled={pending} onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
              <SubmitButton label={t('common.save')} pending={pending} disabled={!draft.trim()} onClick={() => void save()} />
            </div>
          </div>
        )}
      </div>
    </>
  )
  const itemClass = cn(ITEM, 'flex gap-3', className)
  if (!mine || draft !== null) return <li data-comment-id={comment.id} data-kind="comment" className={itemClass}>{content}</li>
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<li />}
        data-comment-id={comment.id}
        data-kind="comment"
        tabIndex={0}
        className={cn(itemClass, 'rounded-sm outline-none select-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring')}
      >
        {content}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuGroup>
          <ContextMenuItem shortcut="E" onClick={() => setDraft(comment.content)}>
            <Pencil />
            {t('common.edit')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" shortcut="⌫" onClick={() => onDelete(comment)}>
            <Trash2 />
            {t('common.delete')}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ActivityFeed({ entity, className }: { entity: string; className?: string }) {
  const { t } = useTranslation()
  useEntityData()
  const { items, more, earlier, loaded, loadingEarlier, loadEarlier, createComment, updateComment, deleteComment } = useActivity(entity)
  const { me, personOf } = useTranscriptPeople()
  const blocks = React.useMemo(() => layoutActivity(items), [items])
  const [deleting, setDeleting] = React.useState<Comment | null>(null)
  const [deletePending, setDeletePending] = React.useState(false)
  const [deleteFailed, setDeleteFailed] = React.useState(false)

  const send = async (content: string) => {
    const result = await createComment(content)
    if (!result.ok) toast.error(commentError(t, result.code, 'comments.sendFailed'))
    return result.ok
  }
  const save = async (comment: Comment, content: string) => {
    const result = await updateComment(comment.id, content, comment.updatedAt)
    if (!result.ok) toast.error(commentError(t, result.code, 'comments.saveFailed'))
    return result.ok
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    const result = await deleteComment(deleting.id)
    setDeletePending(false)
    if (!result.ok) return setDeleteFailed(true)
    setDeleting(null)
    toast.success(t('comments.deleted'))
  }

  return (
    <section aria-labelledby={`activity-${entity}`} className={cn('flex flex-col gap-3 [--activity-bg:var(--card)]', className)}>
      <h2 id={`activity-${entity}`} className="text-base font-medium">{t('activity.title')}</h2>
      {!loaded ? (
        <div aria-busy className="flex flex-col gap-1">
          {[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
      ) : (
        <>
          {more && (
            <Button variant="ghost" size="compact" className="self-start" loading={loadingEarlier} onClick={() => void loadEarlier()}>
              {!loadingEarlier && <ChevronUp />}
              {t('activity.earlier', { count: earlier })}
            </Button>
          )}
          {/* Blocks 16px apart; the lines of one run of events 8px apart. */}
          <ol className="flex flex-col">
            {blocks.map((block, index) => {
              const gap = index > 0 && 'mt-4'
              if (block.type === 'events') {
                return block.events.map((item, line) => <EventItem key={item.id} comment={item} className={line > 0 ? 'mt-2' : gap || undefined} />)
              }
              const { comment } = block
              return (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  person={personOf(comment.createdBy)}
                  nameClass={authorNameClass(comment.createdBy, me, messageAuthorColors)}
                  mine={comment.createdBy === me}
                  onSave={save}
                  onDelete={(item) => {
                    setDeleteFailed(false)
                    setDeleting(item)
                  }}
                  className={gap || undefined}
                />
              )
            })}
          </ol>
        </>
      )}
      <div className="mt-2">
        <CommentComposer onSend={send} />
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deletePending) setDeleting(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('comments.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{deleteFailed ? t('comments.deleteFailed') : t('comments.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" loading={deletePending} onClick={() => void confirmDelete()}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
