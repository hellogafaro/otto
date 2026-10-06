/**
 * MembersSettingsPage: Settings -> Members. Who is in the workspace and, for owners, the pending invitations.
 *
 * Members: avatar, name ("You" on your row), email, the role (owners change it in a 28px select, others see a
 * badge) and a ⋯ menu: Remove on someone else's row (owners), Leave workspace on your own. Both ask first.
 * Invitations (owners only): email and expiry, ⋯ Copy link / Revoke, and "Invite member", a dialog that
 * creates the invitation and shows its link to copy (no mail is sent). Every change applies at once with
 * the shared toast; the last-owner rule is checked before asking and again by the server (`conflict`).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Copy, Ellipsis, Link, LogOut, Mail, Plus, Trash2, UserMinus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@workspace/ui/components/input-group'
import { PageColumn } from '@workspace/ui/components/page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/sonner'
import { Spinner } from '@workspace/ui/components/spinner'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import { useAppShellContext } from '@/context/app-shell-context'
import { useLiveData } from '@/hooks/use-live-data'
import { useWorkspaceMemberList } from '@/hooks/use-workspace-members'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '../../../shared/types'
import { expiresInDays, isLastOwner, memberRowActions, sortMembers } from './members-rules'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'members',
}

/** A failed member or invitation change, by its `domainError` code. */
function errorMessage(t: TFunction, code: string): string {
  if (code === 'conflict') return t('members.lastOwner')
  if (code === 'forbidden') return t('members.forbidden')
  if (code === 'not_found') return t('members.notFound')
  return t('members.error')
}

function copyLink(t: TFunction, link: string) {
  navigator.clipboard.writeText(link).then(
    () => toast.success(t('members.linkCopied')),
    () => toast.error(t('members.error')),
  )
}

