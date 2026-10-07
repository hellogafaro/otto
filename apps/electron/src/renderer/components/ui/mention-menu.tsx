import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, Folder, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { placeMenuAbove } from '@/lib/input-viewport'
import { isEntityMention } from '@/lib/mentions'
import { FadingText } from '@/components/ui/fading-text'
import { AgentAvatar } from '@/components/people/agent-avatar'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { MENU_LABEL, MENU_LIST, MENU_ROW, MENU_ROW_HIGHLIGHT, MENU_SURFACE } from './menu-styles'
import type { Agent, LoadedSkill, LoadedSource, FileSearchResult } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

/** `task`, `project`, `agent` and `user` are entity mentions: the item's `id` is the token (`task:<id>`) that goes into the text. */
export type MentionItemType = 'skill' | 'source' | 'file' | 'folder' | 'task' | 'project' | 'agent' | 'user'

export interface MentionItem {
  id: string
  type: MentionItemType
  label: string
  description?: string
  /** Breaks a tie between equal matches, higher first (an entity's last update). */
  rank?: number
  // Type-specific data
  skill?: LoadedSkill
  source?: LoadedSource
  /** An agent's id and avatar, for its picture. */
  agent?: Pick<Agent, 'id' | 'avatar'>
  file?: { path: string; type: 'file' | 'directory'; relativePath: string }
}

export interface MentionSection {
  id: string
  label: string
  items: MentionItem[]
  /** Shown under the heading while the section has no items (and nothing is typed). */
  empty?: string
  /** How many rows the section shows until something is typed. */
  preview?: number
}

export interface InlineMentionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: MentionSection[]
  onSelect: (item: MentionItem) => void
  filter?: string
  position: { x: number; y: number }
  workspaceId?: string
  maxWidth?: number
  className?: string
  /** Whether file search is in progress */
  isSearching?: boolean
}

// ============================================================================
// Shared Styles
// ============================================================================

// Type shown at the end of a skill or source row
const MENU_TYPE_LABEL = 'shrink-0 text-xs text-muted-foreground'

// ============================================================================
// Path utilities
// ============================================================================

/** Extract parent directory from a relative path (e.g. "src/components/Button.tsx" → "src/components/") */
function getParentDir(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf('/')
  if (lastSlash <= 0) return ''
  return relativePath.slice(0, lastSlash + 1)
}

/** Check if query characters appear in order within target.
 *  Returns true if all characters of query are found sequentially in target.
 *  Note: comparison is literal — pass lowercased inputs for case-insensitive matching. */
function subsequenceMatch(target: string, query: string): boolean {
  let qi = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++
  }
  return qi === query.length
}

/** Filter cached FileSearchResults by query and convert to MentionItems.
 *  Uses substring matching first (score 2), then subsequence matching as
 *  fallback (score 1) so queries like "appav" find "app availability.md". */
