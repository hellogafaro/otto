import * as React from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { cn } from '../../lib/utils'
import { CodeBlock, InlineCode } from './code-block'
import { MarkdownDiffBlock } from './markdown-diff-block'
import { MarkdownJsonBlock } from './markdown-json-block'
import { MarkdownMermaidBlock } from './markdown-mermaid-block'
import { MarkdownDatatableBlock } from './markdown-datatable-block'
import { MarkdownSpreadsheetBlock } from './markdown-spreadsheet-block'
import { MarkdownHtmlBlock } from './markdown-html-block'
import { MarkdownImageBlock } from './markdown-image-block'
import { MarkdownLatexBlock } from './markdown-latex-block'
import { MarkdownPdfBlock } from './markdown-pdf-block'
import { MarkdownDocBlock } from './markdown-doc-block'
import { preprocessLinks } from './linkify'
import { resolveMarkdownLinkTarget } from './link-target'
import remarkCollapsibleSections from './remark-collapsible-sections'
import { CollapsibleSection } from './collapsible-section'
import { useCollapsibleMarkdown } from './collapsible-markdown-context'
import { wrapWithSafeProxy } from './safe-components'
import { MARKDOWN_MATH_OPTIONS } from './math-options'
import { markdownUrlTransform } from './url-transform'

/**
 * Names of preview-block code-fence types that recursive `Markdown` callers
 * may want to suppress. Used by `MarkdownDocBlock` to prevent
 * `markdown-preview` self-recursion while leaving other preview blocks
 * (mermaid, datatable, …) intact.
 */
export type DisablablePreviewBlock =
  | 'markdown-preview'
  | 'html-preview'
  | 'pdf-preview'
  | 'image-preview'

/**
 * Render modes for markdown content:
 *
 * - 'terminal': Raw output with minimal formatting, control chars visible
 *   Best for: Debug output, raw logs, when you want to see exactly what's there
 *
 * - 'minimal': Clean rendering with syntax highlighting but no extra chrome
 *   Best for: Chat messages, inline content, when you want readability without clutter
 *
 * - 'full': Rich rendering with beautiful tables, styled code blocks, proper typography
 *   Best for: Documentation, long-form content, when presentation matters
 */
export type RenderMode = 'terminal' | 'minimal' | 'full'

export interface MarkdownProps {
  children: string
  /**
   * Render mode controlling formatting level
   * @default 'minimal'
   */
  mode?: RenderMode
  className?: string
  /**
   * Message ID for memoization (optional)
   * When provided, memoizes parsed blocks to avoid re-parsing during streaming
   */
  id?: string
  /**
   * Callback when a URL is clicked
   */
  onUrlClick?: (url: string) => void
  /**
   * Callback when a file path is clicked
   */
  onFileClick?: (path: string) => void
  /**
   * Enable collapsible headings
   * Requires wrapping in CollapsibleMarkdownProvider
   * @default false
   */
  collapsible?: boolean
  /**
   * Hide expand button on first mermaid block (when message starts with mermaid)
   * Used in chat to avoid overlap with TurnCard's fullscreen button
   * @default true
   */
  hideFirstMermaidExpand?: boolean
  /**
   * Disable specific preview-block handlers for nested rendering.
   *
   * When a preview-block component renders user-supplied markdown through
   * `Markdown` again (e.g. `MarkdownDocBlock`), it can pass the names of the
   * preview-block types it wants to suppress to prevent infinite recursion.
   * Suppressed blocks fall through to the default `CodeBlock` renderer.
   *
   * Default behavior (prop omitted): all preview blocks are registered.
   */
  disablePreviewBlocks?: ReadonlySet<DisablablePreviewBlock>
  /**
   * Otto: elements drawn by the caller, over the built-in ones (a comment's `span[data-entity]` chips). Pass a
   * stable object (module level or memoized), or every render rebuilds the tree.
   */
  components?: Partial<Components>
}

/** Context for collapsible sections */
interface CollapsibleContext {
  collapsedSections: Set<string>
  toggleSection: (id: string) => void
}

/**
 * Create custom components based on render mode.
 *
 * @param firstMermaidCodeRef - Ref holding the code of the first mermaid block
 *   when the markdown message starts with a mermaid fence. Used to hide the
 *   inline expand button on that block (TurnCard's own fullscreen button
 *   occupies the same top-right position). A ref is used so the closure can
 *   read the latest value without adding content to the memo deps — that would
 *   cause component re-mounting on every streaming update.
 * @param hideFirstMermaidExpand - Whether to hide the expand button on the first
 *   mermaid block when the message starts with a mermaid fence. Defaults to true.
 */
