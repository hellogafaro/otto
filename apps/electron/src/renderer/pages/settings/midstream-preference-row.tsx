import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserPreferences } from '@otto/shared/config'
import { SettingsCard, SettingsMenuSelectRow, SettingsRow, SettingsSection } from '@/components/settings'

export function MidstreamPreferenceRow() {
  const { t } = useTranslation()
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'load' | 'save' | null>(null)
  const mounted = useRef(false)
  const updating = useRef(false)

  useEffect(() => {
    mounted.current = true
    let canceled = false
    window.electronAPI.getUserPreferences().then((result) => {
      if (canceled) return
      if (result.midStreamBehavior !== 'steer' && result.midStreamBehavior !== 'queue') {
        setError('load')
        return
      }
      setPreferences(result)
    }).catch(() => {
      if (!canceled) setError('load')
    })
    return () => {
      canceled = true
      mounted.current = false
    }
  }, [])

  const chooseBehavior = async (behavior: string) => {
    if (!preferences || updating.current || (behavior !== 'steer' && behavior !== 'queue')) return
    updating.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.updateUserPreferences({ midStreamBehavior: behavior })
      if (!mounted.current) return
      if (result.midStreamBehavior !== 'steer' && result.midStreamBehavior !== 'queue') {
        setError('save')
        return
      }
      setPreferences(result)
    } catch {
      if (mounted.current) setError('save')
    } finally {
      updating.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <SettingsSection title={t('settings.general.messagesTitle', { defaultValue: 'Messages' })}>
      <SettingsCard>
        <SettingsMenuSelectRow
          label={t('settings.general.midStreamLabel', { defaultValue: 'Messages while working' })}
          description={t('settings.general.midStreamDescription', { defaultValue: 'Steer the current response or queue your message until it finishes.' })}
          value={preferences?.midStreamBehaviorNeedsReview ? 'queue' : preferences?.midStreamBehavior ?? ''}
          placeholder={t('common.loading')}
          disabled={!preferences || saving}
          onValueChange={chooseBehavior}
          options={[
            { value: 'steer', label: t('settings.general.midStreamSteer', { defaultValue: 'Steer' }) },
            { value: 'queue', label: t('settings.general.midStreamQueue', { defaultValue: 'Queue' }) },
          ]}
        />
        {preferences?.midStreamBehaviorNeedsReview && (
          <SettingsRow label={<span role="status">{t('settings.general.midStreamReview', { defaultValue: 'Previous provider settings disagree. Messages are queued until you choose Steer or Queue.' })}</span>} />
        )}
        {error && (
          <SettingsRow label={<span role="alert">{error === 'load'
            ? t('settings.general.midStreamLoadError', { defaultValue: 'Couldn’t load your message preference.' })
            : t('settings.general.midStreamSaveError', { defaultValue: 'Couldn’t save your message preference. Try again.' })}</span>} />
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