function filterCacheResults(cache: FileSearchResult[], query: string): MentionItem[] {
  const lowerQuery = query.trimEnd().toLowerCase()
  if (!lowerQuery) return []

  const scored = cache
    .map(f => {
      const name = f.name.toLowerCase()
      const path = f.relativePath.toLowerCase()
      let score = 0
      if (name.includes(lowerQuery) || path.includes(lowerQuery)) {
        score = 2
      } else if (subsequenceMatch(name, lowerQuery) || subsequenceMatch(path, lowerQuery)) {
        score = 1
      }
      return { f, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  return scored.map(({ f }) => ({
    id: f.path,
    type: f.type === 'directory' ? 'folder' as const : 'file' as const,
    label: f.name,
    description: f.relativePath,
    file: { path: f.path, type: f.type, relativePath: f.relativePath },
  }))
}

// ============================================================================
// Filter utilities
// ============================================================================

/**
 * Get match priority score for filtering (higher = better match)
 * 3 = starts with filter (first word)
 * 2 = word boundary match (2nd+ word after space/hyphen/underscore)
 * 1 = contains filter (mid-word)
 * 0 = no match
 */
function getMatchScore(text: string, filter: string): number {
  const lowerText = text.toLowerCase()
  // Best: starts with filter (first word)
  if (lowerText.startsWith(filter)) return 3
  // Good: word boundary match (after space/hyphen/underscore)
  const escapedFilter = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordBoundaryPattern = new RegExp(`[\\s\\-_]${escapedFilter}`)
  if (wordBoundaryPattern.test(lowerText)) return 2
  // OK: contains filter anywhere
  if (lowerText.includes(filter)) return 1
  return 0
}

/** The most rows a typed query lists. */
const MAX_RESULTS = 30

/** What ranks a match (an entity's id is its token, which a query must not hit; a person's description is the email). */
const scored = (item: MentionItem) => (isEntityMention(item.type) ? [item.label, item.description] : [item.label, item.id])

/** Nothing typed: each section as it is (cut to its `preview`). Typed: one list of what matches, best match first, then newest, then by name. */
export function filterSections(sections: MentionSection[], filter: string): MentionSection[] {
  const lowerFilter = filter.trimEnd().toLowerCase()
  if (!lowerFilter) return sections.map(section => (section.preview === undefined ? section : { ...section, items: section.items.slice(0, section.preview) }))

  // Collect all matching items across sections
  const matchingItems = sections
    .flatMap(section => section.items)
    .filter(item => [...scored(item), item.description].some(text => text?.toLowerCase().includes(lowerFilter)))

  // Sort by match priority: first word > later word > contains
  const score = (item: MentionItem) => Math.max(...scored(item).map(text => (text ? getMatchScore(text, lowerFilter) : 0)))
  matchingItems.sort((a, b) => {
    const aScore = score(a)
    const bScore = score(b)
    if (aScore !== bScore) return bScore - aScore

    // Same score tier: the most recently updated, then alphabetical by label
    const recent = (b.rank ?? 0) - (a.rank ?? 0)
    return recent !== 0 ? recent : a.label.localeCompare(b.label)
  })

  // Return as flat list in a single virtual section (headers hidden when filtering)
  if (matchingItems.length === 0) return []
  return [{ id: 'results', label: 'Results', items: matchingItems.slice(0, MAX_RESULTS) }]
}

function flattenItems(sections: MentionSection[]): MentionItem[] {
  return sections.flatMap(section => section.items)
}

/**
 * Check if the @ character at the given position is a valid mention trigger.
 * Valid triggers are:
 * - @ at the start of input (position 0)
 * - @ preceded by whitespace (space, tab, newline)
 * - @ preceded by opening brackets or quotes: ( " '
 *
 * Invalid triggers (returns false):
 * - @ in the middle of a word (e.g., "test@example.com")
 * - @ preceded by alphanumeric or other characters
 *
 * @param textBeforeCursor - The text from start of input to cursor position
 * @param atPosition - The position of the @ character in textBeforeCursor
 * @returns true if this @ should trigger the mention menu
 */
export function isValidMentionTrigger(textBeforeCursor: string, atPosition: number): boolean {
  if (atPosition < 0) return false
  if (atPosition === 0) return true
  const charBefore = textBeforeCursor[atPosition - 1]
  if (charBefore === undefined) return false
  // Allow whitespace or opening brackets/quotes before @
  return /\s/.test(charBefore) || /[("']/.test(charBefore)
}

// ============================================================================
// InlineMentionMenu Component
// ============================================================================

export function InlineMentionMenu({
  open,
  onOpenChange,
  sections,
  onSelect,
  filter = '',
  position,
  workspaceId,
  maxWidth = 280,
  className,
}: InlineMentionMenuProps) {
  const { t } = useTranslation()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenItems(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Keyboard navigation
  // Don't attach listener when no items - allows Enter to propagate to input handler
  React.useEffect(() => {
    if (!open || flatItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            onSelect(flatItems[selectedIndex])
            onOpenChange(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, flatItems, selectedIndex, onSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Scroll selected item into view when navigating with keyboard
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!open) return null

  // Above the cursor, on screen, in the zoomed root's pixels
  const place = placeMenuAbove(position, maxWidth)
  // Section headings while nothing is typed; a typed query lists the matches as one, so each row names its type
  const headings = !filter.trim()
  let itemIndex = -1

  return (
    <div
      ref={menuRef}
      data-inline-menu
      className={cn('fixed z-dropdown', MENU_SURFACE, className)}
      style={{
        left: place.left,
        bottom: place.bottom,
        width: place.maxWidth,
        maxWidth: place.maxWidth,
      }}
    >
      <div ref={listRef} className={MENU_LIST}>
        {flatItems.length === 0 && filter && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('chat.noResults')}</div>
        )}
        {filteredSections.map((section) => (
          <React.Fragment key={section.id}>
            {headings && <div className={MENU_LABEL}>{section.label}</div>}
            {headings && section.items.length === 0 && section.empty && (
              <div className="px-2 pb-1.5 text-sm text-muted-foreground">{section.empty}</div>
            )}
            {section.items.map((item) => {
              itemIndex += 1
              const index = itemIndex
              const isSelected = index === selectedIndex

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  data-selected={isSelected}
                  // Keep the caret in the composer (a blur would fold the compact bar).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(item)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(MENU_ROW, isSelected && MENU_ROW_HIGHLIGHT)}
                >
                  {/* Icon based on type */}
                  <div className="shrink-0">
                    {item.type === 'skill' && item.skill && (
                      <SkillAvatar skill={item.skill} size="sm" workspaceId={workspaceId} />
                    )}
                    {item.type === 'source' && item.source && (
                      <SourceAvatar source={item.source} size="sm" />
                    )}
                    {item.type === 'task' && <CircleCheck className="text-muted-foreground" />}
                    {item.type === 'project' && <Folder className="text-muted-foreground" />}
                    {item.type === 'user' && <User className="text-muted-foreground" />}
                    {item.type === 'agent' && item.agent && <AgentAvatar agent={item.agent} size="sm" className="size-3.5 data-[size=sm]:size-3.5" />}
                    {item.type === 'folder' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-muted-foreground">
                        <path d="M20.5 10C20.5 9.07003 20.5 8.60504 20.3978 8.22354C20.1204 7.18827 19.3117 6.37962 18.2765 6.10222C17.895 6 17.43 6 16.5 6H13.1008C12.4742 6 12.1609 6 11.8739 5.91181C11.6824 5.85298 11.5009 5.76572 11.3353 5.65295C11.0871 5.48389 10.8914 5.23926 10.5 4.75L10.4095 4.63693C10.107 4.25881 9.9558 4.06975 9.7736 3.92674C9.54464 3.74703 9.27921 3.61946 8.99585 3.55294C8.77037 3.5 8.52825 3.5 8.04402 3.5C6.60485 3.5 5.88527 3.5 5.32008 3.74178C4.61056 4.0453 4.0453 4.61056 3.74178 5.32008C3.5 5.88527 3.5 6.60485 3.5 8.04402V10M9.46502 20.5H14.535C16.9102 20.5 18.0978 20.5 18.9301 19.8113C19.7624 19.1226 19.9846 17.9559 20.429 15.6227L20.8217 13.5613C21.1358 11.9121 21.2929 11.0874 20.843 10.5437C20.393 10 19.5536 10 17.8746 10H6.12537C4.44643 10 3.60696 10 3.15704 10.5437C2.70713 11.0874 2.8642 11.9121 3.17835 13.5613L3.57099 15.6227C4.01541 17.9559 4.23763 19.1226 5.06992 19.8113C5.90221 20.5 7.08981 20.5 9.46502 20.5Z"/>
                      </svg>
                    )}
                    {item.type === 'file' && (
                      <FileMenuIcon name={item.label} />
                    )}
                  </div>

                  {/* Label and optional path/badge */}
                  {(item.type === 'file' || item.type === 'folder') ? (
                    <>
                      {/* File/folder: filename then parent path fading out on overflow */}
                      <span className="shrink-0">{item.label}</span>
                      {item.file?.relativePath && getParentDir(item.file.relativePath) && (
                        <FadingText className="text-xs text-muted-foreground min-w-0 opacity-50" fadeWidth={20}>
                          {getParentDir(item.file.relativePath)}
                        </FadingText>
                      )}
                    </>
                  ) : (
                    <>
                      {/* The label; a person's email after it; the type once a query mixes them */}
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{item.label}</span>
                      </div>
                      {item.type === 'user' && item.description && headings && (
                        <FadingText className="min-w-0 max-w-[45%] text-xs text-muted-foreground" fadeWidth={20}>{item.description}</FadingText>
                      )}
                      {!headings && (
                        <span className={MENU_TYPE_LABEL}>
                          {item.type === 'skill' ? t('common.skill') : item.type === 'source' ? t('common.source') : t(`entities.type_${item.type}`)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}

      </div>
    </div>
  )
}

// ============================================================================
// File icon component - picks icon variant based on file extension
// ============================================================================

/** Known code file extensions that get the code file icon (< >) */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'rb', 'swift', 'kt',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'css', 'scss', 'less', 'html', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml', 'xml',
  'sh', 'bash', 'zsh', 'fish',
  'md', 'mdx',
  'sql', 'graphql', 'proto',
])

/** Known image file extensions that get the image icon */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif',
])

function getFileIconType(name: string): 'code' | 'image' | 'generic' {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return 'generic'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'generic'
}

/** Renders the appropriate file icon based on extension (code, image, or generic) */
function FileMenuIcon({ name }: { name: string }) {
  const iconType = getFileIconType(name)

  if (iconType === 'code') {
    // Code file icon (document with < > brackets)
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
        <path d="M10.5 2.5C12.1569 2.5 13.5 3.84315 13.5 5.5V6.1C13.5 6.4716 13.5 6.6574 13.5246 6.81287C13.6602 7.66865 14.3313 8.33983 15.1871 8.47538C15.3426 8.5 15.5284 8.5 15.9 8.5H16.5C18.1569 8.5 19.5 9.84315 19.5 11.5M10.5 12.8799C9.70024 13.2985 9.10807 13.8275 8.64232 14.5478C8.51063 14.7515 8.44479 14.8533 8.44489 15.0011C8.44498 15.1488 8.51099 15.2506 8.643 15.4542C9.1095 16.1736 9.70167 16.7028 10.5 17.1225M13.5 12.8799C14.2998 13.2985 14.8919 13.8275 15.3577 14.5478C15.4894 14.7515 15.5552 14.8533 15.5551 15.0011C15.555 15.1488 15.489 15.2506 15.357 15.4542C14.8905 16.1736 14.2983 16.7028 13.5 17.1225M10.9645 2.5H10.6678C8.64635 2.5 7.63561 2.5 6.84835 2.85692C5.96507 3.25736 5.25736 3.96507 4.85692 4.84835C4.5 5.63561 4.5 6.64635 4.5 8.66781V14C4.5 17.2875 4.5 18.9312 5.40796 20.0376C5.57418 20.2401 5.75989 20.4258 5.96243 20.592C7.06878 21.5 8.71252 21.5 12 21.5C15.2875 21.5 16.9312 21.5 18.0376 20.592C18.2401 20.4258 18.4258 20.2401 18.592 20.0376C19.5 18.9312 19.5 17.2875 19.5 14V11.0355C19.5 10.0027 19.5 9.48628 19.4176 8.99414C19.2671 8.09576 18.9141 7.24342 18.3852 6.50177C18.0955 6.09549 17.7303 5.73032 17 5C16.2697 4.26968 15.9045 3.90451 15.4982 3.6148C14.7566 3.08595 13.9042 2.7329 13.0059 2.58243C12.5137 2.5 11.9973 2.5 10.9645 2.5Z"/>
      </svg>
    )
  }

  if (iconType === 'image') {
    // Image file icon (landscape frame with mountain/sun)
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
        <path d="M8 8.5C8 8.77614 7.77614 9 7.5 9C7.22386 9 7 8.77614 7 8.5C7 8.22386 7.22386 8 7.5 8C7.77614 8 8 8.22386 8 8.5Z" fill="currentColor"/>
        <path d="M20.9998 16.1004L17.9497 13.0503C16.6163 11.7169 15.9496 11.0503 15.1212 11.0503C14.2928 11.0503 13.6261 11.7169 12.2928 13.0503L5.34323 20M8 8.5C8 8.77614 7.77614 9 7.5 9C7.22386 9 7 8.77614 7 8.5C7 8.22386 7.22386 8 7.5 8C7.77614 8 8 8.22386 8 8.5ZM10.5 20.5H13.5C17.2712 20.5 19.1569 20.5 20.3284 19.3284C21.5 18.1569 21.5 16.2712 21.5 12.5V11.5C21.5 7.72876 21.5 5.84315 20.3284 4.67157C19.1569 3.5 17.2712 3.5 13.5 3.5H10.5C6.72876 3.5 4.84315 3.5 3.67157 4.67157C2.5 5.84315 2.5 7.72876 2.5 11.5V12.5C2.5 16.2712 2.5 18.1569 3.67157 19.3284C4.84315 20.5 6.72876 20.5 10.5 20.5Z"/>
      </svg>
    )
  }

  // Generic file icon (document with folded corner)
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <path d="M10.5 2.5C12.1569 2.5 13.5 3.84315 13.5 5.5V6.1C13.5 6.4716 13.5 6.6574 13.5246 6.81287C13.6602 7.66865 14.3313 8.33983 15.1871 8.47538C15.3426 8.5 15.5284 8.5 15.9 8.5H16.5C18.1569 8.5 19.5 9.84315 19.5 11.5M9 16H15M9 12H10M10.9645 2.5H10.6678C8.64635 2.5 7.63561 2.5 6.84835 2.85692C5.96507 3.25736 5.25736 3.96507 4.85692 4.84835C4.5 5.63561 4.5 6.64635 4.5 8.66781V14C4.5 17.2875 4.5 18.9312 5.40796 20.0376C5.57418 20.2401 5.75989 20.4258 5.96243 20.592C7.06878 21.5 8.71252 21.5 12 21.5C15.2875 21.5 16.9312 21.5 18.0376 20.592C18.2401 20.4258 18.4258 20.2401 18.592 20.0376C19.5 18.9312 19.5 17.2875 19.5 14V11.0355C19.5 10.0027 19.5 9.48628 19.4176 8.99414C19.2671 8.09576 18.9141 7.24342 18.3852 6.50177C18.0955 6.09549 17.7303 5.73032 17 5C16.2697 4.26968 15.9045 3.90451 15.4982 3.6148C14.7566 3.08595 13.9042 2.7329 13.0059 2.58243C12.5137 2.5 11.9973 2.5 10.9645 2.5Z"/>
    </svg>
  )
}

// ============================================================================
// Hook for managing inline mention state
// ============================================================================

/** Interface for elements that can be used with useInlineMention */
export interface MentionInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

export interface UseInlineMentionOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<MentionInputElement | null>
  skills: LoadedSkill[]
  sources: LoadedSource[]
  /** Base path for file search (working directory) */
  basePath?: string
  onSelect: (item: MentionItem) => void
  /** Workspace ID for fully-qualified skill names */
  workspaceId?: string
  /** People, tasks and projects to mention, ahead of the skills (the caller builds them from its lists). */
  entities?: MentionSection[]
}

export interface UseInlineMentionReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: MentionSection[]
  /** Whether file search is in progress */
  isSearching: boolean
  /** The menu lists a row for what is typed (else Enter belongs to the input, not the menu). */
  hasItems: boolean
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  handleSelect: (item: MentionItem) => { value: string; cursorPosition: number }
}

const NO_SECTIONS: MentionSection[] = []

export function useInlineMention({
  inputRef,
  skills,
  sources,
  basePath,
  onSelect,
  workspaceId,
  entities = NO_SECTIONS,
}: UseInlineMentionOptions): UseInlineMentionReturn {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  // committedFilter: only updates when IPC returns (or immediately when no IPC needed).
  // Prevents visual jumps — the menu shows all items until results are ready,
  // then applies filter + file results in a single frame.
  const [committedFilter, setCommittedFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [atStart, setAtStart] = React.useState(-1)
  const [fileResults, setFileResults] = React.useState<MentionItem[]>([])
  const fileSearchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cache of raw IPC file search results for the current menu session.
  // Allows instant client-side filtering when user edits the query (add/delete chars)
  // without waiting for a new IPC round-trip. Cleared when menu closes.
  const fileCache = React.useRef<FileSearchResult[]>([])
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Cleanup pending timeout on unmount
  React.useEffect(() => {
    return () => {
      if (fileSearchTimeout.current) {
        clearTimeout(fileSearchTimeout.current)
      }
    }
  }, [])

  // Build sections from available data (skills, sources, and file search results)
  const sections = React.useMemo((): MentionSection[] => {
    const result: MentionSection[] = [...entities]

    // Skills section
    if (skills.length > 0) {
      result.push({
        id: 'skills',
        label: t('composer.mention.skills'),
        items: skills.map(skill => ({
          id: skill.slug,
          type: 'skill' as const,
          label: skill.metadata.name,
          description: skill.metadata.description,
          skill,
        })),
      })
    }

    // Sources section
    if (sources.length > 0) {
      result.push({
        id: 'sources',
        label: t('composer.mention.sources'),
        items: sources
          .filter(source => source.config.slug && source.config.name)
          .map(source => ({
            id: source.config.slug,
            type: 'source' as const,
            label: source.config.name,
            description: source.config.tagline,
            source,
          })),
      })
    }

    // Files section (from async search results)
    if (fileResults.length > 0) {
      result.push({
        id: 'files',
        label: t('composer.mention.files'),
        items: fileResults,
      })
    }

    return result
  }, [entities, skills, sources, fileResults, t])

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    // Match @ followed by up to 100 chars (letters, digits, hyphens, slashes, dots, and spaces), not starting with a space.
    // Spaces are allowed so users can type filenames and titles with spaces (e.g. @app availability.md).
    // The menu auto-closes when a space produces no matches (Slack-style behavior).
    const atMatch = textBeforeCursor.match(/@([\p{L}\p{N}_\-\/.][\p{L}\p{N}_\-\/.\s]{0,99})?$/u)

    // Check if this is a valid @ mention trigger
    const matchStart = atMatch ? textBeforeCursor.lastIndexOf('@') : -1
    const isValidTrigger = atMatch && isValidMentionTrigger(textBeforeCursor, matchStart)

    if (isValidTrigger) {
      const filterText = atMatch[1] || ''

      // Slack-style auto-close: if the query contains a space and the file cache is
      // populated but produces zero matches, close the menu. This prevents the
      // "infinite spaces" problem while still allowing multi-word queries like
      // "app availability.md". Skills/sources rarely have spaces in names, so
      // file cache is the authoritative signal here.
      if (filterText.includes(' ') && fileCache.current.length > 0) {
        const fileMatches = filterCacheResults(fileCache.current, filterText)
        if (fileMatches.length === 0) {
          setIsOpen(false)
          setCommittedFilter('')
          setAtStart(-1)
          if (fileSearchTimeout.current) {
            clearTimeout(fileSearchTimeout.current)
            fileSearchTimeout.current = null
          }
          setFileResults([])
          fileCache.current = []
          return
        }
      }

      setAtStart(matchStart)

      // Cache-first file search: if cache has entries from a previous IPC call,
      // filter client-side instantly (no IPC, no debounce). Otherwise fire a
      // debounced IPC to populate the cache. Cache clears when menu closes.
      window.electronAPI.debugLog('[mention] filterText:', filterText, 'basePath:', basePath, 'cacheSize:', fileCache.current.length)
      if (basePath && filterText.length >= 1) {
        if (fileCache.current.length > 0) {
          // Cache exists — filter client-side instantly, no IPC needed
          if (fileSearchTimeout.current) {
            clearTimeout(fileSearchTimeout.current)
            fileSearchTimeout.current = null
          }
          const filtered = filterCacheResults(fileCache.current, filterText)
          window.electronAPI.debugLog('[mention] cache hit:', filtered.length, 'items')
          setFileResults(filtered)
          setCommittedFilter(filterText)
        } else {
          // First search — fire debounced IPC to populate cache
          if (fileSearchTimeout.current) clearTimeout(fileSearchTimeout.current)

          fileSearchTimeout.current = setTimeout(async () => {
            try {
              window.electronAPI.debugLog('[mention] calling IPC searchFiles:', basePath, filterText)
              const results = await window.electronAPI.searchFiles(basePath, filterText)
              window.electronAPI.debugLog('[mention] IPC returned:', results?.length, 'results')
              fileCache.current = results
              const filtered = filterCacheResults(fileCache.current, filterText)
              window.electronAPI.debugLog('[mention] after cache filter:', filtered.length, 'items')
              setFileResults(filtered)
              setCommittedFilter(filterText)
            } catch (err) {
              window.electronAPI.debugLog('[mention] IPC searchFiles error:', String(err))
            }
          }, 150)
        }
      } else {
        window.electronAPI.debugLog('[mention] skipping file search (no basePath or empty filter)')
        if (fileSearchTimeout.current) {
          clearTimeout(fileSearchTimeout.current)
          fileSearchTimeout.current = null
        }
        setFileResults([])
        setCommittedFilter(filterText)
      }

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setCommittedFilter('')
      setAtStart(-1)
      // Clear file search state and cache when menu closes
      if (fileSearchTimeout.current) {
        clearTimeout(fileSearchTimeout.current)
        fileSearchTimeout.current = null
      }
      setFileResults([])
      fileCache.current = []
    }
  }, [inputRef, basePath])

  const handleSelect = React.useCallback((item: MentionItem): { value: string; cursorPosition: number } => {
    let result = ''
    let newCursorPosition = 0

    if (atStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, atStart)
      const after = currentValue.slice(cursorPosition)

      const buildMentionText = (kind: 'skill' | 'source' | 'file' | 'folder', value: string): string =>
        '[' + kind + ':' + value + '] '

      // Build the mention text based on type using bracket syntax.
      // Skills use fully-qualified names (workspaceId:slug) because the SDK's
      // Skill tool requires this format to resolve workspace-scoped skills.
      let mentionText: string
      if (item.type === 'skill') {
        const qualifiedName = workspaceId ? `${workspaceId}:${item.id}` : item.id
        mentionText = buildMentionText('skill', qualifiedName)
      } else if (item.type === 'source') {
        mentionText = buildMentionText('source', item.id)
      } else if (item.type === 'file') {
        // Use relative path for file mentions
        mentionText = buildMentionText('file', item.file?.relativePath || item.id)
      } else if (item.type === 'folder') {
        mentionText = buildMentionText('folder', item.file?.relativePath || item.id)
      } else if (isEntityMention(item.type)) {
        // The bare token, as the server and the chat read it
        mentionText = item.id + ' '
      } else {
        mentionText = buildMentionText('skill', item.id)
      }

      result = before + mentionText + after
      newCursorPosition = before.length + mentionText.length
    }

    onSelect(item)
    setIsOpen(false)
    setCommittedFilter('')
    // Clear file search state and cache to prevent stale results on next open
    if (fileSearchTimeout.current) {
      clearTimeout(fileSearchTimeout.current)
      fileSearchTimeout.current = null
    }
    setFileResults([])
    fileCache.current = []

    return { value: result, cursorPosition: newCursorPosition }
  }, [onSelect, atStart, workspaceId])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setCommittedFilter('')
    setAtStart(-1)
    // Clear file search state and cache to prevent stale results on next open
    if (fileSearchTimeout.current) {
      clearTimeout(fileSearchTimeout.current)
      fileSearchTimeout.current = null
    }
    setFileResults([])
    fileCache.current = []
  }, [])

  return {
    isOpen,
    filter: committedFilter,
    position,
    sections,
    isSearching: false,
    hasItems: filterSections(sections, committedFilter).some(section => section.items.length > 0),
    handleInputChange,
    close,
    handleSelect,
  }
}
