/**
 * ActivityFeed - the activity of a task or a project (`entity`: `task:<id>`, `project:<id>`), for their pages under
 * the description (Otto v1's Activity): one chronological feed of events ("Maria changed the status from Todo to
 * Done", a muted line on a dot) and comments (28px avatar, name, time, "edited", the content with its mentions as
 * chips) along one hairline, oldest first; the newest 50 first, "Show earlier activity" loads the 50 before. Then
 * the comment box: "Leave a comment", Attach (a file goes to the Library and its chip into the text) and Send. A
 * comment is sent, never autosaved: Send or ⌘/Ctrl+Enter, and a comment you wrote has a ⋯ with Edit (in place,
 * Save / Cancel) and Delete (asks first); events cannot be changed. Typing `@` opens a list of people; picking one
 * puts their token (`user:<id>`) in the text, which notifies them. Events never notify. New items show at once
 * here and, through the live push, for everyone else.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { MoreHorizontal, Paperclip, Pencil, Trash2 } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Kbd } from '@workspace/ui/components/kbd'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/sonner'
import { Textarea } from '@workspace/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { getDateLocale } from '@otto/shared/i18n'
import { MAX_FILE_BYTES } from '@otto/shared/library/limits'
import { formatHotkeyDisplay } from '@/actions/registry'
import { MENU_LIST, MENU_ROW, MENU_ROW_HIGHLIGHT, MENU_SURFACE } from '@/components/ui/menu-styles'
import { useEntityData } from '@/components/entities/entity-chip'
import { EntityText } from '@/components/entities/entity-text'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { useActivity } from '@/hooks/use-activity'
import { useProjects } from '@/hooks/use-projects'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { cn } from '@/lib/utils'
import { readFileAsBase64 } from '@/pages/library/library-items'
import { useDuration } from '@/pages/tasks/task-time-section'
import { statusLabelKey } from '@/pages/tasks/task-row'
import { shortTimeAgo } from '@/utils/session'
import type { ActivityEvent, Comment, TaskStatus } from '../../../shared/types'
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

/** The words of one event, a whole sentence with the actor's name ("Maria changed the status from Todo to Done"). */
function useEventText() {
  const { t, i18n } = useTranslation()
  const { nameOf } = useWorkspaceMembers()
  const { projects } = useProjects()
  const duration = useDuration()
  const locale = getDateLocale(i18n.language)
  const names = (actors: string[]) => actors.map(nameOf).join(', ')
  const status = (value: string) => t(statusLabelKey(value as TaskStatus))
  return (event: ActivityEvent, actor: string): string => {
    const name = nameOf(actor)
    switch (event.kind) {
      case 'created': return t('activity.created', { name })
      case 'status': return t('activity.status', { name, from: status(event.from), to: status(event.to) })
      case 'title': return t('activity.renamed', { name, to: event.to })
      case 'due': return event.to === null
        ? t('activity.dueRemoved', { name })
        : t('activity.dueSet', { name, date: format(event.to, 'MMM d, yyyy', { locale }) })
      case 'project': return t('activity.project', { name, project: projects.find((p) => p.id === event.to)?.title ?? t('activity.unavailable') })
      case 'assignees': {
        const added = event.to.filter((who) => !event.from.includes(who))
        const removed = event.from.filter((who) => !event.to.includes(who))
        if (added.length && removed.length) return t('activity.reassigned', { name, added: names(added), removed: names(removed) })
        return removed.length ? t('activity.unassigned', { name, people: names(removed) }) : t('activity.assigned', { name, people: names(added) })
      }
      case 'links': {
        const { added, removed } = event
        if (added.length && removed.length) return t('activity.linksChanged', { name })
        const list = added.length ? added : removed
        if (list.length === 1) return t(added.length ? 'activity.linkAdded' : 'activity.linkRemoved', { name, title: list[0]!.title })
        return t(added.length ? 'activity.linksAdded' : 'activity.linksRemoved', { name, count: list.length })
      }
      case 'time': return t('activity.time', { name, duration: duration(event.time) })
    }
  }
}

/** An event: a muted line on the timeline's dot ("Maria logged 1h · 5m"). */
function EventItem({ comment, text }: { comment: Comment; text: string }) {
  return (
    <li data-kind="event" className={cn(ITEM, 'min-h-5 pl-10 text-sm text-muted-foreground')}>
      <span aria-hidden className="absolute top-1.5 left-2.5 z-10 size-2 rounded-full bg-muted-foreground/70 ring-4 ring-(--activity-bg)" />
      <span className="break-words">{text}</span>
      <span aria-hidden> · </span>
      <span className="text-xs tabular-nums">{shortTimeAgo(comment.createdAt)}</span>
    </li>
  )
}

function CommentItem({
  comment,
  name,
  mine,
  onSave,
  onDelete,
}: {
  comment: Comment
  name: string
  mine: boolean
  onSave: (comment: Comment, content: string) => Promise<boolean>
  onDelete: (comment: Comment) => void
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

  return (
    <li data-comment-id={comment.id} data-kind="comment" className={cn(ITEM, 'group/comment flex gap-3')}>
      <span className="relative z-10 h-fit rounded-sm bg-(--activity-bg) ring-4 ring-(--activity-bg)">
        <ActorAvatar actor={comment.createdBy} name={name} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative flex h-5 min-w-0 items-center gap-2 pr-7">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortTimeAgo(comment.createdAt)}</span>
          {comment.updatedAt > comment.createdAt && <span className="shrink-0 text-xs text-muted-foreground">{t('comments.edited')}</span>}
          {mine && draft === null && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('common.moreActions')}
                    className="absolute top-1/2 right-0 -translate-y-1/2 opacity-0 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 aria-expanded:opacity-100 not-pointer-fine:opacity-100"
                  />
                )}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuItem shortcut="E" onClick={() => setDraft(comment.content)}>
                    <Pencil />
                    {t('common.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" shortcut="⌫" onClick={() => onDelete(comment)}>
                    <Trash2 />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
    </li>
  )
}

export function ActivityFeed({ entity, className }: { entity: string; className?: string }) {
  const { t } = useTranslation()
  useEntityData()
  const { items, more, loaded, loadingEarlier, loadEarlier, createComment, updateComment, deleteComment } = useActivity(entity)
  const { nameOf, me } = useWorkspaceMembers()
  const eventText = useEventText()
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
              {t('activity.showEarlier')}
            </Button>
          )}
          <ol className="flex flex-col gap-4">
            {items.map((item) => item.type === 'event' && item.event ? (
              <EventItem key={item.id} comment={item} text={eventText(item.event, item.createdBy)} />
            ) : item.type === 'event' ? null : (
              <CommentItem
                key={item.id}
                comment={item}
                name={nameOf(item.createdBy)}
                mine={item.createdBy === me}
                onSave={save}
                onDelete={(comment) => {
                  setDeleteFailed(false)
                  setDeleting(comment)
                }}
              />
            ))}
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
