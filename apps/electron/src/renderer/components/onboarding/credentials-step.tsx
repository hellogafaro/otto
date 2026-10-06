/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpRight, Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import {
  ApiKeyInput,
  type ApiKeyStatus,
  type ApiKeySubmitData,
  OAuthConnect,
  type OAuthStatus,
} from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

/** How a connection signs in: a Claude, ChatGPT or Copilot subscription, or an API key (Anthropic or a provider preset). */
export type ApiSetupMethod =
  | 'anthropic_api_key'
  | 'claude_oauth'
  | 'pi_chatgpt_oauth'
  | 'pi_copilot_oauth'
  | 'pi_api_key'

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onBack: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
  // Device flow (Copilot)
  deviceCode?: { userCode: string; verificationUri: string }
  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  }
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  deviceCode,
  editInitialValues,
}: CredentialsStepProps) {
  const { t } = useTranslation()
  const isClaudeOAuth = apiSetupMethod === 'claude_oauth'
  const isChatGptOAuth = apiSetupMethod === 'pi_chatgpt_oauth'
  const isCopilotOAuth = apiSetupMethod === 'pi_copilot_oauth'
  const isPiApiKey = apiSetupMethod === 'pi_api_key'

  // Copilot device code clipboard handling
  const [copiedCode, setCopiedCode] = useState(false)

  // Auto-copy device code to clipboard when it appears
  useEffect(() => {
    if (deviceCode?.userCode) {
      navigator.clipboard.writeText(deviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      }).catch(() => {
        // Clipboard write failed, user can still click to copy
      })
    }
  }, [deviceCode?.userCode])

  const handleCopyCode = () => {
    if (deviceCode?.userCode) {
      navigator.clipboard.writeText(deviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      })
    }
  }

  // --- ChatGPT and Copilot: device code (the person approves the code on any device) ---
  if (isChatGptOAuth || isCopilotOAuth) {
    const provider = isChatGptOAuth
      ? {
          title: t("onboarding.credentials.connectChatGPT"),
          description: t("onboarding.credentials.connectChatGPTDesc"),
          signIn: t("onboarding.credentials.signInChatGPT"),
          enterCode: t("onboarding.credentials.enterCodeOnChatGPT"),
          waiting: t("onboarding.credentials.chatGPTInstructions"),
          connected: t("onboarding.credentials.chatGPTConnected"),
        }
      : {
          title: t("onboarding.credentials.connectGitHub"),
          description: t("onboarding.credentials.connectGitHubDesc"),
          signIn: t("onboarding.credentials.signInGitHub"),
          enterCode: t("onboarding.credentials.enterCodeOnGitHub"),
          waiting: t("onboarding.credentials.clickToSignInGitHub"),
          connected: t("onboarding.credentials.copilotConnected"),
        }
    const cancel = () => {
      if (isChatGptOAuth) void window.electronAPI.cancelChatGptOAuth()
      else void window.electronAPI.cancelCopilotOAuth()
      onBack()
    }
    return (
      <StepFormLayout
        title={provider.title}
        description={provider.description}
        actions={
          <>
            <BackButton onClick={cancel} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              loading={status === 'validating'}
            >
              {provider.signIn}
              <ArrowUpRight data-icon="inline-end" />
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-3">
          {deviceCode ? (
            <SettingsCard>
              <SettingsRow label={provider.enterCode}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCopyCode}
                  className="font-mono tracking-widest"
                >
                  {deviceCode.userCode}
                  {copiedCode ? <Check data-icon="inline-end" /> : <Copy data-icon="inline-end" />}
                </Button>
              </SettingsRow>
              <SettingsRow label={deviceCode.verificationUri.replace(/^https?:\/\//, "")}>
                <Button type="button" variant="ghost" onClick={() => void window.electronAPI.openUrl(deviceCode.verificationUri)}>
                  {t("common.open")}
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              </SettingsRow>
            </SettingsCard>
          ) : (
            <p className="text-sm text-muted-foreground">{provider.waiting}</p>
          )}
          {status === 'error' && errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
          {status === 'success' && <p className="text-xs text-success">{provider.connected}</p>}
        </div>
      </StepFormLayout>
    )
  }

  // --- Claude OAuth flow ---
  if (isClaudeOAuth) {
    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title={t("onboarding.credentials.enterAuthCode")}
          description={t("onboarding.credentials.copyCodeInstruction")}
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>{t("common.cancel")}</BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={false}
                loading={status === 'validating'}
              />
            </>
          }
        >
          <OAuthConnect
            status={status as OAuthStatus}
            errorMessage={errorMessage}
            isWaitingForCode={true}
            onStartOAuth={onStartOAuth!}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        </StepFormLayout>
      )
    }

    return (
      <StepFormLayout
        title={t("onboarding.credentials.connectClaude")}
        description={t("onboarding.credentials.claudeSubscriptionDesc")}
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              loading={status === 'validating'}
            >
              {t("onboarding.credentials.signInClaude")}
              <ArrowUpRight data-icon="inline-end" />
            </ContinueButton>
          </>
        }
      >
        <OAuthConnect
          status={status as OAuthStatus}
          errorMessage={errorMessage}
          isWaitingForCode={false}
          onStartOAuth={onStartOAuth!}
          onSubmitAuthCode={onSubmitAuthCode}
          onCancelOAuth={onCancelOAuth}
        />
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  // Determine provider type and description based on selected method
  const providerType = isPiApiKey ? 'pi_api_key' : 'anthropic'
  const apiKeyDescription = isPiApiKey
    ? "Select a provider preset and enter the API key. For arbitrary Anthropic-compatible endpoints, use Anthropic API Key mode."
    : "Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."

  const apiKeyInputKey = [
    apiSetupMethod,
    editInitialValues?.activePreset ?? '',
    editInitialValues?.baseUrl ?? '',
    editInitialValues?.connectionDefaultModel ?? '',
    (editInitialValues?.models ?? []).join('|'),
    editInitialValues?.customApi ?? '',
  ].join('::')

  return (
    <StepFormLayout
      title={t("onboarding.credentials.apiConfiguration")}
      description={apiKeyDescription}
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
          />
        </>
      }
    >
      <ApiKeyInput
        key={apiKeyInputKey}
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
        providerType={providerType}
        initialValues={editInitialValues}
      />
    </StepFormLayout>
  )
}
