/**
 * LocalModelStep — Onboarding step for local model configuration (Ollama).
 *
 * Shows endpoint URL and model fields only — no API key input.
 * Pre-filled with Ollama defaults (localhost:11434, qwen3-coder).
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

export interface LocalModelSubmitData {
  baseUrl: string
  model: string
  models: string[]
}

interface LocalModelStepProps {
  onSubmit: (data: LocalModelSubmitData) => void
  onBack: () => void
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function LocalModelStep({
  onSubmit,
  onBack,
  status = 'idle',
  errorMessage,
}: LocalModelStepProps) {
  const { t } = useTranslation()
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [model, setModel] = useState('qwen3-coder')
  const [modelError, setModelError] = useState<string | null>(null)

  const isDisabled = status === 'validating'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUrl = baseUrl.trim()
    const parsedModels = parseModelList(model)

    if (!trimmedUrl) {
      setModelError(t('onboarding.localModel.endpointRequired'))
      return
    }
    if (parsedModels.length === 0) {
      setModelError(t('onboarding.localModel.modelRequired'))
      return
    }

    setModelError(null)
    onSubmit({
      baseUrl: trimmedUrl,
      model: parsedModels[0],
      models: parsedModels,
    })
  }

  return (
    <StepFormLayout
      title={t("onboarding.localModel.title")}
      description={t("onboarding.localModel.description")}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isDisabled} />
          <ContinueButton
            type="submit"
            form="local-model-form"
            disabled={false}
            loading={status === 'validating'}
          />
        </>
      }
    >
      <form id="local-model-form" onSubmit={handleSubmit} className="space-y-3">
        <SettingsCard>
          <SettingsRow label={<Label htmlFor="local-base-url">{t("onboarding.localModel.endpoint")}</Label>}>
            <Input
              id="local-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t("onboarding.localModel.endpointPlaceholder")}
              className="w-60"
              disabled={isDisabled}
              autoFocus
            />
          </SettingsRow>
          <SettingsRow label={<Label htmlFor="local-model">{t("onboarding.localModel.model")}</Label>}>
            <Input
              id="local-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setModelError(null)
              }}
              placeholder={t("onboarding.localModel.modelPlaceholder")}
              className="w-60"
              aria-invalid={!!modelError || undefined}
              disabled={isDisabled}
            />
          </SettingsRow>
        </SettingsCard>
        <p className="px-1 text-xs text-muted-foreground">{t("onboarding.localModel.endpointHelper")}</p>
        <p className="px-1 text-xs text-muted-foreground">{t("onboarding.localModel.modelHelper")}</p>
        {(modelError || (status === 'error' && errorMessage)) && (
          <p className="px-1 text-sm text-destructive">{modelError ?? errorMessage}</p>
        )}
      </form>
    </StepFormLayout>
  )
}
