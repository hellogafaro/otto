/**
 * NotFoundPage - a URL with no view (an unknown path, workspace or record): ONLY the empty
 * state, centered both ways on the plain page, and one "Go home" button. No sidebar, header
 * or floating navigation, so it renders outside the app shell. Back is the browser's or
 * Electron's own.
 */

import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'

export function NotFoundPage() {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <div className="h-full bg-background text-foreground">
      {/* Keeps the window draggable (Electron) now that no header is drawn */}
      <div className="titlebar-drag-region fixed inset-x-0 top-0 h-10" />
      <EntityListEmptyScreen
        className="h-full"
        icon={<FileQuestion />}
        title={t('notFound.title')}
        description={t('notFound.description')}
      >
        {/* `/` redirects to the active workspace's Chats */}
        <Button onClick={() => void router.navigate({ to: '/', replace: true })}>{t('notFound.home')}</Button>
      </EntityListEmptyScreen>
    </div>
  )
}
