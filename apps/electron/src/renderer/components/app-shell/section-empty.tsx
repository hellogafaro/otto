/**
 * SectionEmpty - a section that is not built yet: ONLY the empty state, centered in
 * the main region, and its primary "New …" button, which does nothing yet. No page
 * header row (below 768px the menu button alone, so the sidebar sheet stays
 * reachable), no list, no cards. Replaced by the real page once it is designed.
 */

import type { LucideIcon } from 'lucide-react'
import { useSidebar } from '@workspace/ui/components/sidebar'
import { Button } from '@/components/ui/button'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { PageHeader } from './page-header'

export function SectionEmpty({
  icon: Icon,
  title,
  description,
  cta,
}: {
  icon: LucideIcon
  title: string
  description: string
  /** The primary button's label ("New project"). It has no action yet. */
  cta: string
}) {
  const { isMobile } = useSidebar()
  return (
    <>
      {isMobile && <PageHeader />}
      <EntityListEmptyScreen icon={<Icon />} title={title} description={description}>
        <Button>{cta}</Button>
      </EntityListEmptyScreen>
    </>
  )
}