/** The pending invitations, for owners only; reloaded on focus and when the server says members changed. */
function useInvitations(workspaceId: string | null, enabled: boolean) {
  const [items, setItems] = useState<WorkspaceInvitation[]>([])
  const refresh = useCallback(async () => {
    if (!workspaceId || !enabled) return
    try {
      setItems(await window.electronAPI.getWorkspaceInvitations(workspaceId))
    } catch (error) {
      console.error('[MembersSettingsPage] invitations failed:', error)
    }
  }, [workspaceId, enabled])

  useEffect(() => {
    setItems([])
    void refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const mutate = useLiveData('members', enabled ? workspaceId : null, refresh)
  return { items, mutate }
}

type Confirm = { kind: 'remove' | 'leave'; member: WorkspaceMember }

export default function MembersSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId, workspaces, onSelectWorkspace, onRefreshWorkspaces } = useAppShellContext()
  const { items, loaded, mutate } = useWorkspaceMemberList()
  const rows = useMemo(() => sortMembers(items), [items])
  const isOwner = rows.some((row) => row.me && row.role === 'owner')
  const invitations = useInvitations(activeWorkspaceId, isOwner)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [inviting, setInviting] = useState(false)
  const api = window.electronAPI

  const changeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (!activeWorkspaceId || role === member.role) return
    if (role === 'member' && isLastOwner(rows, member.userId)) return void toast.error(t('members.lastOwner'))
    const result = await mutate(() => api.updateWorkspaceMemberRole(activeWorkspaceId, member.userId, role))
    if (result.ok) toast.success(t('common.saved'), { id: 'saved' })
    else toast.error(errorMessage(t, result.code), { id: 'saved' })
  }

  const askLeave = (member: WorkspaceMember) => {
    if (isLastOwner(rows, member.userId)) return void toast.error(t('members.lastOwner'))
    setConfirm({ kind: 'leave', member })
  }

  /** Runs the confirmed removal or leave; returns the error to show in the dialog, or null when done. */
  const runConfirm = async ({ kind, member }: Confirm): Promise<string | null> => {
    if (!activeWorkspaceId) return t('members.error')
    if (kind === 'remove') {
      const result = await mutate(() => api.removeWorkspaceMember(activeWorkspaceId, member.userId))
      if (!result.ok) return errorMessage(t, result.code)
      toast.success(t('members.removed', { name: member.name || member.email }))
      return null
    }
    const result = await mutate(() => api.leaveWorkspace(activeWorkspaceId))
    if (!result.ok) return errorMessage(t, result.code)
    toast.success(t('members.left'))
    // This workspace is gone for you: open another one, or start over when there is none.
    const next = workspaces.find((workspace) => workspace.id !== activeWorkspaceId)
    onRefreshWorkspaces?.()
    if (next) void onSelectWorkspace(next.id)
    else window.location.assign('/')
    return null
  }

  const revoke = async (invitation: WorkspaceInvitation) => {
    const result = await invitations.mutate(() => api.revokeWorkspaceInvitation(invitation.id))
    if (result.ok) toast.success(t('members.revoked'))
    else toast.error(errorMessage(t, result.code))
  }

  const now = Date.now()

  return (
    <div className="flex h-full flex-col">
      <SettingsPageHeader subpage="members" />
      <PageColumn>
        <SettingsSection title={t('settings.members.title')}>
          {!loaded ? (
            <div className="space-y-2" aria-busy>
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <SettingsCard>
              {rows.map((member) => {
                const actions = memberRowActions(rows, member)
                return (
                  <SettingsRow
                    list
                    key={member.userId}
                    icon={<ActorAvatar actor={member.actor} name={member.name} size="default" />}
                    label={
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{member.name || member.email}</span>
                        {/* "You" gives way first when the row is narrow */}
                        {member.me && <span className="min-w-0 shrink-[100] truncate font-normal text-muted-foreground">{t('members.you')}</span>}
                      </span>
                    }
                    description={member.email}
                  >
                    {actions.editRole ? (
                      <Select
                        value={member.role}
                        items={{ owner: t('members.role.owner'), member: t('members.role.member') }}
                        onValueChange={(role) => role && void changeRole(member, role as WorkspaceRole)}
                      >
                        <SelectTrigger size="sm" className="w-24" aria-label={t('members.role.label')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="owner">{t('members.role.owner')}</SelectItem>
                          <SelectItem value="member">{t('members.role.member')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{t(`members.role.${member.role}`)}</Badge>
                    )}
                    {actions.remove || actions.leave ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
                          <Ellipsis />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {actions.remove && (
                            <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', member })}>
                              <UserMinus />
                              {t('common.remove')}
                            </DropdownMenuItem>
                          )}
                          {actions.leave && (
                            <DropdownMenuItem variant="destructive" onClick={() => askLeave(member)}>
                              <LogOut />
                              {t('members.leave')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      // Keeps the role column aligned on rows without a menu
                      <span aria-hidden className="size-7" />
                    )}
                  </SettingsRow>
                )
              })}
            </SettingsCard>
          )}
        </SettingsSection>

        {isOwner && (
          <SettingsSection
            title={t('members.invitations')}
            action={
              <Button variant="ghost" size="compact" onClick={() => setInviting(true)}>
                <Plus />
                {t('members.invite')}
              </Button>
            }
          >
            <SettingsCard>
              {invitations.items.length === 0 ? (
                <SettingsRow label={<span className="font-normal text-muted-foreground">{t('members.noInvitations')}</span>} />
              ) : (
                invitations.items.map((invitation) => (
                  <SettingsRow
                    list
                    key={invitation.id}
                    icon={<Mail />}
                    label={<span className="block truncate">{invitation.email}</span>}
                    description={t('members.expiresInDays', { count: expiresInDays(invitation.expiresAt, now) })}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
                        <Ellipsis />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => copyLink(t, invitation.link)}>
                          <Link />
                          {t('members.copyLink')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => void revoke(invitation)}>
                          <Trash2 />
                          {t('members.revoke')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SettingsRow>
                ))
              )}
            </SettingsCard>
          </SettingsSection>
        )}
      </PageColumn>

      {activeWorkspaceId && (
        <InviteMemberDialog open={inviting} onOpenChange={setInviting} workspaceId={activeWorkspaceId} mutate={invitations.mutate} />
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} onConfirm={runConfirm} />
    </div>
  )
}

/** Remove member? / Leave workspace?: the work runs inside it; a failure stays open with its message. */
function ConfirmDialog({
  confirm,
  onClose,
  onConfirm,
}: {
  confirm: Confirm | null
  onClose: () => void
  onConfirm: (confirm: Confirm) => Promise<string | null>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Keep the last request while the dialog closes, so its copy does not change mid-animation
  const [shown, setShown] = useState<Confirm | null>(confirm)
  useEffect(() => {
    if (confirm) (setShown(confirm), setError(null))
  }, [confirm])

  const leave = shown?.kind === 'leave'
  const run = async () => {
    if (!shown) return
    setPending(true)
    const failure = await onConfirm(shown)
    setPending(false)
    if (failure) setError(failure)
    else onClose()
  }

  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia variant="destructive">{leave ? <LogOut /> : <UserMinus />}</AlertDialogMedia>
          <AlertDialogTitle>{leave ? t('members.leaveConfirm.title') : t('members.removeConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {error ?? (leave ? t('members.leaveConfirm.description') : t('members.removeConfirm.description'))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void run()}>
            {pending && <Spinner data-icon="inline-start" />}
            {leave ? t('members.leaveConfirm.action') : t('common.remove')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Invite member: an email, then the invitation's link to copy (it is the only way in: no mail is sent). */
function InviteMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  mutate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  mutate: ReturnType<typeof useInvitations>['mutate']
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(null)

  useEffect(() => {
    if (open) (setEmail(''), setError(null), setInvitation(null))
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || pending) return
    setPending(true)
    const result = await mutate(() => window.electronAPI.inviteWorkspaceMember(workspaceId, email.trim()))
    setPending(false)
    if (result.ok) setInvitation(result.value)
    else
      setError(
        result.code === 'invalid' ? t('members.invalidEmail') : result.code === 'conflict' ? t('members.alreadyMember') : errorMessage(t, result.code),
      )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('members.invite')}</DialogTitle>
          <DialogDescription>
            {invitation ? t('members.linkNote', { email: invitation.email }) : t('members.inviteDescription')}
          </DialogDescription>
        </DialogHeader>
        {invitation ? (
          <>
            <InputGroup>
              <InputGroupInput readOnly value={invitation.link} aria-label={t('members.inviteLink')} onFocus={(event) => event.currentTarget.select()} />
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={() => copyLink(t, invitation.link)}>
                  <Copy />
                  {t('common.copy')}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <DialogFooter>
              <DialogClose render={<Button />}>{t('common.done')}</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-6" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-2">
              <Input
                type="email"
                autoFocus
                value={email}
                placeholder={t('members.email')}
                aria-label={t('members.email')}
                aria-invalid={!!error || undefined}
                onChange={(event) => (setEmail(event.target.value), setError(null))}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
              <Button type="submit" disabled={!email.trim() || pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {t('members.createLink')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
