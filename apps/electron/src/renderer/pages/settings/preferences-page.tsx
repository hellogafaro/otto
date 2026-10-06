/**
 * PreferencesPage
 *
 * Form-based editor for stored user preferences (~/.otto/preferences.json).
 * Features:
 * - Fixed input fields for known preferences (name, email, timezone, location, language)
 * - Free-form textarea for notes
 * - Auto-saves on change with debouncing
 */

import { SettingsPage } from '@/components/settings/settings-page'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@otto/ui'
import { isValidEmail } from '@otto/shared/utils/email'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsTextarea,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/edit-popover'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'preferences',
}

interface PreferencesFormState {
  name: string
  email: string
  timezone: string
  city: string
  country: string
  notes: string
}

type StoredPreferences = Record<string, unknown>

const emptyFormState: PreferencesFormState = {
  name: '',
  email: '',
  timezone: '',
  city: '',
  country: '',
  notes: '',
}

function parseStored(json: string): StoredPreferences {
  try {
    const prefs = JSON.parse(json)
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {}
  } catch {
    return {}
  }
}

// Stored preferences to form state
function toFormState(prefs: StoredPreferences): PreferencesFormState {
  const location = (prefs.location ?? {}) as { city?: string; country?: string }
  return {
    name: (prefs.name as string) || '',
    email: (prefs.email as string) || '',
    timezone: (prefs.timezone as string) || '',
    city: location.city || '',
    country: location.country || '',
    notes: (prefs.notes as string) || '',
  }
}

/** Empty is fine (no email); otherwise it must have a basic email shape. */
function isEmailAllowed(email: string): boolean {
  return email.trim() === '' || isValidEmail(email)
}

/**
 * Form state over the stored preferences: the fields this page does not edit
 * (uiLanguage, diffViewer, location.region, ...) are kept as stored, and an
 * email that is not valid yet keeps its last saved value instead of being saved.
 */
function buildPreferences(state: PreferencesFormState, stored: StoredPreferences): StoredPreferences {
  const prefs: StoredPreferences = { ...stored }
  const set = (key: string, value: string) => {
    if (value) prefs[key] = value
    else delete prefs[key]
  }

  set('name', state.name)
  set('timezone', state.timezone)
  set('notes', state.notes)
  if (isEmailAllowed(state.email)) set('email', state.email.trim())

  const location: Record<string, unknown> = { ...(stored.location as object | undefined) }
  for (const [key, value] of [['city', state.city], ['country', state.country]] as const) {
    if (value) location[key] = value
    else delete location[key]
  }
  if (Object.keys(location).length > 0) prefs.location = location
  else delete prefs.location

  delete prefs.updatedAt
  return prefs
}

export default function PreferencesPage() {
  const { t } = useTranslation()
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(true)
  const [preferencesPath, setPreferencesPath] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)
  const storedRef = useRef<StoredPreferences>({})

  // Keep formStateRef in sync for use in cleanup
  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  // Load stored user preferences on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        const stored = parseStored(result.content)
        const parsed = toFormState(stored)
        storedRef.current = stored
        setFormState(parsed)
        setPreferencesPath(result.path)
        lastSavedRef.current = JSON.stringify(buildPreferences(parsed, stored))
      } catch (err) {
        console.error('Failed to load stored user preferences:', err)
        setFormState(emptyFormState)
      } finally {
        setIsLoading(false)
        // Mark initial load as complete after a short delay
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      }
    }
    load()
  }, [])

  // Auto-save with debouncing
  useEffect(() => {
    // Skip auto-save during initial load
    if (isInitialLoadRef.current || isLoading) return

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 500ms
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const prefs = buildPreferences(formState, storedRef.current)
        const saved = JSON.stringify(prefs)
        if (saved === lastSavedRef.current) return
        const result = await window.electronAPI.writePreferences(JSON.stringify({ ...prefs, updatedAt: Date.now() }, null, 2))
        if (result.success) {
          lastSavedRef.current = saved
          storedRef.current = prefs
        } else {
          console.error('Failed to save preferences:', result.error)
        }
      } catch (err) {
        console.error('Failed to save preferences:', err)
      }
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formState, isLoading])

  // Force save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      // Clear any pending debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Check if there are unsaved changes and save immediately
      const prefs = buildPreferences(formStateRef.current, storedRef.current)
      if (lastSavedRef.current !== JSON.stringify(prefs) && !isInitialLoadRef.current) {
        // Fire and forget - we can't await in cleanup
        window.electronAPI.writePreferences(JSON.stringify({ ...prefs, updatedAt: Date.now() }, null, 2)).catch((err) => {
          console.error('Failed to save preferences on unmount:', err)
        })
      }
    }
  }, [])

  const updateField = useCallback(<K extends keyof PreferencesFormState>(
    field: K,
    value: PreferencesFormState[K]
  ) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  return (
    <SettingsPage subpage="preferences">{/* Basic Info */}
          <SettingsSection
            title={t("settings.preferences.basicInfo")}
            description={t("settings.preferences.basicInfoDesc")}
          >
            <SettingsCard>
              <SettingsInput
                label={t("settings.preferences.name")}
                description={t("settings.preferences.nameDesc")}
                value={formState.name}
                onChange={(v) => updateField('name', v)}
                placeholder={t("settings.preferences.namePlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.preferences.email")}
                description={t("settings.preferences.emailDesc")}
                type="email"
                value={formState.email}
                onChange={(v) => updateField('email', v)}
                placeholder={t("settings.preferences.emailPlaceholder")}
                error={isEmailAllowed(formState.email) ? undefined : t("settings.preferences.emailInvalid")}
                inCard
              />
              <SettingsInput
                label={t("settings.preferences.timezone")}
                description={t("settings.preferences.timezoneDesc")}
                value={formState.timezone}
                onChange={(v) => updateField('timezone', v)}
                placeholder={t("settings.preferences.timezonePlaceholder")}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Location */}
          <SettingsSection
            title={t("settings.preferences.location")}
            description={t("settings.preferences.locationDesc")}
          >
            <SettingsCard>
              <SettingsInput
                label={t("settings.preferences.city")}
                description={t("settings.preferences.cityDesc")}
                value={formState.city}
                onChange={(v) => updateField('city', v)}
                placeholder={t("settings.preferences.cityPlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.preferences.country")}
                description={t("settings.preferences.countryDesc")}
                value={formState.country}
                onChange={(v) => updateField('country', v)}
                placeholder={t("settings.preferences.countryPlaceholder")}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Notes */}
          <SettingsSection
            title={t("settings.preferences.notes")}
            description={t("settings.preferences.notesDesc")}
            action={
              // EditPopover for AI-assisted notes editing with "Edit File" as secondary action
              preferencesPath ? (
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('preferences-notes', preferencesPath)}
                  secondaryAction={{
                    label: t("common.editFile"),
                    filePath: preferencesPath!,
                  }}
                />
              ) : null
            }
          >
            <SettingsCard>
              <SettingsTextarea
                value={formState.notes}
                onChange={(v) => updateField('notes', v)}
                placeholder={t("settings.preferences.notesPlaceholder")}
                rows={5}
                inCard
              />
            </SettingsCard>
          </SettingsSection>
    </SettingsPage>
  )
}
