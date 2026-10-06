/** Task detail: a placeholder (the section's empty state) until the page is built. */

import { useTranslation } from 'react-i18next'
import { CircleCheck } from 'lucide-react'
import { SectionEmpty } from '@/components/app-shell/section-empty'

export function TaskPage(_props: { taskId: string }) {
  const { t } = useTranslation()
  return (
    <SectionEmpty
      icon={CircleCheck}
      title={t('sectionEmpty.tasksTitle')}
      description={t('sectionEmpty.tasksDescription')}
      cta={t('sectionEmpty.newTask')}
    />
  )
}
