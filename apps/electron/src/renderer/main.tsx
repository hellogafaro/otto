import React from 'react'
import ReactDOM from 'react-dom/client'
import { init as sentryInit } from '@sentry/electron/renderer'
import * as Sentry from '@sentry/react'
import { captureConsoleIntegration } from '@sentry/react'
import { Provider as JotaiProvider } from 'jotai'
import { RouterProvider } from '@tanstack/react-router'
import App from './app'
import { createAppRouter } from './router/router'
import { ThemeProvider } from './context/theme-context'
import { Toaster } from '@/components/ui/sonner'
import { setupI18n, i18n } from '@otto/shared/i18n'
import { redactSensitiveHeadersInPlace, redactSensitiveKeysInPlace } from '@otto/shared/utils/redaction'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { Button } from '@/components/ui/button'
import './index.css'

// Initialize i18n before any React rendering
setupI18n([LanguageDetector, initReactI18next])

// One-shot bootstrap: ensure the main process's i18n + preferences.json learn
// the language we just restored from localStorage. The main-process IPC handler
// validates the code and persists idempotently, so this is safe to run on every
// renderer startup. Without this push, a freshly-installed (or freshly-upgraded)
// app would still generate titles in English until the user manually re-picks
// the language in Appearance.
const resolvedLanguage = i18n.resolvedLanguage
// Diagnostic: console-log the bootstrap push so it shows up in DevTools and
// (via captureConsoleIntegration) in Sentry, alongside the main-process
// [i18n] startup hydration log. If these two diverge, the renderer's
// localStorage isn't tracking the user's Appearance selection.
console.info('[i18n] renderer bootstrap push', {
  resolvedLanguage: resolvedLanguage ?? null,
  localStorageI18nextLng: typeof window !== 'undefined' ? window.localStorage?.getItem('i18nextLng') : null,
})
if (resolvedLanguage) {
  void window.electronAPI?.changeLanguage?.(resolvedLanguage)
}

// Known-harmless console messages that should NOT be sent to Sentry.
// These are dev-mode noise or expected warnings that aren't actionable.
const IGNORED_CONSOLE_PATTERNS = [
  // React StrictMode dev warnings about non-boolean DOM attributes
  'Received `true` for a non-boolean attribute',
  'Received `false` for a non-boolean attribute',
  // Duplicate Shiki theme registration (expected on HMR reload)
  'theme name already registered',
]

// Initialize Sentry in the renderer process using the dual-init pattern.
// Combines Electron IPC transport (sentryInit) with React error boundary support (sentryReactInit).
// DSN and config are inherited from the main process init.
//
// captureConsoleIntegration promotes console.error calls into Sentry events,
// giving Sentry the same rich context visible in DevTools without needing sourcemaps.
//
// NOTE: Source map upload is intentionally disabled — see main/index.ts for details.
sentryInit(
  {
    integrations: [captureConsoleIntegration({ levels: ['error'] })],

    beforeSend(event) {
      // Drop events matching known-harmless console patterns to avoid Sentry quota waste
      const message = event.message || event.exception?.values?.[0]?.value || ''
      if (IGNORED_CONSOLE_PATTERNS.some((pattern) => message.includes(pattern))) {
        return null
      }

      // Scrub sensitive data (shared logic with the main process hook).
      // The header scrub was previously missing here — renderer drift, fixed
      // by moving both hooks onto @otto/shared/utils redaction.ts.
      if (event.request?.headers) {
        redactSensitiveHeadersInPlace(event.request.headers)
      }
      if (event.breadcrumbs) {
        for (const breadcrumb of event.breadcrumbs) {
          if (breadcrumb.data) {
            redactSensitiveKeysInPlace(breadcrumb.data)
          }
        }
      }

      return event
    },
  },
  Sentry.init,
)

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 * Sentry.ErrorBoundary captures the error and sends it to Sentry automatically.
 */
function CrashFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{i18n.t('crash.somethingWentWrong')}</p>
      <p className="text-[13px]">{i18n.t('crash.restartPrompt')}</p>
      <Button variant="outline" size="compact" className="mt-2" onClick={() => window.location.reload()}>
        {i18n.t('crash.reload')}
      </Button>
    </div>
  )
}

/**
 * Root component - renders App in the theme and toast providers. It is the router's root route:
 * the router owns the URL and history above the app, and the app renders one view from it.
 */
function Root() {
  return (
    <ThemeProvider>
      <App />
      <Toaster />
    </ThemeProvider>
  )
}

const router = createAppRouter(Root)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <JotaiProvider>
        <RouterProvider router={router} />
      </JotaiProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
