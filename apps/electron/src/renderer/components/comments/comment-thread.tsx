/**
 * CommentThread - the comments on a task or a project (`entity`: `task:<id>`, `project:<id>`), for their pages
 * under the description: the "Comments" title and its count, the comments oldest first (28px avatar, name, time,
 * "edited", the content with its mentions as chips), then the comment box. A comment is sent, never autosaved:
 * Send or ⌘/Ctrl+Enter, and a comment you wrote has a ⋯ with Edit (in place, Save / Cancel) and Delete (asks
 * first). Typing `@` opens a list of people; picking one puts their token (`user:<id>`) in the text, which
 * notifies them. New comments show at once here and, through the live push, for everyone else.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
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
import { Count } from '@workspace/ui/components/count'
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
import { formatHotkeyDisplay } from '@/actions/registry'
import { MENU_LIST, MENU_ROW, MENU_ROW_HIGHLIGHT, MENU_SURFACE } from '@/components/ui/menu-styles'
import { useEntityData } from '@/components/entities/entity-chip'
import { EntityText } from '@/components/entities/entity-text'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { useComments } from '@/hooks/use-comments'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { cn } from '@/lib/utils'
import { shortTimeAgo } from '@/utils/session'
import type { Comment } from '../../../shared/types'
import { getMentionCandidates, getMentionQuery, insertMention, type MentionQuery } from './comment-mentions'

const SEND_KEY = formatHotkeyDisplay('mod+↵')

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

function CommentComposer({ onSend }: { onSend: (content: string) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [value, setValue] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const send = async () => {
    if (!value.trim() || pending) return
    setPending(true)
    const sent = await onSend(value)
    setPending(false)
    if (sent) setValue('')
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
      <div className="flex justify-end">
        <SubmitButton label={t('comments.send')} pending={pending} disabled={!value.trim()} onClick={() => void send()} />
      </div>
    </div>
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
    <li data-comment-id={comment.id} className="group/comment flex gap-3">
      <ActorAvatar actor={comment.createdBy} name={name} size="md" className="mt-px" />
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

export function CommentThread({ entity, className }: { entity: string; className?: string }) {
  const { t } = useTranslation()
  useEntityData()
  const { comments, loaded, createComment, updateComment, deleteComment } = useComments(entity)
  const { nameOf, me } = useWorkspaceMembers()
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
    <section aria-labelledby={`comments-${entity}`} className={cn('flex flex-col gap-3', className)}>
      <h2 id={`comments-${entity}`} className="flex items-center gap-2 text-base font-medium">
        {t('comments.title')}
        {comments.length > 0 && <Count>{comments.length}</Count>}
      </h2>
      {!loaded ? (
        <div aria-busy className="flex flex-col gap-1">
          {[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              name={nameOf(comment.createdBy)}
              mine={comment.createdBy === me}
              onSave={save}
              onDelete={(item) => {
                setDeleteFailed(false)
                setDeleting(item)
              }}
            />
          ))}
        </ul>
      )}
      <CommentComposer onSend={send} />
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
