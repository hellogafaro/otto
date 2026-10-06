/**
 * DecisionModelSection: Settings -> AI, the opt-in decision layer (Jev / TypeSafe System One). The card is always
 * shown; everything behind it stays off until the person enables it.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings2 } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { Button } from '@/components/ui/button'
import { toast } from '@workspace/ui/components/sonner'
import { DECISION_SETTINGS_CHANGED_EVENT } from '@/atoms/permission-modes'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsMenuSelectRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import type { LlmConnectionWithStatus } from '../../../shared/types'
import type { DecisionLayerFeature, DecisionLayerStatus, DecisionLayerSettingsPatch, DecisionProviderId, DecisionServerProbe, DecisionTestResult } from '../../../shared/types'

export function DecisionModelSection({ llmConnections }: { llmConnections: LlmConnectionWithStatus[] }) {
  const { t } = useTranslation()
  // The card is always shown; everything behind it stays off until the user enables it.
  const [decisionStatus, setDecisionStatus] = useState<DecisionLayerStatus | null>(null)
  const [decisionAdvancedOpen, setDecisionAdvancedOpen] = useState(false)
  const [decisionKeyDraft, setDecisionKeyDraft] = useState('')
  const [decisionModelDraft, setDecisionModelDraft] = useState('')
  const [decisionBaseUrlDraft, setDecisionBaseUrlDraft] = useState('')
  const [decisionTesting, setDecisionTesting] = useState(false)
  const [decisionTestResult, setDecisionTestResult] = useState<DecisionTestResult | null>(null)
  // Local servers (Laya, custom): GET /health so the card can say whether the server is up.
  const [decisionProbe, setDecisionProbe] = useState<DecisionServerProbe | null>(null)
  const [decisionProbing, setDecisionProbing] = useState(false)
  // Drafts are seeded from stored settings once (and after a provider switch),
  // never on background refreshes, so in-progress typing is not clobbered.
  const decisionDraftsSeededRef = useRef(false)


  // ---- Decision model (Jev) ----
  const refreshDecisionStatus = useCallback(async (seedDrafts: boolean) => {
    if (typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    try {
      const status = await window.electronAPI.getDecisionLayerStatus()
      setDecisionStatus(status)
      if (seedDrafts) {
        setDecisionModelDraft(status.settings.model ?? '')
        setDecisionBaseUrlDraft(status.settings.baseUrl ?? '')
        decisionDraftsSeededRef.current = true
      }
    } catch (error) {
      console.error('Failed to load decision model settings:', error)
    }
  }, [])

  // Reusable connections come from the LLM connection list, so refresh with it
  // (background model fetches re-emit that list; only the first load seeds drafts).
  useEffect(() => {
    void refreshDecisionStatus(!decisionDraftsSeededRef.current)
  }, [refreshDecisionStatus, llmConnections])

  const updateDecisionSettings = useCallback(async (patch: DecisionLayerSettingsPatch) => {
    try {
      const next = await window.electronAPI.setDecisionLayerSettings(patch)
      setDecisionStatus(prev => (prev ? { ...prev, settings: next } : prev))
      setDecisionTestResult(null)
      // Mode pickers offer Guarded mode only while it is on: let them refresh.
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
      // A provider/connection switch drops the model + base URL overrides server-side
      // (they belonged to the previous provider) — mirror that in the inputs.
      if ('provider' in patch || 'connectionSlug' in patch) {
        setDecisionModelDraft(next.model ?? '')
        setDecisionBaseUrlDraft(next.baseUrl ?? '')
      }
    } catch (error) {
      console.error('Failed to update decision model settings:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [t])

  const decisionPreset = useMemo(
    () => decisionStatus?.presets.find(p => p.id === decisionStatus.settings.provider),
    [decisionStatus],
  )
  // Decision-model features for Advanced settings, grouped by what they touch.
  // Literal t() keys keep the i18n coverage check effective.
  const decisionFeatureGroups: Array<{ id: string; title: string; toggles: Array<{ feature: DecisionLayerFeature; label: string; description: string; tooltip: string }> }> = [
    { id: 'agent', title: t("settings.ai.decisions.groupAgent"), toggles: [
      { feature: 'decideTool', label: t("settings.ai.decisions.featureDecideTool"), description: t("settings.ai.decisions.featureDecideToolDesc"), tooltip: t("settings.ai.decisions.featureDecideToolTooltip") },
      { feature: 'suggestions', label: t("settings.ai.decisions.featureSuggestions"), description: t("settings.ai.decisions.featureSuggestionsDesc"), tooltip: t("settings.ai.decisions.featureSuggestionsTooltip") },
      { feature: 'adaptiveThinking', label: t("settings.ai.decisions.featureAdaptiveThinking"), description: t("settings.ai.decisions.featureAdaptiveThinkingDesc"), tooltip: t("settings.ai.decisions.featureAdaptiveThinkingTooltip") },
      { feature: 'largeResults', label: t("settings.ai.decisions.featureLargeResults"), description: t("settings.ai.decisions.featureLargeResultsDesc"), tooltip: t("settings.ai.decisions.featureLargeResultsTooltip") },
    ] },
    { id: 'conversation', title: t("settings.ai.decisions.groupConversation"), toggles: [
      { feature: 'midTurnMessages', label: t("settings.ai.decisions.featureMidTurnMessages"), description: t("settings.ai.decisions.featureMidTurnMessagesDesc"), tooltip: t("settings.ai.decisions.featureMidTurnMessagesTooltip") },
      { feature: 'turnOutcome', label: t("settings.ai.decisions.featureTurnOutcome"), description: t("settings.ai.decisions.featureTurnOutcomeDesc"), tooltip: t("settings.ai.decisions.featureTurnOutcomeTooltip") },
      { feature: 'smartTitles', label: t("settings.ai.decisions.featureSmartTitles"), description: t("settings.ai.decisions.featureSmartTitlesDesc"), tooltip: t("settings.ai.decisions.featureSmartTitlesTooltip") },
    ] },
    { id: 'permissions', title: t("settings.ai.decisions.groupPermissions"), toggles: [
      { feature: 'guardedMode', label: t("settings.ai.decisions.featureGuardedMode"), description: t("settings.ai.decisions.featureGuardedModeDesc"), tooltip: t("settings.ai.decisions.featureGuardedModeTooltip") },
      { feature: 'riskBadges', label: t("settings.ai.decisions.featureRiskBadges"), description: t("settings.ai.decisions.featureRiskBadgesDesc"), tooltip: t("settings.ai.decisions.featureRiskBadgesTooltip") },
    ] },
    { id: 'automations', title: t("settings.ai.decisions.groupAutomations"), toggles: [
      { feature: 'semanticLabels', label: t("settings.ai.decisions.featureSemanticLabels"), description: t("settings.ai.decisions.featureSemanticLabelsDesc"), tooltip: t("settings.ai.decisions.featureSemanticLabelsTooltip") },
      { feature: 'automationConditions', label: t("settings.ai.decisions.featureAutomationConditions"), description: t("settings.ai.decisions.featureAutomationConditionsDesc"), tooltip: t("settings.ai.decisions.featureAutomationConditionsTooltip") },
    ] },
  ]
  // A remote server on an older version reports fewer features: show and count only what it knows.
  const decisionReportedGroups = decisionStatus
    ? decisionFeatureGroups
      .map(group => ({ ...group, toggles: group.toggles.filter(({ feature }) => feature in decisionStatus.settings.features) }))
      .filter(group => group.toggles.length > 0)
    : []
  const decisionReportedToggles = decisionReportedGroups.flatMap(group => group.toggles)
  const decisionFeaturesOn = decisionReportedToggles.filter(({ feature }) => decisionStatus?.settings.features[feature]).length
  const decisionKeySourceValue = decisionStatus?.settings.connectionSlug
    ? `connection:${decisionStatus.settings.connectionSlug}`
    : `provider:${decisionStatus?.settings.provider ?? 'typesafe'}`
  const decisionKeySourceOptions = useMemo(() => {
    if (!decisionStatus) return []
    return [
      ...decisionStatus.presets.map(p => ({
        value: `provider:${p.id}`,
        label: p.label,
        description: p.local
          ? (p.id === 'custom' ? t("settings.ai.decisions.customProviderDesc") : t("settings.ai.decisions.localProviderDesc"))
          : p.baseUrl,
      })),
      ...decisionStatus.reusableConnections.map(c => ({
        value: `connection:${c.slug}`,
        label: t("settings.ai.decisions.reuseConnection", { name: c.name }),
        description: decisionStatus.presets.find(p => p.id === c.provider)?.label ?? c.provider,
      })),
    ]
  }, [decisionStatus, t])
  const decisionHasStoredKey = !!decisionStatus && decisionStatus.providersWithKey.includes(decisionStatus.settings.provider)
  const decisionKeyHelpUrl = decisionPreset?.dashboardUrl ?? decisionPreset?.docsUrl
  const decisionUsesConnection = !!decisionStatus?.settings.connectionSlug
  // Local presets (Laya, custom) expose the base URL and a server probe instead of a key hint.
  const decisionUsesLocalProvider = !!decisionPreset?.local && !decisionUsesConnection
  const decisionUsesCustomProvider = decisionStatus?.settings.provider === 'custom' && !decisionUsesConnection

  const probeDecisionServer = useCallback(async (baseUrl?: string) => {
    if (typeof window.electronAPI?.probeDecisionServer !== 'function') return
    setDecisionProbing(true)
    try {
      setDecisionProbe(await window.electronAPI.probeDecisionServer(baseUrl ? { baseUrl } : undefined))
    } catch (error) {
      console.error('Failed to probe decision server:', error)
      setDecisionProbe(null)
    } finally {
      setDecisionProbing(false)
    }
  }, [])

  // Probe whenever a local provider is selected or its base URL changes on disk.
  useEffect(() => {
    if (!decisionUsesLocalProvider) { setDecisionProbe(null); return }
    void probeDecisionServer()
  }, [decisionUsesLocalProvider, decisionStatus?.settings.provider, decisionStatus?.settings.baseUrl, probeDecisionServer])

  const decisionProbeDescription = decisionProbing || (decisionUsesLocalProvider && !decisionProbe)
    ? undefined
    : decisionProbe?.reachable && decisionProbe.health
      ? t("settings.ai.decisions.localServerRunning", { url: decisionProbe.baseUrl, models: decisionProbe.health.loaded?.length ? decisionProbe.health.loaded.join(', ') : '—' })
      : decisionProbe?.reachable
        ? t("settings.ai.decisions.localServerReachable", { url: decisionProbe.baseUrl })
        : t("settings.ai.decisions.localServerUnreachable", { url: decisionProbe?.baseUrl ?? '' })

  const handleDecisionKeySourceChange = useCallback((value: string) => {
    setDecisionKeyDraft('')
    if (value.startsWith('connection:')) {
      const slug = value.slice('connection:'.length)
      const provider = decisionStatus?.reusableConnections.find(c => c.slug === slug)?.provider
      void updateDecisionSettings({ connectionSlug: slug, ...(provider ? { provider } : {}) })
    } else if (value.startsWith('provider:')) {
      void updateDecisionSettings({ connectionSlug: null, provider: value.slice('provider:'.length) as DecisionProviderId })
    }
  }, [decisionStatus, updateDecisionSettings])

  const commitDecisionField = useCallback((field: 'model' | 'baseUrl', value: string) => {
    const current = decisionStatus?.settings[field] ?? ''
    if (value.trim() === current) return
    void updateDecisionSettings({ [field]: value.trim() || null })
  }, [decisionStatus, updateDecisionSettings])

  const handleSaveDecisionKey = useCallback(async () => {
    if (!decisionStatus || !decisionKeyDraft.trim()) return
    try {
      await window.electronAPI.setDecisionApiKey(decisionStatus.settings.provider, decisionKeyDraft.trim())
      setDecisionKeyDraft('')
      toast.success(t("settings.ai.decisions.keySaved"))
      await refreshDecisionStatus(false)
    } catch (error) {
      console.error('Failed to save decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, decisionKeyDraft, refreshDecisionStatus, t])

  const handleRemoveDecisionKey = useCallback(async () => {
    if (!decisionStatus) return
    try {
      await window.electronAPI.deleteDecisionApiKey(decisionStatus.settings.provider)
      toast.success(t("settings.ai.decisions.keyRemoved"))
      await refreshDecisionStatus(false)
    } catch (error) {
      console.error('Failed to remove decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, refreshDecisionStatus, t])

  const handleTestDecision = useCallback(async () => {
    setDecisionTesting(true)
    setDecisionTestResult(null)
    try {
      const result = await window.electronAPI.testDecisionConnection({
        settings: { model: decisionModelDraft.trim() || null, baseUrl: decisionBaseUrlDraft.trim() || null },
        apiKey: decisionKeyDraft.trim() || undefined,
      })
      setDecisionTestResult(result)
    } catch (error) {
      setDecisionTestResult({ ok: false, failure: { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      setDecisionTesting(false)
    }
  }, [decisionModelDraft, decisionBaseUrlDraft, decisionKeyDraft])

  const decisionTestDescription = decisionTestResult
    ? decisionTestResult.ok
      ? t("settings.ai.decisions.testSuccess", { model: decisionTestResult.model, latency: decisionTestResult.latencyMs })
      : t("settings.ai.decisions.testFailed", { message: decisionTestResult.failure.message })
    : t("settings.ai.decisions.testDesc")


  if (!decisionStatus) return null

  return (
                <SettingsSection title={t("settings.ai.decisions.title")} description={t("settings.ai.decisions.sectionDesc")}>
                  <SettingsCard>
                    <SettingsToggle
                      label={t("settings.ai.decisions.enable")}
                      description={t("settings.ai.decisions.enableDesc")}
                      checked={decisionStatus.settings.enabled}
                      onCheckedChange={(enabled) => { void updateDecisionSettings({ enabled }) }}
                    />
                    <SettingsMenuSelectRow
                      label={t("settings.ai.decisions.keySource")}
                      description={t("settings.ai.decisions.keySourceDesc")}
                      value={decisionKeySourceValue}
                      onValueChange={handleDecisionKeySourceChange}
                      options={decisionKeySourceOptions}
                      menuWidth={340}
                    />
                    {decisionUsesLocalProvider && (
                      <SettingsInput
                        inCard
                        type="url"
                        label={t("settings.ai.decisions.baseUrl")}
                        description={decisionUsesCustomProvider ? t("settings.ai.decisions.baseUrlDesc") : t("settings.ai.decisions.baseUrlLocalDesc")}
                        value={decisionBaseUrlDraft}
                        onChange={setDecisionBaseUrlDraft}
                        onBlur={() => commitDecisionField('baseUrl', decisionBaseUrlDraft)}
                        placeholder={decisionPreset?.baseUrl || 'http://localhost:8080'}
                      />
                    )}
                    {decisionUsesLocalProvider && (
                      <SettingsRow
                        label={t("settings.ai.decisions.localServer")}
                        description={decisionProbeDescription}
                      >
                        {decisionPreset?.docsUrl && (
                          <Button
                            variant="outline"
                            size="compact"
                            onClick={() => window.electronAPI?.openUrl(decisionPreset.docsUrl!)}
                          >
                            {t("settings.ai.decisions.localServerDocs")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="compact"
                          onClick={() => { void probeDecisionServer(decisionBaseUrlDraft.trim() || undefined) }}
                          loading={decisionProbing}
                        >
                          {t("settings.ai.decisions.recheck")}
                        </Button>
                      </SettingsRow>
                    )}
                    {decisionUsesLocalProvider && decisionPreset?.installHint && decisionProbe && !decisionProbe.reachable && (
                      <p className="px-4 py-3 text-xs text-muted-foreground">
                        {t("settings.ai.decisions.localServerInstallHint")}{' '}
                        <code className="font-mono text-[11px] text-foreground/80 select-all">{decisionPreset.installHint}</code>
                      </p>
                    )}
                    {!decisionUsesConnection && (
                      decisionHasStoredKey ? (
                        <SettingsRow
                          label={t("settings.ai.decisions.apiKey")}
                          description={t("settings.ai.decisions.apiKeySaved")}
                        >
                          <Button
                            variant="outline"
                            size="compact"
                            onClick={handleRemoveDecisionKey}
                          >
                            {t("settings.ai.decisions.removeKey")}
                          </Button>
                        </SettingsRow>
                      ) : (
                        <SettingsInput
                          inCard
                          type="password"
                          label={t("settings.ai.decisions.apiKey")}
                          description={decisionKeyHelpUrl
                            ? t("settings.ai.decisions.apiKeyDesc", { url: decisionKeyHelpUrl })
                            : t("settings.ai.decisions.apiKeyDescGeneric")}
                          value={decisionKeyDraft}
                          onChange={setDecisionKeyDraft}
                          placeholder={decisionPreset?.keyPlaceholder}
                          action={(
                            <Button
                              variant="outline"
                              size="compact"
                              onClick={handleSaveDecisionKey}
                              disabled={!decisionKeyDraft.trim()}
                            >
                              {t("settings.ai.decisions.saveKey")}
                            </Button>
                          )}
                        />
                      )
                    )}
                    <SettingsInput
                      inCard
                      label={t("settings.ai.decisions.model")}
                      description={t("settings.ai.decisions.modelDesc")}
                      value={decisionModelDraft}
                      onChange={setDecisionModelDraft}
                      onBlur={() => commitDecisionField('model', decisionModelDraft)}
                      placeholder={decisionPreset?.defaultModel}
                    />
                    <SettingsRow
                      label={t("settings.ai.decisions.test")}
                      description={decisionTestDescription}
                    >
                      <Button
                        variant="outline"
                        size="compact"
                        onClick={handleTestDecision}
                        loading={decisionTesting}
                      >
                        {t("settings.ai.decisions.testRun")}
                      </Button>
                    </SettingsRow>
                    <p className="px-4 py-3 text-xs text-muted-foreground">
                      {t("settings.ai.decisions.privacyNote")}
                    </p>
                  </SettingsCard>

                  {/* Advanced settings: what the decision model is used for, collapsed by default.
                      Same structure as the Workspace Overrides cards: the toggles expand inside the card. */}
                  <SettingsCard>
                    <SettingsRow
                      expanded={decisionAdvancedOpen}
                      onClick={() => setDecisionAdvancedOpen(open => !open)}
                      icon={<Settings2 />}
                      label={t("settings.ai.decisions.advanced")}
                      description={decisionStatus.settings.enabled
                        ? t("settings.ai.decisions.advancedSummary", { on: decisionFeaturesOn, total: decisionReportedToggles.length })
                        : t("settings.ai.decisions.advancedSummaryOff")}
                    />

                    <AnimatePresence initial={false}>
                      {decisionAdvancedOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="divide-y divide-foreground/10">
                            {decisionReportedGroups.map((group) => (
                              <div key={group.id}>
                                <div className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {group.title}
                                </div>
                                <div className="divide-y divide-foreground/10">
                                  {group.toggles.map(({ feature, label, description, tooltip }) => (
                                    <SettingsToggle
                                      key={feature}
                                      label={label}
                                      description={description}
                                      tooltip={tooltip}
                                      checked={decisionStatus.settings.features[feature] ?? false}
                                      disabled={!decisionStatus.settings.enabled}
                                      onCheckedChange={(checked) => { void updateDecisionSettings({ features: { [feature]: checked } }) }}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </SettingsCard>
                </SettingsSection>
  )
}