function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function createComponents(
  mode: RenderMode,
  onUrlClick?: (url: string) => void,
  onFileClick?: (path: string) => void,
  collapsibleContext?: CollapsibleContext | null,
  firstMermaidCodeRef?: React.RefObject<string | null>,
  hideFirstMermaidExpand: boolean = true,
  disablePreviewBlocks?: ReadonlySet<DisablablePreviewBlock>,
): Partial<Components> {
  const isPreviewEnabled = (name: DisablablePreviewBlock) => !disablePreviewBlocks?.has(name)
  let blockIndex = 0
  const wrapBlock = (
    blockType: string,
    content: string,
    child: React.ReactNode,
    nodePosition?: { start?: { line?: number }; end?: { line?: number } },
  ) => {
    blockIndex += 1
    const startLine = nodePosition?.start?.line
    const endLine = nodePosition?.end?.line
    const path = startLine && endLine
      ? `line:${startLine}-${endLine}`
      : `idx:${blockIndex}`
    const blockId = `blk-${stableHash(`${blockType}|${path}|${content.slice(0, 240)}`)}`

    return (
      <figure
        data-ca-block-type={blockType}
        data-ca-block-path={path}
        data-ca-block-id={blockId}
      >
        <div
          className={cn(blockType !== 'markdown-preview' && 'not-typeset', blockType !== 'latex' && 'font-sans text-sm')}
          data-not-typeset={blockType !== 'markdown-preview' || undefined}
        >{child}</div>
      </figure>
    )
  }

  const baseComponents: Partial<Components> = {
    // Section wrapper for collapsible headings
    div: ({ node, children, ...props }) => {
      const sectionId = (props as Record<string, unknown>)['data-section-id'] as string | undefined
      const headingLevel = (props as Record<string, unknown>)['data-heading-level'] as number | undefined

      // If this is a collapsible section div and we have context
      if (sectionId && headingLevel && collapsibleContext) {
        return (
          <CollapsibleSection
            sectionId={sectionId}
            headingLevel={headingLevel}
            isCollapsed={collapsibleContext.collapsedSections.has(sectionId)}
            onToggle={collapsibleContext.toggleSection}
          >
            {children}
          </CollapsibleSection>
        )
      }

      // Regular div
      return <div {...props}>{children}</div>
    },
    // Links: Make clickable with callbacks.
    //
    // We sanitize the DOM `href` separately from the click-dispatch target:
    // - `safeHref` is what React puts on the `<a>` element. We pass `href`
    //   through `defaultUrlTransform`; any dangerous scheme
    //   (javascript:/data:/vbscript:/file:) is stripped to empty, in which case
    //   we omit the attribute entirely. That blocks middle-click and
    //   cmd-click escape routes (Electron's `setWindowOpenHandler` /
    //   `will-navigate` would otherwise bypass our React `onClick` and call
    //   `shell.openExternal` directly).
    // - The click handler still receives the ORIGINAL `href` and routes it
    //   through `resolveMarkdownLinkTarget` so file URLs land in `onFileClick`
    //   and blocked URLs surface a meaningful error via `onUrlClick` →
    //   `classifyExternalUrl`.
    a: ({ href, children }) => {
      const trimmedHref = href?.trim() ?? ''
      const sanitized = trimmedHref ? defaultUrlTransform(trimmedHref) : ''
      const safeHref = sanitized ? sanitized : undefined

      const handleClick = (e: React.MouseEvent) => {
        e.preventDefault()

        // Some AI outputs include raw HTML anchors with empty href but path text content.
        // Fallback to the anchor text when href is missing/empty.
        const fallbackText = React.Children.toArray(children)
          .map((child) => (typeof child === 'string' ? child : ''))
          .join('')
          .trim()

        const target = trimmedHref || fallbackText
        if (!target) return

        const resolvedTarget = resolveMarkdownLinkTarget(target)
        if (resolvedTarget.kind === 'file' && onFileClick) {
          onFileClick(resolvedTarget.path)
        } else if (resolvedTarget.kind === 'url' && onUrlClick) {
          onUrlClick(resolvedTarget.url)
        }
      }

      return (
        <a
          href={safeHref}
          onClick={handleClick}
          className={mode === 'terminal' ? 'text-primary hover:underline cursor-pointer' : undefined}
        >
          {children}
        </a>
      )
    },
  }

  // Terminal mode: minimal formatting
  if (mode === 'terminal') {
    return {
      ...baseComponents,
      // No special code handling - just monospace
      code: ({ children }) => (
        <code className="font-mono">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="font-mono whitespace-pre-wrap my-2">{children}</pre>
      ),
      // Minimal paragraph spacing
      p: ({ children }) => <p className="my-1">{children}</p>,
      // Simple lists
      ul: ({ children }) => <ul className="list-disc list-inside my-1">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal list-inside my-1">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      // Plain tables
      table: ({ children }) => (
        <table className="my-2 font-mono text-sm">{children}</table>
      ),
      th: ({ children }) => <th className="text-left pr-4">{children}</th>,
      td: ({ children }) => <td className="pr-4">{children}</td>,
    }
  }

  return {
    ...baseComponents,
    // Inline code
    code: ({ className, children, ...props }) => {
      const match = /language-([\w-]+)/.exec(className || '')
      const isBlock = 'node' in props && props.node?.position?.start.line !== props.node?.position?.end.line

      // Block code
      if (match || isBlock) {
        const code = String(children).replace(/\n$/, '')
        // Diff code blocks → pierre/diffs for a proper diff viewer
        if (match?.[1] === 'diff') {
          return wrapBlock('code', code, <MarkdownDiffBlock code={code} />, props.node?.position)
        }
        // JSON code blocks → interactive tree viewer
        if (match?.[1] === 'json') {
          return wrapBlock('code', code, <MarkdownJsonBlock code={code} />, props.node?.position)
        }
        // Datatable code blocks → sortable/filterable data table
        if (match?.[1] === 'datatable') {
          return wrapBlock('datatable', code, <MarkdownDatatableBlock code={code} />, props.node?.position)
        }
        // Spreadsheet code blocks → Excel-style grid
        if (match?.[1] === 'spreadsheet') {
          return wrapBlock('spreadsheet', code, <MarkdownSpreadsheetBlock code={code} />, props.node?.position)
        }
        // HTML preview blocks → sandboxed iframe
        if (match?.[1] === 'html-preview' && isPreviewEnabled('html-preview')) {
          return wrapBlock('html-preview', code, <MarkdownHtmlBlock code={code} />, props.node?.position)
        }
        // PDF preview blocks → inline first page with expand to full viewer
        if (match?.[1] === 'pdf-preview' && isPreviewEnabled('pdf-preview')) {
          return wrapBlock('pdf-preview', code, <MarkdownPdfBlock code={code} />, props.node?.position)
        }
        // Image preview blocks → inline image with expand to full viewer
        if (match?.[1] === 'image-preview' && isPreviewEnabled('image-preview')) {
          return wrapBlock('image-preview', code, <MarkdownImageBlock code={code} />, props.node?.position)
        }
        // Markdown preview blocks → inline rendered .md file
        if (match?.[1] === 'markdown-preview' && isPreviewEnabled('markdown-preview')) {
          return wrapBlock(
            'markdown-preview',
            code,
            <MarkdownDocBlock code={code} onUrlClick={onUrlClick} onFileClick={onFileClick} />,
            props.node?.position,
          )
        }
        // LaTeX/math code blocks → KaTeX rendered display math
        if (match?.[1] === 'latex' || match?.[1] === 'math') {
          return wrapBlock('latex', code, <MarkdownLatexBlock code={code} />, props.node?.position)
        }
        // Mermaid code blocks → zinc-styled SVG diagram.
        // Hide the inline expand button when the mermaid block is the first
        // content in the message — TurnCard's own fullscreen button occupies
        // the same top-right spot. Detection uses firstMermaidCodeRef (content
        // match) rather than AST line positions which are unreliable after
        // preprocessLinks transforms the markdown.
        if (match?.[1] === 'mermaid') {
          const isFirstBlock = hideFirstMermaidExpand &&
                              firstMermaidCodeRef?.current != null &&
                              code === firstMermaidCodeRef.current
          return wrapBlock(
            'mermaid',
            code,
            <MarkdownMermaidBlock code={code} showExpandButton={!isFirstBlock} />,
            props.node?.position,
          )
        }
        return wrapBlock('code', code, <CodeBlock code={code} language={match?.[1]} mode="full" />, props.node?.position)
      }

      // Inline code
      return <code>{children}</code>
    },
    pre: ({ children }) => <>{children}</>,
    input: ({ type, checked, disabled }) => type === 'checkbox'
      ? <input type="checkbox" checked={checked} disabled={disabled} readOnly />
      : <input type={type} />,
    table: ({ node: _node, children, ...props }) => (
      <div className="typeset-scroll"><table {...props}>{children}</table></div>
    ),
    markdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  } as Partial<Components>
}

