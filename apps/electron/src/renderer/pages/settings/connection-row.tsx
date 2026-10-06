/**
 * ConnectionRow: one connection of Settings -> AI. The row leads with its provider's logo, the name (and "Default"
 * when it is the person's default), its kind and whose it is; a ⋯ menu holds the actions and a chevron opens its
 * editor, where what can change saves as it is edited (name, default model, what happens to a message sent while a
 * reply runs, a custom endpoint's address). A shared connection is read-only for anyone but an owner.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Ellipsis, KeyRound, LogIn, Star, TriangleAlert, Trash2, Zap } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/sonner'
import { ConnectionIcon } from '@/components/icons/connection-icon'
import { SettingsMenuSelectRow, SettingsRow } from '@/components/settings'
import { cn } from '@/lib/utils'
import { useAutosave } from '@/hooks/use-autosave'
import { useClaudeCodeStatus } from '@/hooks/use-claude-code-status'
import { CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE, resolveMidStreamBehavior, type MidStreamBehavior } from '@config/llm-connections'
import { isHttpUrl } from '@/components/onboarding/connection-kinds'
import type { LlmConnectionUpdate, LlmConnectionWithStatus } from '../../../shared/types'
import { connectionKindLabel, getModelOptionsForConnection, scopeLabel } from './connection-labels'

/** What the menu may do to a connection; absent actions are not offered. */
export interface ConnectionActions {
  /** Make it the person's default (absent while it already is). */
  onSetDefault?: () => void
  /** Sign in again (a device-code connection). */
  onSignIn?: () => void
  /** Replace its API key. */
  onChangeKey?: () => void
  onTest: () => void
  onDelete?: () => void
}

/** Saves the connection's own fields; throws with the server's message when it refuses. */
async function save(update: LlmConnectionUpdate): Promise<void> {
  const result = await window.electronAPI.saveLlmConnection(update)
  if (!result.success) throw new Error(result.error)
}

export function ConnectionRow({
  connection,
  editable,
  actions,
  onSaved,
}: {
  connection: LlmConnectionWithStatus
  /** Whether the person may change it: their own, or a shared one as an owner. */
  editable: boolean
  actions: ConnectionActions
  /** A field was saved: refresh the list. */
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const claude = connection.type === CLAUDE_CODE_CONNECTION_TYPE
  const claudeStatus = useClaudeCodeStatus(claude)
  const problem = claude && claudeStatus.status?.found === false
    ? t('connections.claudeCode.notFound')
    : !connection.isAuthenticated ? t('settings.ai.notAuthenticated') : null

  return (
    <>
      <SettingsRow
        list
        icon={<ConnectionIcon connection={connection} />}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{connection.name}</span>
            {connection.isDefault && <Badge variant="outline">{t('common.default')}</Badge>}
          </span>
        }
        // A problem leads the line, so a narrow row keeps it when the rest is cut
        description={[problem, connectionKindLabel(connection, t), scopeLabel(connection.scope, t)].filter(Boolean).join(' · ')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {actions.onSetDefault && (
              <DropdownMenuItem onClick={actions.onSetDefault}>
                <Star />
                {t('settings.ai.setAsDefault')}
              </DropdownMenuItem>
            )}
            {actions.onSignIn && (
              <DropdownMenuItem onClick={actions.onSignIn}>
                <LogIn />
                {t('connections.signInAgain')}
              </DropdownMenuItem>
            )}
            {actions.onChangeKey && (
              <DropdownMenuItem onClick={actions.onChangeKey}>
                <KeyRound />
                {t('connections.changeKey')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={actions.onTest}>
              <Zap />
              {t('settings.ai.validateConnection')}
            </DropdownMenuItem>
            {actions.onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={actions.onDelete}>
                  <Trash2 />
                  {t('common.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {editable ? (
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={t('connections.edit')}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
          </Button>
        ) : (
          // Keeps the actions column aligned on rows with no editor
          <span aria-hidden className="size-7" />
        )}
      </SettingsRow>
      {open && editable && <ConnectionEditor connection={connection} claude={claude ? claudeStatus : undefined} onSaved={onSaved} />}
    </>
  )
}

function ConnectionEditor({
  connection,
  claude,
  onSaved,
}: {
  connection: LlmConnectionWithStatus
  claude?: ReturnType<typeof useClaudeCodeStatus>
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { slug } = connection
  const name = useAutosave(connection.name, (value) => save({ slug, name: value }), { onSaved })
  const baseUrl = useAutosave(connection.baseUrl ?? '', (value) => save({ slug, baseUrl: value }), { onSaved })
  // What is typed, saved only while it is an address; it springs back on blur otherwise
  const [typedUrl, setTypedUrl] = useState(connection.baseUrl ?? '')
  const models = getModelOptionsForConnection(connection).map((o) => ({ ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description }))
  const midStream = resolveMidStreamBehavior(connection)

  const saveNow = (update: Omit<LlmConnectionUpdate, 'slug'>) =>
    save({ slug, ...update }).then(
      () => {
        toast.success(t('common.saved'), { id: 'saved' })
        onSaved()
      },
      (error: Error) => void toast.error(error.message, { id: 'saved' }),
    )

  return (
    <div className="divide-y divide-foreground/10">
      {claude && (
        <SettingsRow
          icon={claude.status?.found ? <Check className="text-success" /> : <TriangleAlert />}
          label={claude.status === null ? t('connections.claudeCode.checking') : claude.status.found ? t('connections.claudeCode.found') : t('connections.claudeCode.notFound')}
          description={claude.status?.found ? (claude.status.version ?? claude.status.path) : undefined}
        >
          <Button variant="outline" size="compact" loading={claude.checking} onClick={() => void claude.check()}>
            {t('connections.claudeCode.checkAgain')}
          </Button>
        </SettingsRow>
      )}
      <SettingsRow label={t('connections.form.name')}>
        <Input
          aria-label={t('connections.form.name')}
          value={name.value}
          onChange={(event) => name.change(event.target.value)}
          onBlur={() => {
            if (!name.value.trim()) name.change(connection.name)
            name.flush()
          }}
          className="w-[200px]"
        />
      </SettingsRow>
      {connection.type === CUSTOM_CONNECTION_TYPE && (
        <SettingsRow label={t('connections.form.baseUrl')}>
          <Input
            aria-label={t('connections.form.baseUrl')}
            type="url"
            value={typedUrl}
            onChange={(event) => {
              setTypedUrl(event.target.value)
              if (isHttpUrl(event.target.value)) baseUrl.change(event.target.value.trim())
            }}
            onBlur={() => {
              if (!isHttpUrl(typedUrl)) setTypedUrl(baseUrl.value)
              baseUrl.flush()
            }}
            className="w-[200px]"
          />
        </SettingsRow>
      )}
      {models.length > 0 && (
        <SettingsMenuSelectRow
          label={t('settings.ai.model')}
          value={connection.defaultModel ?? ''}
          options={models}
          onValueChange={(next) => next !== connection.defaultModel && void saveNow({ defaultModel: next })}
        />
      )}
      <SettingsMenuSelectRow
        label={t('settings.ai.midStream.title')}
        value={midStream}
        options={[
          { value: 'steer', label: t('settings.ai.midStream.steer') },
          { value: 'queue', label: t('settings.ai.midStream.queue') },
        ]}
        onValueChange={(next) => next !== midStream && void saveNow({ midStreamBehavior: next as MidStreamBehavior })}
      />
    </div>
  )
}
