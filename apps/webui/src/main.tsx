import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { RouterProvider } from '@tanstack/react-router'
import App from './app'
import { createAppRouter } from '@/router/router'
import type { RootProps } from '@/router/route-tree'
import { ThemeProvider } from '@/context/theme-context'
import { Toaster } from '@workspace/ui/components/sonner'
import { NotFoundPage } from '@/pages/not-found-page'
import { LoginPage } from './login-page'
import { setupI18n } from '@otto/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { useTranslation } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import './index.css'
import { installViewportRoot } from './viewport'

// Initialize i18n before any React rendering
setupI18n([LanguageDetector, initReactI18next])

function CrashFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{t("auth.somethingWentWrong")}</p>
      <p className="text-[13px]">{t("errors.pleaseReload")}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background text-[13px] text-foreground/70 cursor-pointer"
      >
        {t("common.reload")}
      </button>
    </div>
  )
}

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<CrashFallback />}>
      {children}
    </React.Suspense>
  )
}

// The router's root route: it owns the URL and history above the app (see docs/routing.md). A URL with no view shows only the not-found page, `/login` only the sign-in page.
function Root({ notFound, login }: RootProps) {
  return (
    <ThemeProvider>
      {notFound ? <NotFoundPage /> : login ? <LoginPage /> : <App />}
      <Toaster />
    </ThemeProvider>
  )
}

const router = createAppRouter(Root)

const root = document.getElementById('root')!
const cleanupViewport = installViewportRoot(root)
if (import.meta.hot) import.meta.hot.dispose(cleanupViewport)

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <JotaiProvider>
        <RouterProvider router={router} />
      </JotaiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
