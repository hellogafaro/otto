/**
 * ConnectionRow: one connection of Settings -> AI. The row leads with its provider's logo, the name (and "Default"
 * when it is the person's default), its kind and whose it is; a ⋯ menu holds the actions and a chevron opens its
 * editor, where what can change saves as it is edited (name, default model, what happens to a message sent while a
 * reply runs, a custom endpoint's address). A shared connection is read-only for anyone but an owner.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Ellipsis, KeyRound, Star, Trash2, Zap } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/sonner'
import { ConnectionIcon } from '@/components/icons/connection-icon'
import { SettingsMenuSelectRow, SettingsRow } from '@/components/settings'
import { cn } from '@/lib/utils'
import { useAutosave } from '@/hooks/use-autosave'
import type { LlmConnectionUpdate, LlmConnectionWithStatus } from '../../../shared/types'
import { connectionKindLabel, getModelOptionsForConnection, scopeLabel } from './connection-labels'
import { connectionSelector } from './provider-connection-form'
import { ConnectionEndpointForm } from './connection-endpoint-form'

/** What the menu may do to a connection; absent actions are not offered. */
export interface ConnectionActions {
  /** Make it the person's default (absent while it already is). */
  onSetDefault?: () => void
  /** Replace its API key. */
  onChangeKey?: () => void
  /** Test it with a real request; resolves to what the row shows. */
  onTest?: () => Promise<{ success: boolean; error?: string }>
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
  // The test takes seconds: the ⋯ button spins meanwhile, and the result leads the line for a few seconds
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  useEffect(() => {
    if (!testResult) return
    const timer = setTimeout(() => setTestResult(null), 8000)
    return () => clearTimeout(timer)
  }, [testResult])
  const test = async () => {
    if (!actions.onTest) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await actions.onTest()
      setTestResult(result.success ? t('connections.testPassed', { name: connection.name }) : t('settings.ai.validationFailed'))
    } catch {
      setTestResult(t('connections.testFailed'))
    } finally {
      setTesting(false)
    }
  }
  const problem = connection.authError ? t('settings.ai.validationFailed') : !connection.isAuthenticated ? t('settings.ai.notAuthenticated') : null

  return (
    <>
      <SettingsRow
        list
        icon={<ConnectionIcon connection={connection.type === 'custom' ? { ...connection, type: 'openai' } : connection} />}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{connection.name}</span>
            {connection.isDefault && <Badge variant="outline">{t('common.default')}</Badge>}
          </span>
        }
        // A test result or a problem leads the line, so a narrow row keeps it when the rest is cut
        description={[testResult ?? problem, connectionKindLabel(connection, t), scopeLabel(connection.scope, t)].filter(Boolean).join(' · ')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" loading={testing} aria-label={t('common.moreActions')} />}>
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {actions.onSetDefault && (
              <DropdownMenuItem onClick={actions.onSetDefault}>
                <Star />
                {t('settings.ai.setAsDefault')}
              </DropdownMenuItem>
            )}
            {actions.onChangeKey && (
              <DropdownMenuItem onClick={actions.onChangeKey}>
                <KeyRound />
                {t('connections.changeKey')}
              </DropdownMenuItem>
            )}
            {actions.onTest && (
              <DropdownMenuItem onClick={() => void test()}>
                <Zap />
                {t('settings.ai.validateConnection')}
              </DropdownMenuItem>
            )}
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
      {open && editable && <ConnectionEditor key={connection.id ?? `${connection.scope}:${connection.slug}`} connection={connection} onSaved={onSaved} />}
    </>
  )
}

function ConnectionEditor({
  connection,
  onSaved,
}: {
  connection: LlmConnectionWithStatus
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const identity = connectionSelector(connection)
  const name = useAutosave(connection.name, (value) => save({ ...identity, name: value }), { onSaved })
  const models = getModelOptionsForConnection(connection).map((o) => ({ ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description }))

  const saveNow = (update: Omit<LlmConnectionUpdate, 'slug'>) =>
    save({ ...identity, ...update }).then(
      () => {
        toast.success(t('common.saved'), { id: 'saved' })
        onSaved()
      },
      () => void toast.error(t('connections.saveFailed'), { id: 'saved' }),
    )

  return (
    <div className="divide-y divide-foreground/10">
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
      {models.length > 0 && (
        <SettingsMenuSelectRow
          label={t('settings.ai.model')}
          value={connection.defaultModel ?? ''}
          options={models}
          onValueChange={(next) => next !== connection.defaultModel && void saveNow({ defaultModel: next })}
        />
      )}
      <ConnectionEndpointForm key={`${connection.id}:${connection.updatedAt}`} connection={connection} onSaved={onSaved} />
    </div>
  )
}
