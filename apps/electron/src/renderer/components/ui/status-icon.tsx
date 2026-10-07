/**
 * StatusIcon - Thin wrapper around EntityIcon for statuses.
 *
 * Sets fallbackIcon={Circle}. Color is NOT handled here — the parent applies
 * a Tailwind color class (e.g. 'text-success') which cascades into colorable
 * SVGs via CSS currentColor inheritance.
 *
 * A status icon is an emoji or an image data URL (SVG, resolved synchronously by useEntityIcon).
 */

import { Circle } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@otto/shared/icons'

interface StatusIconProps {
  /** Status identifier (cache key) */
  statusId: string
  /** Icon value from config (emoji or image data URL) */
  icon?: string
  /** Workspace ID for loading local icons */
  workspaceId: string
  /** Size variant (default: 'sm' - statuses are typically small) */
  size?: IconSize
  /** Additional className */
  className?: string
  /** When true, renders without any container (just the SVG/emoji) */
  bare?: boolean
}

export function StatusIcon({
  statusId,
  icon,
  workspaceId,
  size = 'sm',
  className,
  bare,
}: StatusIconProps) {
  const resolved = useEntityIcon({
    workspaceId,
    entityType: 'status',
    identifier: statusId,
    iconValue: icon?.trim(),
  })

  return (
    <EntityIcon
      icon={resolved}
      size={size}
      fallbackIcon={Circle}
      className={className}
      bare={bare}
    />
  )
}
