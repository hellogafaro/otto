/**
 * MessagingSettingsPage
 *
 * Configure messaging platform connections (Telegram, WhatsApp, Lark) and
 * view active session bindings.
 *
 * Layout:
 *  - One SettingsCard per platform
 *  - Each card renders a PlatformRow: [brand logo] [name] [API · status]
 *    with a Connect button (disconnected) or three-dot menu (connected)
 *  - Telegram-specific: direct (DM) bindings render directly under the bot
 *    row, then a separator, then a collapsible Supergroup section that
 *    expands to show topic-bound bindings. Mirrors the chevron pattern
 *    used by AiSettingsPage's `WorkspaceOverrideCard`.
 *  - WhatsApp / Lark: bindings render as a flat list under their bot row.
 */

import * as React from 'react'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import { motion, AnimatePresence } from 'motion/react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  Hash,
  LockOpen,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  PowerOff,
  RefreshCcw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { PageColumn } from '@workspace/ui/components/page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import { MessagingPlatformIcon } from '@/components/messaging/messaging-platform-icon'
import { TelegramConnectDialog } from '@/components/messaging/telegram-connect-dialog'
import { LarkConnectDialog } from '@/components/messaging/lark-connect-dialog'
import { TelegramSupergroupPairingDialog } from '@/components/messaging/telegram-supergroup-pairing-dialog'
import { WhatsAppConnectDialog } from '@/components/messaging/whats-app-connect-dialog'
import {
  BindingAllowListPopover,
  TelegramAccessSection,
  type BindingAccess,
  type BindingAccessMode,
  type PlatformAccessMode,
  type PlatformOwner,
} from '@/components/messaging/access'
import { useActiveWorkspace } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import {
  messagingBindingsAtom,
  setMessagingBindingsAtom,
  type MessagingBinding,
} from '@/atoms/messaging'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { MessagingPlatformRuntimeInfo } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'messaging',
}

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const setBindings = useSetAtom(setMessagingBindingsAtom)
  const workspaceId = activeWorkspace?.id

  // Single fetch + subscription at the page level so both PlatformRows read
  // from the already-populated atom instead of subscribing twice.
  React.useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const load = async () => {
      try {
        const rows = await window.electronAPI.getMessagingBindings()
        if (!cancelled) setBindings(rows as MessagingBinding[])
      } catch {
        // Silent — a toast here would be noisy on first load.
      }
    }
    load()
    const off = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, setBindings])

  if (!activeWorkspace) return null

  return (
    <div className="flex h-full flex-col">
      <SettingsPageHeader subpage="messaging" />
      <PageColumn>
          <SettingsSection title={t('settings.messaging.title')}>
            <SettingsCard>
              <PlatformRow platform="telegram" workspaceId={activeWorkspace.id} />
            </SettingsCard>
            <SettingsCard>
              <PlatformRow platform="whatsapp" workspaceId={activeWorkspace.id} />
            </SettingsCard>
            <SettingsCard>
              <PlatformRow platform="lark" workspaceId={activeWorkspace.id} />
            </SettingsCard>
          </SettingsSection>
      </PageColumn>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Platform row
// ---------------------------------------------------------------------------

type Platform = 'telegram' | 'whatsapp' | 'lark'

const PLATFORM_LABEL_KEYS: Record<Platform, string> = {
  telegram: 'settings.messaging.telegram.title',
  whatsapp: 'settings.messaging.whatsapp.title',
  lark: 'settings.messaging.lark.title',
}

// Topic and binding rows have no icon of their own: this spacer lines their text up with the
// supergroup's label above, past the 32px icon tile and its 12px gap.
function IconSpacer() {
  return <div className="size-8 shrink-0" />
}

function CardSeparator() {
  return <div className="h-px bg-(--card-divider)" />
}

function PlatformRow({ platform, workspaceId }: { platform: Platform; workspaceId: string }) {
  const { t } = useTranslation()
  const allBindings = useAtomValue(messagingBindingsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { navigateToSession } = useNavigation()
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo>(() =>
    defaultRuntime(platform),
  )
  const [connectOpen, setConnectOpen] = React.useState(false)
  const [reconfigure, setReconfigure] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Telegram supergroup state — only relevant when platform === 'telegram'.
  // Lifted into PlatformRow so the supergroup sub-row sits inside the same
  // SettingsCard as the bot connection.
  const [supergroup, setSupergroup] = React.useState<{ chatId: string; title: string } | null>(null)
  const [supergroupDialogOpen, setSupergroupDialogOpen] = React.useState(false)

  // Telegram workspace access mode — telegram only. Lifted up so the
  // dropdown can decide whether to show "Unlock", and TelegramAccessSection
  // receives it as a controlled prop. Symmetric with `supergroup` state.
  const [telegramAccessMode, setTelegramAccessMode] =
    React.useState<PlatformAccessMode>('open')

  const refreshSupergroup = React.useCallback(async () => {
    if (platform !== 'telegram') return
    try {
      const sg = await window.electronAPI.getMessagingSupergroup()
      setSupergroup(sg ? { chatId: sg.chatId, title: sg.title } : null)
    } catch {
      // silent — empty state means "not configured"
    }
  }, [platform])

  const refreshTelegramAccessMode = React.useCallback(async () => {
    if (platform !== 'telegram') return
    try {
      const mode = await window.electronAPI.getMessagingPlatformAccessMode('telegram')
      setTelegramAccessMode(mode as PlatformAccessMode)
    } catch {
      // silent — default 'open' covers fresh / disconnected state
    }
  }, [platform])

  React.useEffect(() => {
    refreshSupergroup()
  }, [refreshSupergroup, workspaceId])

  React.useEffect(() => {
    if (platform !== 'telegram') return
    void refreshTelegramAccessMode()
    // Lock-down migrates open bindings → inherit, which fires
    // onMessagingBindingChanged. Unlock doesn't migrate, but PlatformRow
    // and TelegramAccessSection both call setTelegramAccessMode after the
    // API write, so the prop stays in sync without an extra event.
    const off = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) void refreshTelegramAccessMode()
    })
    return () => off()
  }, [platform, workspaceId, refreshTelegramAccessMode])

  const platformBindings = React.useMemo(
    () =>
      allBindings
        .filter((b) => b.platform === platform)
        .sort((a, b) => b.createdAt - a.createdAt),
    [allBindings, platform],
  )

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      const next = cfg?.runtime?.[platform]
      setRuntime((next ?? defaultRuntime(platform)) as MessagingPlatformRuntimeInfo)
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, p, status) => {
      if (wsId !== workspaceId || p !== platform) return
      setRuntime(status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [platform, workspaceId])

  // Mirror AI Settings pattern: close menu first, then fire the action on the
  // next frame — avoids a known menu/dialog teardown race.
  const runAfterMenuClose = React.useCallback((action: () => void) => {
    setMenuOpen(false)
    requestAnimationFrame(action)
  }, [])

  const handleConnect = () => {
    setReconfigure(false)
    setConnectOpen(true)
  }

  const handleReconfigure = () => {
    setReconfigure(true)
    setConnectOpen(true)
  }

  const handleUnlock = async () => {
    try {
      await window.electronAPI.setMessagingPlatformAccessMode('telegram', 'open')
      toast.success(t('toast.messagingTelegramUnlocked'))
      setTelegramAccessMode('open')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform(platform)
      toast.success(
        t(`settings.messaging.${platform}.disconnected`, {
          defaultValue: 'Disconnected',
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleForget = async () => {
    try {
      await window.electronAPI.forgetMessagingPlatform(platform)
      toast.success(
        t(`settings.messaging.${platform}.disconnected`, {
          defaultValue: 'Disconnected',
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleUnbind = async (binding: MessagingBinding) => {
    try {
      await window.electronAPI.unbindMessagingBinding(binding.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const description = buildDescription(platform, runtime, t)
  const label = t(PLATFORM_LABEL_KEYS[platform])

  return (
    <>
      <div>
        <SettingsRow
          icon={<MessagingPlatformIcon platform={platform} />}
          label={label}
          description={`${t(`settings.messaging.${platform}.apiType`)} · ${description}`}
        >
          {runtime.connected ? (
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-compact" aria-label={t('common.more')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                {platform === 'telegram' ? (
                  <>
                    <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleReconfigure)}>
                      <Settings2 className="h-3.5 w-3.5" />
                      <span>{t('common.reconfigure')}</span>
                    </StyledDropdownMenuItem>
                    {telegramAccessMode === 'owner-only' && (
                      <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleUnlock)}>
                        <LockOpen className="h-3.5 w-3.5" />
                        <span>{t('settings.messaging.telegram.unlock')}</span>
                      </StyledDropdownMenuItem>
                    )}
                    <StyledDropdownMenuSeparator />
                    <StyledDropdownMenuItem onClick={handleDisconnect} variant="destructive">
                      <PowerOff className="h-3.5 w-3.5" />
                      <span>{t('common.disconnect')}</span>
                    </StyledDropdownMenuItem>
                  </>
                ) : (
                  <>
                    <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleConnect)}>
                      <RefreshCcw className="h-3.5 w-3.5" />
                      <span>{t('common.reconnect')}</span>
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuItem onClick={handleDisconnect}>
                      <PowerOff className="h-3.5 w-3.5" />
                      <span>{t('common.disable')}</span>
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuSeparator />
                    <StyledDropdownMenuItem onClick={handleForget} variant="destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('common.disconnect')}</span>
                    </StyledDropdownMenuItem>
                  </>
                )}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="outline" size="compact" onClick={handleConnect}>
              <Plus className="h-3.5 w-3.5" />
              {t('common.connect')}
            </Button>
          )}
        </SettingsRow>

        {platform === 'telegram' && runtime.connected ? (
          <>
            <TelegramAccessSection
              workspaceId={workspaceId}
              accessMode={telegramAccessMode}
              onAccessModeChange={setTelegramAccessMode}
            />
            <TelegramBindingsBody
              bindings={platformBindings}
              sessionMetaMap={sessionMetaMap}
              supergroup={supergroup}
              onPairSupergroup={() => setSupergroupDialogOpen(true)}
              onUnpairSupergroup={async () => {
                try {
                  await window.electronAPI.unbindMessagingSupergroup()
                  toast.success(
                    t('settings.messaging.telegram.supergroup.disconnected', {
                      defaultValue: 'Supergroup disconnected',
                    }),
                  )
                  refreshSupergroup()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('common.error'))
                }
              }}
              onOpenSession={(b) => navigateToSession(b.sessionId)}
              onUnbind={handleUnbind}
            />
          </>
        ) : platformBindings.length > 0 ? (
          <>
            <CardSeparator />
            <div className="divide-y divide-foreground/10">
              {platformBindings.map((binding) => (
                <FlatBindingRow
                  key={binding.id}
                  binding={binding}
                  sessionMetaMap={sessionMetaMap}
                  onOpen={() => navigateToSession(binding.sessionId)}
                  onUnbind={() => handleUnbind(binding)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {platform === 'telegram' && (
        <>
          <TelegramConnectDialog
            open={connectOpen}
            onOpenChange={setConnectOpen}
            reconfigure={reconfigure}
          />
          <TelegramSupergroupPairingDialog
            open={supergroupDialogOpen}
            onOpenChange={setSupergroupDialogOpen}
            botUsername={runtime.identity}
            onPaired={refreshSupergroup}
          />
        </>
      )}
      {platform === 'whatsapp' && (
        <WhatsAppConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      )}
      {platform === 'lark' && (
        <LarkConnectDialog open={connectOpen} onOpenChange={setConnectOpen} reconfigure={reconfigure} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Telegram bindings body — direct sessions + collapsible supergroup
// ---------------------------------------------------------------------------

interface TelegramBindingsBodyProps {
  bindings: MessagingBinding[]
  sessionMetaMap: Map<string, SessionMeta>
  supergroup: { chatId: string; title: string } | null
  onPairSupergroup: () => void
  onUnpairSupergroup: () => void
  onOpenSession: (binding: MessagingBinding) => void
  onUnbind: (binding: MessagingBinding) => void
}

function bindingToAccess(binding: MessagingBinding): BindingAccess {
  return {
    mode: binding.accessMode ?? 'open',
    allowedSenderIds: binding.allowedSenderIds ?? [],
  }
}

function TelegramBindingsBody({
  bindings,
  sessionMetaMap,
  supergroup,
  onPairSupergroup,
  onUnpairSupergroup,
  onOpenSession,
  onUnbind,
}: TelegramBindingsBodyProps) {
  const [workspaceOwners, setWorkspaceOwners] = React.useState<PlatformOwner[]>([])

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const owners = await window.electronAPI.getMessagingPlatformOwners('telegram')
        if (!cancelled) setWorkspaceOwners(owners)
      } catch {
        // Silent — falls back to empty list which BindingAllowListPopover
        // handles gracefully (shows "no known users" hint).
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [bindings])

  const handleAccessChange = React.useCallback(
    async (bindingId: string, next: BindingAccess) => {
      try {
        await window.electronAPI.setMessagingBindingAccess(bindingId, {
          mode: next.mode as BindingAccessMode,
          ...(next.mode === 'allow-list' ? { allowedSenderIds: next.allowedSenderIds } : {}),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update access')
      }
    },
    [],
  )
  // Telegram bindings split cleanly on `threadId`:
  //   - undefined: DM ("direct session") — at most one per workspace
  //   - number:    topic in the paired supergroup
  const directBindings = React.useMemo(() => bindings.filter((b) => b.threadId === undefined), [bindings])
  const topicBindings = React.useMemo(() => bindings.filter((b) => b.threadId !== undefined), [bindings])

  return (
    <>
      {directBindings.length > 0 && (
        <>
          <CardSeparator />
          <div className="divide-y divide-foreground/10">
            {directBindings.map((binding) => (
              <DirectSessionRow
                key={binding.id}
                binding={binding}
                sessionMetaMap={sessionMetaMap}
                workspaceOwners={workspaceOwners}
                onOpen={() => onOpenSession(binding)}
                onUnbind={() => onUnbind(binding)}
                onAccessChange={(next) => handleAccessChange(binding.id, next)}
              />
            ))}
          </div>
        </>
      )}

      <CardSeparator />
      {supergroup ? (
        <PairedSupergroupSection
          supergroup={supergroup}
          topicBindings={topicBindings}
          sessionMetaMap={sessionMetaMap}
          workspaceOwners={workspaceOwners}
          onUnpair={onUnpairSupergroup}
          onOpenSession={onOpenSession}
          onUnbindTopic={onUnbind}
          onAccessChange={handleAccessChange}
        />
      ) : (
        <UnpairedSupergroupRow onPair={onPairSupergroup} />
      )}
    </>
  )
}

function DirectSessionRow({
  binding,
  sessionMetaMap,
  workspaceOwners,
  onOpen,
  onUnbind,
  onAccessChange,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  workspaceOwners: PlatformOwner[]
  onOpen: () => void
  onUnbind: () => void
  onAccessChange: (next: BindingAccess) => void
}) {
  const { t } = useTranslation()
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  // Layout convention here matches the Supergroup row: the binding *type*
  // ("Direct message session") is the primary label, the session name drops
  // to the subtitle. Keeps Direct and Supergroup rows visually parallel.
  return (
    <SettingsRow
      icon={<MessageSquare />}
      label={t('settings.messaging.telegram.directSessionSubtitle', {
        defaultValue: 'Direct message session',
      })}
      description={sessionLabel}
    >
      <BindingAllowListPopover
        access={bindingToAccess(binding)}
        workspaceOwners={workspaceOwners}
        onChange={onAccessChange}
      />
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </SettingsRow>
  )
}

function UnpairedSupergroupRow({ onPair }: { onPair: () => void }) {
  const { t } = useTranslation()
  return (
    <SettingsRow
      icon={<MessagesSquare />}
      label={t('settings.messaging.telegram.supergroup.label', { defaultValue: 'Supergroup' })}
      description={t('settings.messaging.telegram.supergroup.notConfigured', {
        defaultValue: 'Not configured',
      })}
    >
      <Button variant="outline" size="compact" onClick={onPair}>
        <Plus className="h-3.5 w-3.5" />
        {t('settings.messaging.telegram.supergroup.pair', { defaultValue: 'Pair Supergroup' })}
      </Button>
    </SettingsRow>
  )
}

function PairedSupergroupSection({
  supergroup,
  topicBindings,
  sessionMetaMap,
  workspaceOwners,
  onUnpair,
  onOpenSession,
  onUnbindTopic,
  onAccessChange,
}: {
  supergroup: { chatId: string; title: string }
  topicBindings: MessagingBinding[]
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  workspaceOwners: PlatformOwner[]
  onUnpair: () => void
  onOpenSession: (binding: MessagingBinding) => void
  onUnbindTopic: (binding: MessagingBinding) => void
  onAccessChange: (bindingId: string, next: BindingAccess) => void
}) {
  const { t } = useTranslation()
  // Default open when there are topics — gives users immediate visibility
  // into where automations are routing. Empty paired supergroups stay
  // collapsed since there's nothing interesting to show yet.
  const [isExpanded, setIsExpanded] = React.useState(topicBindings.length > 0)

  const subtitle =
    topicBindings.length === 0
      ? t('settings.messaging.telegram.supergroup.autoTopicNote')
      : t('settings.messaging.telegram.supergroup.topicsBound', {
          count: topicBindings.length,
          defaultValue: '{{count}} topics bound',
        })

  return (
    <div>
      <SettingsRow
        icon={<MessagesSquare />}
        label={
          <span className="flex items-baseline gap-2">
            <span className="truncate">{supergroup.title}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">({supergroup.chatId})</span>
          </span>
        }
        description={subtitle}
        expanded={isExpanded}
        onClick={() => setIsExpanded((v) => !v)}
      />

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-foreground/10">
              {topicBindings.length === 0 ? (
                <div className="flex items-start gap-3 px-4 py-3 text-xs text-foreground/50">
                  <IconSpacer />
                  <span>
                    {t('settings.messaging.telegram.supergroup.noTopicsHint', {
                      defaultValue:
                        'No topics bound yet — automations with `telegramTopic` will create them.',
                    })}
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-foreground/10">
                  {topicBindings.map((binding) => (
                    <TopicBindingRow
                      key={binding.id}
                      binding={binding}
                      sessionMetaMap={sessionMetaMap}
                      workspaceOwners={workspaceOwners}
                      onOpen={() => onOpenSession(binding)}
                      onUnbind={() => onUnbindTopic(binding)}
                      onAccessChange={(next) => onAccessChange(binding.id, next)}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2">
                <IconSpacer />
                <Button
                  variant="ghost"
                  size="compact"
                  className="text-destructive hover:text-destructive"
                  onClick={onUnpair}
                >
                  {t('common.disconnect')}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TopicBindingRow({
  binding,
  sessionMetaMap,
  workspaceOwners,
  onOpen,
  onUnbind,
  onAccessChange,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  workspaceOwners: PlatformOwner[]
  onOpen: () => void
  onUnbind: () => void
  onAccessChange: (next: BindingAccess) => void
}) {
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  const topicName = binding.channelName || binding.channelId
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <IconSpacer />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{sessionLabel}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground/50">
          <Hash className="h-3 w-3" />
          <span className="truncate">
            {topicName} <span className="text-foreground/30">·</span> Topic #{binding.threadId}
          </span>
        </div>
      </div>
      <BindingAllowListPopover
        access={bindingToAccess(binding)}
        workspaceOwners={workspaceOwners}
        onChange={onAccessChange}
      />
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function FlatBindingRow({
  binding,
  sessionMetaMap,
  onOpen,
  onUnbind,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  onOpen: () => void
  onUnbind: () => void
}) {
  // Used by WhatsApp + Lark (no supergroup/topic concept) — same compact
  // row the page used to render for every platform before the Telegram split.
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 pl-[60px]">
      <div className="min-w-0 truncate text-sm">{sessionLabel}</div>
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function RowActions({ onOpen, onUnbind }: { onOpen: () => void; onUnbind: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="compact" onClick={onOpen}>
        <ArrowUpRight className="h-3.5 w-3.5" />
        {t('settings.messaging.bindings.openSession')}
      </Button>
      <Button
        variant="ghost"
        size="compact"
        className="text-destructive hover:text-destructive"
        onClick={onUnbind}
      >
        {t('common.disconnect')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDescription(
  platform: Platform,
  runtime: MessagingPlatformRuntimeInfo,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (runtime.connected) {
    if (platform === 'whatsapp' && runtime.identity) {
      return t('dialog.whatsapp.connectedAs', { name: runtime.identity })
    }
    if (platform === 'telegram' && runtime.identity) {
      return t('settings.messaging.telegram.validBot', { username: runtime.identity })
    }
    return t(`settings.messaging.${platform}.connected`, { defaultValue: 'Connected' })
  }
  if (runtime.state === 'connecting') {
    return t('dialog.whatsapp.starting', { defaultValue: 'Connecting…' })
  }
  if (runtime.state === 'error' && runtime.lastError) {
    return runtime.lastError
  }
  return t(`settings.messaging.${platform}.notConnected`, { defaultValue: 'Not connected' })
}

function defaultRuntime(platform: Platform): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}
