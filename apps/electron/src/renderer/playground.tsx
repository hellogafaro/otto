// IMPORTANT: keep `mock-utils` as the FIRST local import. It installs the
// mock `window.electronAPI` as a top-level side effect on import, so that
// any renderer module that reads `window.electronAPI.*` at module-load time
// (e.g. `session-files-section.tsx`'s top-level `getRuntimeEnvironment()`
// call) finds the mock in place before its own module is evaluated.
import './playground/mock-utils'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { setupI18n } from '@otto/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { ThemeProvider } from './context/theme-context'
import { Toaster } from './components/ui/sonner'
import { PlaygroundApp } from './playground/playground-app'
import { EscapeInterruptProvider } from './context/escape-interrupt-context'
import { PlaygroundAppShellProvider } from './playground/playground-app-shell-provider'
import './index.css'

// Initialize i18n before any React rendering. `useTranslation()` reads from
// the shared global instance, so we don't need an <I18nextProvider>.
setupI18n([initReactI18next])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider>
      <ThemeProvider>
        <EscapeInterruptProvider>
          <PlaygroundAppShellProvider>
            <PlaygroundApp />
            <Toaster />
          </PlaygroundAppShellProvider>
        </EscapeInterruptProvider>
      </ThemeProvider>
    </JotaiProvider>
  </React.StrictMode>
)
