/**
 * SettingsSection
 *
 * A settings page's section: the design system's `PageSection` (small title, optional
 * description, an action at the end of the title row) above its `SettingsCard`.
 */

import * as React from 'react'
import { PageSection } from '@workspace/ui/components/page'

export interface SettingsSectionProps {
  /** Section title */
  title: string
  /** Optional description below title (supports ReactNode for inline links) */
  description?: React.ReactNode
  /** Content - usually SettingsCard or SettingsRadioGroup */
  children: React.ReactNode
  /** Additional className */
  className?: string
  /** `danger` titles the section in the destructive color */
  variant?: 'default' | 'danger'
  /** Optional action element (e.g., Edit button) shown at the right of the header */
  action?: React.ReactNode
}

export function SettingsSection({ variant = 'default', ...props }: SettingsSectionProps) {
  return <PageSection danger={variant === 'danger'} {...props} />
}
