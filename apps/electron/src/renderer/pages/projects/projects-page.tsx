/** Projects index: a placeholder (the section's empty state) until the page is built. */

import { useTranslation } from 'react-i18next'
import { Folder } from 'lucide-react'
import { SectionEmpty } from '@/components/app-shell/section-empty'

export function ProjectsPage() {
  const { t } = useTranslation()
  return (
    <SectionEmpty
      icon={Folder}
      title={t('sectionEmpty.projectsTitle')}
      description={t('sectionEmpty.projectsDescription')}
      cta={t('sectionEmpty.newProject')}
    />
  )
}
