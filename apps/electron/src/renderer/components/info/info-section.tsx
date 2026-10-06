/**
 * Info_Section
 *
 * A section of an info page (a skill, a source, an automation): the settings pages'
 * `PageSection` (title, optional description, actions at the end of its row) over one
 * `PageCard`, so the spacing is the settings pages' own.
 */

import * as React from 'react'
import { PageCard, PageSection } from '@workspace/ui/components/page'

export interface Info_SectionProps {
  /** Section title */
  title: string
  /** Optional description below title */
  description?: string
  /** Optional right-aligned header actions */
  actions?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  className?: string
}

export function Info_Section({ title, description, actions, children, className }: Info_SectionProps) {
  return (
    <PageSection title={title} description={description} action={actions} className={className}>
      <PageCard>{children}</PageCard>
    </PageSection>
  )
}
