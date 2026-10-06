/**
 * SourceAvatar - Thin wrapper around EntityIcon for sources.
 *
 * Sets fallbackIcon based on source type (McpIcon, Globe, HardDrive, etc.)
 * and adds source-specific extras:
 * - Favicon resolution as secondary fallback when no local icon found
 * - Connection status indicator dot (only when showStatus=true)
 */

import * as React from 'react'
import { DatabaseZap, Globe, HardDrive, Mail, Plug } from 'lucide-react'
import { EntityIcon, type IconComponent } from '@/components/ui/entity-icon'
import { useEntityIcon, logoUrlCache } from '@/lib/icon-cache'
import { McpIcon } from '@/components/icons/mcp-icon'
import type { LoadedSource } from '@otto/shared/sources/types'
import type { IconSize, ResolvedEntityIcon } from '@otto/shared/icons'
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
// Favicon Hook (source-specific secondary fallback)
// ============================================================================

/**
 * Resolve a favicon URL from the source's service URL.
 * Only attempts resolution when the primary icon (local file) is not found.
 */
function useFaviconFallback(
  source: LoadedSource,
  primaryIcon: ResolvedEntityIcon,
  bare?: boolean
): string | null {
  const [faviconUrl, setFaviconUrl] = React.useState<string | null>(null)

  // Only resolve favicon when primary icon resolved to fallback (no local file found)
  // Otto: bare (the palette's row) shows the source's own icon or the one glyph, never a fetched favicon.
  const needsFavicon = primaryIcon.kind === 'fallback' && !bare

  // Extract stable primitive deps from source.config to avoid re-renders on object ref changes
  const slug = source.config.slug
  const provider = source.config.provider
  const mcpUrl = source.config.mcp?.url
  const apiBaseUrl = source.config.api?.baseUrl
  const sourceType = source.config.type

  React.useEffect(() => {
    if (!needsFavicon) {
      setFaviconUrl(null)
      return
    }

    // Derive service URL from primitive fields
    let serviceUrl: string | null = null
    if (sourceType === 'mcp' && mcpUrl) serviceUrl = mcpUrl
    else if (sourceType === 'api' && apiBaseUrl) serviceUrl = apiBaseUrl

    if (!serviceUrl) {
      setFaviconUrl(null)
      return
    }

    const resolvedProvider = slug ?? provider
    const cacheKey = `${serviceUrl}:${resolvedProvider ?? ''}`

    // Check logo URL cache first
    const cached = logoUrlCache.get(cacheKey)
    if (cached !== undefined) {
      setFaviconUrl(cached)
      return
    }

    // Resolve via IPC
    let cancelled = false
    window.electronAPI.getLogoUrl(serviceUrl, resolvedProvider)
      .then((result) => {
        if (cancelled) return
        logoUrlCache.set(cacheKey, result)
        setFaviconUrl(result)
      })
      .catch(() => {
        if (cancelled) return
        logoUrlCache.set(cacheKey, null)
        setFaviconUrl(null)
      })

    return () => { cancelled = true }
  }, [needsFavicon, slug, provider, mcpUrl, apiBaseUrl, sourceType])

  return faviconUrl
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

  // Source-specific: favicon as secondary fallback when no local icon found
  const faviconUrl = useFaviconFallback(source, icon, bare)

  // If primary icon resolved to fallback but we have a favicon, use it as file icon
  const finalIcon: ResolvedEntityIcon = icon.kind === 'fallback' && faviconUrl
    ? { kind: 'file', value: faviconUrl, colorable: false }
    : icon

  // Otto: bare (the palette's row) is one glyph for every source, the Sources icon of the settings sidebar.
  const FallbackIcon = bare ? DatabaseZap : (SOURCE_FALLBACKS[source.config.type] ?? Plug)

  const entityIcon = (
    <EntityIcon
      icon={finalIcon}
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
