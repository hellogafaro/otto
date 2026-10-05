// Base overlay components
export { FullscreenOverlayBase, type FullscreenOverlayBaseProps } from './fullscreen-overlay-base'
export { FullscreenOverlayBaseHeader, type FullscreenOverlayBaseHeaderProps, type OverlayTypeBadge } from './fullscreen-overlay-base-header'
export { PreviewOverlay, type PreviewOverlayProps, type BadgeVariant } from './preview-overlay'
export { ContentFrame, type ContentFrameProps } from './content-frame'

// Helper components
export { CopyButton, type CopyButtonProps } from './copy-button'
export { ItemNavigator, type ItemNavigatorProps } from './item-navigator'
export { OverlayErrorBanner, type OverlayErrorBannerProps } from './overlay-error-banner'

// Specialized overlays
export { CodePreviewOverlay, type CodePreviewOverlayProps } from './code-preview-overlay'
export { MultiDiffPreviewOverlay, type MultiDiffPreviewOverlayProps, type FileChange, type DiffViewerSettings } from './multi-diff-preview-overlay'
export { TerminalPreviewOverlay, type TerminalPreviewOverlayProps } from './terminal-preview-overlay'
export { GenericOverlay, detectLanguage, detectLanguageFromPath, type GenericOverlayProps } from './generic-overlay'
export { JSONPreviewOverlay, type JSONPreviewOverlayProps } from './json-preview-overlay'
export { DataTableOverlay, type DataTableOverlayProps } from './data-table-overlay'
export { DocumentFormattedMarkdownOverlay, type DocumentFormattedMarkdownOverlayProps } from './document-formatted-markdown-overlay'
export { ImagePreviewOverlay, type ImagePreviewOverlayProps } from './image-preview-overlay'
export { PDFPreviewOverlay, type PDFPreviewOverlayProps } from './pdf-preview-overlay'
export { MermaidPreviewOverlay, type MermaidPreviewOverlayProps } from './mermaid-preview-overlay'
export { HTMLPreviewOverlay, type HTMLPreviewOverlayProps } from './html-preview-overlay'
export { ActivityCardsOverlay, type ActivityCardsOverlayProps } from './activity-cards-overlay'
