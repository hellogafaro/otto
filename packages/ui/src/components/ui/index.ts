/**
 * UI primitives for @otto/ui
 */

export { Spinner, type SpinnerProps, LoadingIndicator, type LoadingIndicatorProps } from './loading-indicator'
export {
  SimpleDropdown,
  SimpleDropdownItem,
  type SimpleDropdownProps,
  type SimpleDropdownItemProps,
} from './simple-dropdown'
export {
  PreviewHeader,
  PreviewHeaderBadge,
  PREVIEW_BADGE_VARIANTS,
  type PreviewHeaderProps,
  type PreviewHeaderBadgeProps,
  type PreviewBadgeVariant,
} from './preview-header'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuShortcut,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from './styled-dropdown'
export { BrowserShader, type BrowserShaderProps } from './browser-shader'
export { BrowserControls, type BrowserControlsProps } from './browser-controls'
export {
  BrowserEmptyStateCard,
  type BrowserEmptyStateCardProps,
  type BrowserEmptyPromptSample,
} from './browser-empty-state-card'
export {
  FilterableSelectPopover,
  type FilterableSelectPopoverProps,
  type FilterableSelectRenderState,
} from './filterable-select-popover'
export {
  Island,
  IslandContentView,
  type IslandProps,
  type IslandContentViewProps,
  type IslandTransitionConfig,
  type IslandActiveViewSize,
  type IslandMorphTarget,
  type IslandDialogBehavior,
  type AnchorX,
  type AnchorY,
} from './island'
export {
  IslandFollowUpContentView,
  type IslandFollowUpContentViewProps,
  type IslandFollowUpMode,
} from './island-follow-up-content-view'
export {
  useIslandNavigation,
  type IslandNavigation,
} from './use-island-navigation'
