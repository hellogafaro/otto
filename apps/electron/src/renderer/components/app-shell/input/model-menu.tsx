/**
 * The chat's model picker (the full composer's `tools`, DESIGN.md, Composer): a 28px chip with the model's name,
 * opening the connection and model list, Thinking, and the context window's use. Moved out of the old chat input
 * unchanged.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, AlertCircle, Image as ImageIcon } from 'lucide-react'
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import * as storage from '@/lib/local-storage'
import { ToolbarChip } from '@/components/ui/toolbar-chip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuSub } from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { ANTHROPIC_MODELS, getModelShortName, getModelDisplayName, getModelContextWindow } from '@config/models'
import { resolveEffectiveConnectionSlug, isCompatProvider, modelSupportsImages } from '@config/llm-connections'
import { useOptionalAppShellContext } from '@/context/app-shell-context'
import { ConnectionIcon } from '@/components/icons/connection-icon'
import { type ThinkingLevel, THINKING_LEVELS, getThinkingLevelNameKey } from '@otto/shared/agent/thinking-levels'
import { getContextDisplay, getContextDisplayLabels, type ContextStatus } from './context-display'
import { derivePickerMode } from './picker-mode'
import { groupConnectionsByProvider, stripPiPrefixForDisplay } from './model-picker-helpers'
import { useModelVisionToggle } from './use-model-vision-toggle'

export interface ModelMenuProps {
  currentModel: string
  /** Includes the connection slug for proper persistence. */
  onModelChange: (model: string, connection?: string) => void
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  /** The session's LLM connection (locked after its first message). */
  currentConnection?: string
  onConnectionChange?: (connectionSlug: string) => void
  /** The session's locked connection has been removed. */
  connectionUnavailable?: boolean
  /** No message yet: the connection can still change. */
  isEmptySession?: boolean
  contextStatus?: ContextStatus
}

