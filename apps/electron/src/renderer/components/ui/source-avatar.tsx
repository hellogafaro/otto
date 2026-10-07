/**
 * SourceAvatar - Thin wrapper around EntityIcon for sources.
 *
 * Sets fallbackIcon based on source type (McpIcon, Globe, HardDrive, etc.): a source shows its own icon file,
 * else the type icon, never a fetched favicon. Adds the connection status indicator dot (only when showStatus=true).
 */

import { DatabaseZap, Globe, HardDrive, Mail, Plug } from 'lucide-react'
import { EntityIcon, type IconComponent } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import { McpIcon } from '@/components/icons/mcp-icon'
import type { LoadedSource } from '@otto/shared/sources/types'
import type { IconSize } from '@otto/shared/icons'
import { SourceStatusIndicator, deriveConnectionStatus } from './source-status-indicator'

// ============================================================================
// Types
// ============================================================================

export type SourceType = 'mcp' | 'api' | 'gmail' | 'local'

interface SourceAvatarProps {
  /** LoadedSource object */
  source: LoadedSource
  /** Size variant (default: 'md') */
  size?: IconSize
  /** Show connection status indicator (auto-derived from source) */
  showStatus?: boolean
  /** Additional className overrides */
  className?: string
  /** No ring or fill of its own (in a tile that has them) */
  chromeless?: boolean
  /** Just the glyph (DatabaseZap when it has no icon), emoji or image: no tile (the command palette's rows) */
  bare?: boolean
}

// ============================================================================
// Fallback Icons per Source Type
// ============================================================================

/** Source-specific fallback icons based on source type */
const SOURCE_FALLBACKS: Record<string, IconComponent> = {
  mcp: McpIcon,
  api: Globe,
  gmail: Mail,
  local: HardDrive,
}

/**
 * Get the fallback icon for a source type
 */
export function getSourceFallbackIcon(type: SourceType): IconComponent {
  return SOURCE_FALLBACKS[type] ?? Plug
}

// ============================================================================
// Status Indicator Size Mapping
// ============================================================================

const STATUS_SIZE_CONFIG: Record<IconSize, 'xs' | 'sm' | 'md'> = {
  xs: 'xs',
  sm: 'xs',
  md: 'sm',
  lg: 'sm',
  xl: 'md',
}

// ============================================================================
// Component
// ============================================================================

export function SourceAvatar({ source, size = 'md', showStatus, className, chromeless, bare }: SourceAvatarProps) {
  const icon = useEntityIcon({
    workspaceId: source.workspaceId,
    entityType: 'source',
    identifier: source.config.slug,
    iconDir: `sources/${source.config.slug}`,
    iconValue: source.config.icon,
  })

  // Otto: bare (the palette's row) is one glyph for every source, the Sources icon of the settings sidebar.
  const FallbackIcon = bare ? DatabaseZap : (SOURCE_FALLBACKS[source.config.type] ?? Plug)

  const entityIcon = (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={FallbackIcon}
      alt={source.config.name}
      className={className}
      chromeless={chromeless}
      bare={bare}
    />
  )

  // Only wrap with relative container when status indicator is needed
  if (showStatus) {
    const connectionStatus = deriveConnectionStatus(source)
    const statusSize = STATUS_SIZE_CONFIG[size]
    return (
      <span className="relative inline-flex shrink-0">
        {entityIcon}
        {connectionStatus && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <SourceStatusIndicator
              status={connectionStatus}
              errorMessage={source.config.connectionError}
              size={statusSize}
            />
          </span>
        )}
      </span>
    )
  }

  return entityIcon
}
