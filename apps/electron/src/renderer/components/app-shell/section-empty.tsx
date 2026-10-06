/**
 * SectionEmpty - a section that is not built yet: ONLY the empty state, centered in
 * the main region, and its primary "New …" button, which does nothing yet. No title
 * row (`PageHeader` without a title draws only the sheet's menu button below 768px,
 * so the sidebar stays reachable), no list, no cards. Replaced by the real page
 * once it is designed.
 */

import type { LucideIcon } from 'lucide-react'
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
  return (
    <>
      <PageHeader />
      <EntityListEmptyScreen icon={<Icon />} title={title} description={description}>
        <Button>{cta}</Button>
      </EntityListEmptyScreen>
    </>
  )
}
