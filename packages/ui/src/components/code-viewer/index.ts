/**
 * Code viewer components for syntax highlighting and diff display.
 */

export { ShikiCodeViewer, type ShikiCodeViewerProps } from './shiki-code-viewer'
export { ShikiDiffViewer, type ShikiDiffViewerProps, getDiffStats } from './shiki-diff-viewer'
export { UnifiedDiffViewer, type UnifiedDiffViewerProps, getUnifiedDiffStats } from './unified-diff-viewer'
export { DiffViewerControls, type DiffViewerControlsProps } from './diff-viewer-controls'
export { DiffSplitIcon, DiffUnifiedIcon, DiffBackgroundIcon } from './diff-icons'
export { LANGUAGE_MAP, getLanguageFromPath, formatFilePath, truncateFilePath } from './language-map'