/**
 * Markdown - Customizable markdown renderer with multiple render modes
 *
 * Features:
 * - Three render modes: terminal, minimal, full
 * - Syntax highlighting via Shiki
 * - GFM support (tables, task lists, strikethrough)
 * - Clickable links and file paths
 * - Memoization for streaming performance
 */
export function Markdown({
  children,
  mode = 'minimal',
  className,
  id,
  onUrlClick,
  onFileClick,
  collapsible = false,
  hideFirstMermaidExpand = true,
  disablePreviewBlocks,
  components: overrides,
}: MarkdownProps) {
  // Get collapsible context if enabled
  const collapsibleContext = useCollapsibleMarkdown()

  // Extract the first mermaid code block's content when the message starts
  // with a mermaid fence. Stored in a ref so createComponents can read it
  // without adding `children` to the memo deps (which would remount all
  // components on every streaming update, breaking internal state).
  const firstMermaidCodeRef = React.useRef<string | null>(null)
  const trimmed = children.trimStart()
  if (trimmed.startsWith('```mermaid')) {
    const m = trimmed.match(/^```mermaid\n([\s\S]*?)```/)
    firstMermaidCodeRef.current = m?.[1] ? m[1].replace(/\n$/, '') : null
  } else {
    firstMermaidCodeRef.current = null
  }

  const components = React.useMemo(
    () => wrapWithSafeProxy({ ...createComponents(mode, onUrlClick, onFileClick, collapsible ? collapsibleContext : null, firstMermaidCodeRef, hideFirstMermaidExpand, disablePreviewBlocks), ...overrides }),
    [mode, onUrlClick, onFileClick, collapsible, collapsibleContext, hideFirstMermaidExpand, disablePreviewBlocks, overrides]
  )

  // Preprocess to convert raw URLs and file paths to markdown links
  const processedContent = React.useMemo(
    () => preprocessLinks(children),
    [children]
  )

  // Conditionally include the collapsible sections plugin.
  // IMPORTANT: Disable single-dollar inline math so currency like $2M–$4M
  // stays plain text. Math should use $$...$$ delimiters.
  const remarkPlugins = React.useMemo(
    () => {
      const mathPlugin: [typeof remarkMath, typeof MARKDOWN_MATH_OPTIONS] = [
        remarkMath,
        MARKDOWN_MATH_OPTIONS
      ]
      return collapsible
        ? [remarkGfm, mathPlugin, remarkCollapsibleSections]
        : [remarkGfm, mathPlugin]
    },
    [collapsible]
  )

  return (
    <div className={cn('markdown-content', mode !== 'terminal' && 'typeset typeset-docs', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}

/**
 * MemoizedMarkdown - Optimized for streaming scenarios
 *
 * Splits content into blocks and memoizes each block separately,
 * so only new/changed blocks re-render during streaming.
 */
export const MemoizedMarkdown = React.memo(
  Markdown,
  (prevProps, nextProps) => {
    // If id is provided, use it for memoization
    if (prevProps.id && nextProps.id) {
      return (
        prevProps.id === nextProps.id &&
        prevProps.children === nextProps.children &&
        prevProps.mode === nextProps.mode &&
        prevProps.disablePreviewBlocks === nextProps.disablePreviewBlocks
      )
    }
    // Otherwise compare content and mode
    return (
      prevProps.children === nextProps.children &&
      prevProps.mode === nextProps.mode &&
      prevProps.disablePreviewBlocks === nextProps.disablePreviewBlocks
    )
  }
)
MemoizedMarkdown.displayName = 'MemoizedMarkdown'

// Re-export for convenience
export { CodeBlock, InlineCode } from './code-block'
export { CollapsibleMarkdownProvider } from './collapsible-markdown-context'
