/**
 * TelegramAccessSection
 *
 * Live (non-playground) wrapper that loads owners / accessMode / pending
 * senders from the messaging registry and renders the workspace-level
 * access controls inside the Telegram tile in `MessagingSettingsPage`.
 *
 * Three visible parts:
 *  1. AccessModeBanner — only when `accessMode === 'open'`
 *  2. Collapsible "Allowed users" row (icon + chevron, mirrors PairedSupergroupSection)
 *     — expands to show OwnersListEditor with topic-row-style indent
 *  3. PendingSendersList + heading (rendered only when there are pending senders)
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { SettingsRow } from '@/components/settings'
import { messagingBindingsAtom } from '@/atoms/messaging'
import {
  AccessModeBanner,
  OwnersListEditor,
  PendingSendersList,
  type PendingSender,
  type PlatformAccessMode,
  type PlatformOwner,
} from './'

/**
 * Two pending entries reference the same row when they share platform,
 * userId, reason, AND bindingId (one binding row vs. another binding row
 * for the same sender stay separate).
 */
function sameRow(a: PendingSender, b: PendingSender): boolean {
  return (
    a.platform === b.platform &&
    a.userId === b.userId &&
    (a.reason ?? 'not-owner') === (b.reason ?? 'not-owner') &&
    (a.bindingId ?? null) === (b.bindingId ?? null)
  )
}

interface Props {
  workspaceId: string
  /** Workspace-level Telegram access mode. Controlled by the parent so the
   *  same source of truth drives the banner, the collapsible subtitle, and
   *  the platform-row dropdown's Lock-down / Unlock affordances. */
  accessMode: PlatformAccessMode
  onAccessModeChange: (mode: PlatformAccessMode) => void
}

export function TelegramAccessSection({ workspaceId, accessMode, onAccessModeChange }: Props) {
  const { t } = useTranslation()
  const allBindings = useAtomValue(messagingBindingsAtom)
  const [owners, setOwners] = React.useState<PlatformOwner[]>([])
  const [pending, setPending] = React.useState<PendingSender[]>([])

  // The banner stays visible whenever the bot is publicly addressable —
  // either at the workspace level (`accessMode === 'open'`) OR via any
  // legacy binding still in `'open'` mode. Without the second check, the
  // operator would see the banner disappear after clicking "Lock down"
  // even though concrete bindings are still letting strangers in.
  const hasOpenBinding = React.useMemo(
    () => allBindings.some((b) => b.platform === 'telegram' && b.accessMode === 'open'),
    [allBindings],
  )
  const showBanner = accessMode === 'open' || hasOpenBinding

  const loadAll = React.useCallback(async () => {
    const [o, p] = await Promise.all([
      window.electronAPI.getMessagingPlatformOwners('telegram').catch(() => []),
      window.electronAPI.getMessagingPendingSenders('telegram').catch(() => []),
    ])
    setOwners(o)
    setPending(p)
  }, [])

  React.useEffect(() => {
    void loadAll()
    const offBinding = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) void loadAll()
    })
    const offPending = window.electronAPI.onMessagingPendingChanged?.((wsId) => {
      if (wsId === workspaceId) void loadAll()
    })
    return () => {
      offBinding()
      offPending?.()
    }
  }, [workspaceId, loadAll])

  const handleLockDown = async () => {
    try {
      await window.electronAPI.setMessagingPlatformAccessMode('telegram', 'owner-only')
      toast.success(t('toast.messagingTelegramLockedDown'))
      onAccessModeChange('owner-only')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleRemoveOwner = async (userId: string) => {
    const next = owners.filter((o) => o.userId !== userId)
    try {
      await window.electronAPI.setMessagingPlatformOwners('telegram', next)
      setOwners(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove owner')
    }
  }

  const handleAllow = async (sender: PendingSender) => {
    try {
      const entryKey = {
        ...(sender.reason ? { reason: sender.reason } : {}),
        ...(sender.bindingId ? { bindingId: sender.bindingId } : {}),
      }
      const result = await window.electronAPI.allowMessagingPendingSender(
        'telegram',
        sender.userId,
        entryKey,
      )
      setOwners(result.owners)
      // Drop only the row we just acted on. Other pending rows for the
      // same sender (different reason / binding) stay visible until the
      // operator decides on each.
      setPending((prev) =>
        prev.filter((p) => !sameRow(p, sender)),
      )
      toast.success(`Allowed ${sender.displayName || sender.username || sender.userId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to allow sender')
    }
  }

  const handleIgnore = async (sender: PendingSender) => {
    try {
      await window.electronAPI.dismissMessagingPendingSender(
        'telegram',
        sender.userId,
        {
          ...(sender.reason ? { reason: sender.reason } : {}),
          ...(sender.bindingId ? { bindingId: sender.bindingId } : {}),
        },
      )
      setPending((prev) => prev.filter((p) => !sameRow(p, sender)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss sender')
    }
  }

  return (
    <>
      {showBanner && (
        <AccessModeBanner
          onLockDown={handleLockDown}
          // When the workspace is already locked but a binding is still
          // in 'open' mode, swap the copy so the operator knows what to
          // act on (the binding row, not the workspace toggle).
          {...(accessMode === 'owner-only' && hasOpenBinding
            ? {
                description: t(
                  'settings.messaging.telegram.access.banner.descriptionLegacyBinding',
                ),
              }
            : {})}
        />
      )}

      <SectionDivider />
      <AllowedUsersCollapsible
        owners={owners}
        accessMode={accessMode}
        onRemove={handleRemoveOwner}
      />

      {pending.length > 0 && (
        <>
          <SectionDivider />
          <SectionHeader
            title={t('settings.messaging.telegram.access.pendingRequestsTitle')}
            subtitle={t('settings.messaging.telegram.access.pendingRequestsSubtitle', {
              count: pending.length,
            })}
          />
          <PendingSendersList
            pending={pending}
            onAllow={handleAllow}
            onIgnore={handleIgnore}
          />
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Collapsible Allowed users — mirrors the PairedSupergroupSection structure
// so the two rows feel like siblings inside the Telegram card.
// ---------------------------------------------------------------------------

function AllowedUsersCollapsible({
  owners,
  accessMode,
  onRemove,
}: {
  owners: PlatformOwner[]
  accessMode: PlatformAccessMode
  onRemove: (userId: string) => void
}) {
  const { t } = useTranslation()
  // Default open when there are owners to draw the operator's eye to who's
  // on the list; closed when empty (the banner / pending list handles the
  // "do something" prompt instead).
  const [isExpanded, setIsExpanded] = React.useState(owners.length > 0)

  const subtitle =
    accessMode === 'open'
      ? t('settings.messaging.telegram.access.allowedUsersSubtitleOpen')
      : owners.length === 0
        ? t('settings.messaging.telegram.access.allowedUsersSubtitleEmpty')
        : t('settings.messaging.telegram.access.allowedUsersSubtitle', { count: owners.length })

  return (
    <div>
      <SettingsRow
        icon={<Users />}
        label={t('settings.messaging.telegram.access.allowedUsersTitle')}
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
              <OwnersListEditor
                owners={owners}
                enforced={accessMode === 'owner-only'}
                onRemove={onRemove}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SectionDivider() {
  return <div className="h-px bg-foreground/10" />
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {title}
      </div>
      <div className="mt-0.5 text-xs text-foreground/50">{subtitle}</div>
    </div>
  )
}
