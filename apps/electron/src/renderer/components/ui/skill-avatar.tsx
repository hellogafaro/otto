/**
 * SkillAvatar - Thin wrapper around EntityIcon for skills.
 *
 * Sets fallbackIcon={Shapes} and delegates all rendering to EntityIcon.
 */

import { Shapes } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@otto/shared/icons'
import type { LoadedSkill } from '../../../shared/types'

interface SkillAvatarProps {
  /** LoadedSkill object */
  skill: LoadedSkill
  /** Size variant */
  size?: IconSize
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
  /** No ring or fill of its own (in a tile that has them) */
  chromeless?: boolean
  /** Just the glyph, emoji or image: no tile (the command palette's rows) */
  bare?: boolean
}

export function SkillAvatar({ skill, size = 'md', className, workspaceId, chromeless, bare }: SkillAvatarProps) {
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'skill',
    identifier: skill.slug,
    iconPath: skill.iconPath,
    iconValue: skill.metadata.icon,
  })

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={Shapes}
      alt={skill.metadata.name}
      className={className}
      chromeless={chromeless}
      bare={bare}
    />
  )
}