export function ModelMenu({
  currentModel,
  onModelChange,
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  currentConnection,
  onConnectionChange,
  connectionUnavailable = false,
  isEmptySession = false,
  contextStatus,
}: ModelMenuProps) {
  const { t } = useTranslation()
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false)
  const handleToggleModelVision = useModelVisionToggle()
  // Read connection default model, connections, and workspace info from context.
  // Uses optional variant so playground (no provider) doesn't crash.
  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const workspaceDefaultConnection = appShellCtx?.workspaceDefaultLlmConnection

  // Derive connectionDefaultModel per-session from the effective connection.
  // Only non-null for compat providers (custom endpoints with fixed models).
  // Standard providers (anthropic, pi) → null → normal model picker.
  const connectionDefaultModel = React.useMemo(() => {
    const effectiveSlug = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)
    const conn = llmConnections.find(c => c.slug === effectiveSlug)
    if (!conn) return null
    if (!isCompatProvider(conn.providerType)) return null
    // Allow model switching when connection has multiple models
    if (conn.models && conn.models.length > 1) return null
    return conn.defaultModel ?? null
  }, [currentConnection, workspaceDefaultConnection, llmConnections])

  // Decide which of the four picker UIs to render. The `switcher` branch
  // wins over `locked-single` so users with a single-model pi_compat default
  // can still reach the connection list on a fresh session (#727).
  const pickerMode = derivePickerMode({
    connectionUnavailable,
    connectionDefaultModel,
    isEmptySession,
    connectionCount: llmConnections.length,
  })

  // Compute available models from the effective connection.
  // All connections have models populated by backfillAllConnectionModels().
  const availableModels = React.useMemo(() => {
    // Connection removed — don't fall through to another connection's models
    if (connectionUnavailable) return []

    // Determine effective connection using the canonical fallback chain
    const effectiveSlug = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)
    const connection = llmConnections.find(c => c.slug === effectiveSlug)

    if (!connection) {
      return ANTHROPIC_MODELS // Safety net — shouldn't happen
    }

    return connection.models || ANTHROPIC_MODELS
  }, [llmConnections, currentConnection, workspaceDefaultConnection, connectionUnavailable])

  const availableThinkingLevels = THINKING_LEVELS

  // Disable thinking selector when the current model explicitly doesn't support it
  const thinkingDisabled = React.useMemo(() => {
    const model = availableModels.find(m => typeof m !== 'string' && m.id === currentModel)
    return typeof model !== 'string' && model?.supportsThinking === false
  }, [availableModels, currentModel])

  // Get display name for current model (full name, not short name)
  const currentModelDisplayName = React.useMemo(() => {
    const modelToDisplay = connectionDefaultModel ?? currentModel
    const model = availableModels.find(m =>
      typeof m === 'string' ? m === modelToDisplay : m.id === modelToDisplay
    )
    if (!model) {
      // Fallback: use helper function to format unknown model IDs nicely
      return stripPiPrefixForDisplay(getModelDisplayName(modelToDisplay))
    }
    if (typeof model === 'string') return stripPiPrefixForDisplay(model)
    // Defensive: partial entries (custom-endpoint user-config or vision-toggle
    // promotions) may lack `name`. Fall back to the id so the trigger button
    // never goes blank.
    return model.name ?? stripPiPrefixForDisplay(model.id)
  }, [availableModels, currentModel, connectionDefaultModel])

  // Group connections by provider type for hierarchical dropdown.
  // Each provider (Anthropic, Pi) can have multiple connections (API Key, OAuth, etc.)
  const connectionsByProvider = React.useMemo(
    () => groupConnectionsByProvider(llmConnections),
    [llmConnections],
  )

  // Find current connection details for display
  const currentConnectionDetails = React.useMemo(() => {
    if (!currentConnection) return null
    return llmConnections.find(c => c.slug === currentConnection) ?? null
  }, [llmConnections, currentConnection])

  // Effective connection: canonical fallback chain (session → workspace default → global default → first)
  const effectiveConnection = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)

  // Effective connection details (with fallbacks) for model list
  // Unlike currentConnectionDetails which is null when no explicit connection is set,
  // this resolves to the actual connection being used (including workspace default)
  const effectiveConnectionDetails = React.useMemo(() => {
    if (!effectiveConnection) return null
    return llmConnections.find(c => c.slug === effectiveConnection) ?? null
  }, [llmConnections, effectiveConnection])

  const contextDisplay = getContextDisplay(contextStatus, getModelContextWindow(currentModel))
  const contextLabels = getContextDisplayLabels(contextDisplay, t)

  return (
    <DropdownMenu open={modelDropdownOpen} onOpenChange={setModelDropdownOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarChip
              type="button"
              open={modelDropdownOpen}
              className={cn("input-toolbar-btn", connectionUnavailable ? "text-destructive hover:text-destructive" : "text-foreground")}
            >
              {connectionUnavailable ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {t('common.unavailable')}
                </>
              ) : (
                <>
                  {effectiveConnectionDetails && llmConnections.length > 1 && storage.get(storage.KEYS.showConnectionIcons, true) && <ConnectionIcon connection={effectiveConnectionDetails} size={14} showTooltip />}
                  {currentModelDisplayName}
                  {pickerMode !== 'locked-single' && <ChevronDown className="size-3 opacity-50 shrink-0" />}
                </>
              )}
            </ToolbarChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t('common.model')}
        </TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-[260px] max-w-sm">
        {/* Connection unavailable message */}
        {pickerMode === 'unavailable' ? (
          <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <div className="font-medium text-sm mb-1">{t('chat.connectionUnavailable')}</div>
            <div className="text-xs text-muted-foreground">
              {t('chat.connectionUnavailableDescription')}
            </div>
          </div>
        ) : pickerMode === 'locked-single' && connectionDefaultModel ? (
          (() => {
            // Single-model pi_compat connection on a non-empty session (or
            // when there's only one connection, so no switcher to show).
            // Model row is disabled (locked to this session); vision toggle
            // remains interactive.
            const showVisionToggle =
              !!effectiveConnectionDetails && isCompatProvider(effectiveConnectionDetails.providerType)
            const visionOn = showVisionToggle && modelSupportsImages(effectiveConnectionDetails!, connectionDefaultModel)
            return (
              <StyledDropdownMenuItem disabled className="justify-between">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{stripPiPrefixForDisplay(connectionDefaultModel)}</span>
                  <span className="truncate text-muted-foreground">{t('chat.connectionDefault')}</span>
                </span>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  {showVisionToggle && effectiveConnectionDetails && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={visionOn
                            ? t('chat.modelPicker.supportsImagesOn')
                            : t('chat.modelPicker.supportsImagesOff')}
                          className="inline-flex items-center justify-center p-1 rounded-sm pointer-events-auto opacity-100 hover:bg-foreground/10 cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleToggleModelVision(effectiveConnectionDetails.slug, connectionDefaultModel, !visionOn)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              handleToggleModelVision(effectiveConnectionDetails.slug, connectionDefaultModel, !visionOn)
                            }
                          }}
                        >
                          <ImageIcon className={cn(
                            "h-3.5 w-3.5",
                            visionOn ? "text-foreground/70" : "text-foreground/30"
                          )} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {visionOn
                          ? t('chat.modelPicker.supportsImagesOn')
                          : t('chat.modelPicker.supportsImagesOff')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Check />
                </div>
              </StyledDropdownMenuItem>
            )
          })()
        ) : pickerMode === 'switcher' ? (
          /* Hierarchical view: Provider → Connection → Models (empty session with multiple connections — lets the user switch BEFORE the first message locks the connection) */
          connectionsByProvider.map(([providerName, connections], index) => (
            <React.Fragment key={providerName}>
              {/* Provider group label */}
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide select-none">
                {providerName}
              </div>
              {connections.map((conn) => {
                const isCurrentConnection = effectiveConnection === conn.slug
                const isAuthenticated = conn.isAuthenticated
                return (
                  <DropdownMenuSub key={conn.slug}>
                    <StyledDropdownMenuSubTrigger disabled={!isAuthenticated}>
                      <ConnectionIcon connection={conn} size={14} />
                      <span className="truncate">{conn.name}</span>
                      {!isAuthenticated && (
                        <span className="truncate text-muted-foreground">{t('settings.ai.notAuthenticated')}</span>
                      )}
                      {isCurrentConnection && <Check className="size-3.5 shrink-0" />}
                    </StyledDropdownMenuSubTrigger>
                    {isAuthenticated && (
                      <StyledDropdownMenuSubContent className="min-w-[220px] max-w-sm">
                        {/* Show models for this connection - use provider-specific models as fallback */}
                        {(conn.models || ANTHROPIC_MODELS).map((model) => {
                          const modelId = typeof model === 'string' ? model : model.id
                          const modelName = typeof model === 'string'
                            ? stripPiPrefixForDisplay(getModelShortName(model))
                            : (model.name ?? stripPiPrefixForDisplay(model.id))
                          const isSelectedModel = isCurrentConnection && currentModel === modelId
                          const showVisionToggle = isCompatProvider(conn.providerType)
                          const visionOn = showVisionToggle && modelSupportsImages(conn, modelId)
                          return (
                            <StyledDropdownMenuItem
                              key={modelId}
                              onSelect={() => {
                                // If selecting a different connection, update both connection and model
                                if (!isCurrentConnection && onConnectionChange) {
                                  onConnectionChange(conn.slug)
                                }
                                // Always pass connection with model for proper persistence
                                onModelChange(modelId, conn.slug)
                              }}
                              className="justify-between"
                            >
                              <span className="truncate">{modelName}</span>
                              <div className="flex items-center gap-1 ml-3 shrink-0">
                                {showVisionToggle && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label={visionOn
                                          ? t('chat.modelPicker.supportsImagesOn')
                                          : t('chat.modelPicker.supportsImagesOff')}
                                        className="inline-flex items-center justify-center p-1 rounded-sm hover:bg-foreground/10 cursor-pointer"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          handleToggleModelVision(conn.slug, modelId, !visionOn)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleToggleModelVision(conn.slug, modelId, !visionOn)
                                          }
                                        }}
                                      >
                                        <ImageIcon className={cn(
                                          "h-3.5 w-3.5",
                                          visionOn ? "text-foreground/70" : "text-foreground/30"
                                        )} />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {visionOn
                                        ? t('chat.modelPicker.supportsImagesOn')
                                        : t('chat.modelPicker.supportsImagesOff')}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {isSelectedModel && (
                                  <Check />
                                )}
                              </div>
                            </StyledDropdownMenuItem>
                          )
                        })}
                      </StyledDropdownMenuSubContent>
                    )}
                  </DropdownMenuSub>
                )
              })}
              {index < connectionsByProvider.length - 1 && (
                <StyledDropdownMenuSeparator className="my-1" />
              )}
            </React.Fragment>
          ))
        ) : (
          /* Flat model list (single connection or session started) */
          <>
            {/* Indicator showing which connection is being used */}
            {!isEmptySession && currentConnectionDetails && llmConnections.length > 1 && (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs select-none text-muted-foreground">
                  <span>{t('chat.usingConnection', { name: currentConnectionDetails.name })}</span>
                </div>
                <StyledDropdownMenuSeparator className="my-1" />
              </>
            )}
            {/* Model options based on effective connection's provider type */}
            {availableModels.map((model) => {
              const modelId = typeof model === 'string' ? model : model.id
              const modelName = typeof model === 'string'
                ? stripPiPrefixForDisplay(getModelShortName(model))
                : (model.name ?? stripPiPrefixForDisplay(model.id))
              const isSelected = currentModel === modelId
              const descriptionKey = typeof model !== 'string' && 'descriptionKey' in model ? (model.descriptionKey as string) : undefined
              const description = descriptionKey ? t(descriptionKey) : (typeof model !== 'string' && 'description' in model ? (model.description as string) : '')
              const showVisionToggle =
                !!effectiveConnectionDetails && isCompatProvider(effectiveConnectionDetails.providerType)
              const visionOn = showVisionToggle && modelSupportsImages(effectiveConnectionDetails!, modelId)
              return (
                <StyledDropdownMenuItem
                  key={modelId}
                  onSelect={() => onModelChange(modelId, effectiveConnection)}
                  className="justify-between"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0">{modelName}</span>
                    {description && (
                      <span className="truncate text-muted-foreground">{description}</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    {showVisionToggle && effectiveConnectionDetails && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={visionOn
                              ? t('chat.modelPicker.supportsImagesOn')
                              : t('chat.modelPicker.supportsImagesOff')}
                            className="inline-flex items-center justify-center p-1 rounded-sm hover:bg-foreground/10 cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleToggleModelVision(effectiveConnectionDetails.slug, modelId, !visionOn)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                e.stopPropagation()
                                handleToggleModelVision(effectiveConnectionDetails.slug, modelId, !visionOn)
                              }
                            }}
                          >
                            <ImageIcon className={cn(
                              "h-3.5 w-3.5",
                              visionOn ? "text-foreground/70" : "text-foreground/30"
                            )} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {visionOn
                            ? t('chat.modelPicker.supportsImagesOn')
                            : t('chat.modelPicker.supportsImagesOff')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {isSelected && (
                      <Check />
                    )}
                  </div>
                </StyledDropdownMenuItem>
              )
            })}
          </>
        )}

        {/* Thinking level selector — only shown when thinking levels are available
            (Claude supports extended thinking, OpenAI backends may not) */}
        {availableThinkingLevels.length > 0 && (
          <>
            <StyledDropdownMenuSeparator className="my-1" />

            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger disabled={thinkingDisabled}>
                <span className="shrink-0">{t(getThinkingLevelNameKey(thinkingLevel))}</span>
                <span className="truncate text-muted-foreground">{thinkingDisabled ? t('thinking.notSupported') : t('thinking.extendedDesc')}</span>
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent className="min-w-[220px] max-w-sm">
                {availableThinkingLevels.map(({ id, nameKey, descriptionKey }) => {
                  const isSelected = thinkingLevel === id
                  return (
                    <StyledDropdownMenuItem
                      key={id}
                      onSelect={() => onThinkingLevelChange?.(id)}
                      className="justify-between"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0">{t(nameKey)}</span>
                        <span className="truncate text-muted-foreground">{t(descriptionKey)}</span>
                      </span>
                      {isSelected && <Check className="size-3.5 shrink-0" />}
                    </StyledDropdownMenuItem>
                  )
                })}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {/* Context usage footer - snapshot-aware occupancy, not cumulative billing. */}
        {contextDisplay.visible && (
          <>
            <StyledDropdownMenuSeparator className="my-1" />
            <div className="px-2 py-1.5 select-none">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{contextLabels.window}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-right">
                  {contextStatus?.isCompacting && (
                    <Spinner className="h-3 w-3 shrink-0" />
                  )}
                  <span>{contextLabels.usage}</span>
                </span>
              </div>
              {(contextLabels.percent || contextLabels.qualifier) && (
                <div className="mt-0.5 text-[10px] text-foreground/40">
                  {[contextLabels.percent, contextLabels.qualifier].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
