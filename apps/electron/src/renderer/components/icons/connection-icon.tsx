/**
 * ConnectionIcon
 *
 * Displays the provider logo for an LLM connection.
 * Falls back to the first letter of the connection name if no icon is available.
 *
 * Used in:
 * - AI Settings (connections list)
 * - FreeFormInput (model display)
 * - Session List (connection badge)
 * - New Session (model selector group names)
 */

import { Brain } from 'lucide-react'
import { getProviderIcon } from '@/lib/provider-icons'
import { ProviderLogo } from './provider-logo'
import { getModelDisplayName } from '@config/models'
import { Tooltip, TooltipTrigger, TooltipContent } from '@otto/ui'
import type { LlmConnectionWithStatus } from '../../../shared/types'

interface ConnectionIconProps {
  /** The connection to display an icon for */
  connection: Pick<LlmConnectionWithStatus, 'name' | 'type' | 'baseUrl'> & { defaultModel?: string }
  /** Size in pixels (default: 16) */
  size?: number
  /** Additional CSS classes */
  className?: string
  /** Show tooltip with connection name + model on hover (default: false) */
  showTooltip?: boolean
}

export function ConnectionIcon({ connection, size = 16, className = '', showTooltip = false }: ConnectionIconProps) {
  const providerIcon = getProviderIcon(connection.type, connection.baseUrl)

  const iconElement = providerIcon ? (
    <ProviderLogo src={providerIcon} size={size} className={className} />
  ) : (
    <Brain className={`shrink-0 ${className}`} style={{ width: size, height: size }} />
  )

  if (!showTooltip) return iconElement

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {iconElement}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <div className="text-center">
          <div>{connection.name}</div>
          {connection.defaultModel && <div className="text-[10px] opacity-60">{getModelDisplayName(connection.defaultModel)}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
