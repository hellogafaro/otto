import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@craft-agent/ui"
import { StepFormLayout } from "./primitives"

interface ReauthScreenProps {
  onLogin: () => Promise<void>
  onReset: () => void
}

/**
 * ReauthScreen - Simple re-login screen for expired sessions
 *
 * Shown when the user has existing workspaces/config but the Craft token
 * is missing or expired. Much simpler than full onboarding - just re-authenticate.
 */
export function ReauthScreen({ onLogin, onReset }: ReauthScreenProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        <StepFormLayout
          iconElement={
            <div className="flex size-16 items-center justify-center rounded-full bg-info/10">
              <AlertCircle className="size-8 text-info" />
            </div>
          }
          title={t("onboarding.reauth.title")}
          description={
            <>
              {t("onboarding.reauth.expired")}
              <br />
              {t("onboarding.reauth.loginAgain")}
              <br />
              <span className="text-muted-foreground/70 text-xs mt-2 block">
                {t("onboarding.reauth.preserved")}
              </span>
            </>
          }
          actions={
            <div className="flex w-full flex-col gap-2">
              <Button onClick={handleLogin} disabled={isLoading} className="w-full">
                {isLoading ? (
                  <Spinner />
                ) : (
                  <>
                    <RefreshCw />
                    {t("onboarding.reauth.loginWithCraft")}
                  </>
                )}
              </Button>
              <Button variant="ghost" onClick={onReset} disabled={isLoading} className="w-full">
                {t("onboarding.reauth.resetApp")}
              </Button>
            </div>
          }
        >
          {error && (
            <p className="mt-4 px-1 text-sm text-destructive">{error}</p>
          )}
        </StepFormLayout>
      </main>
    </div>
  )
}
