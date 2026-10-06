import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { Spinner } from '@otto/ui'
import { Input } from '@workspace/ui/components/input'

/**
 * SessionSearchHeader - Presentational component for session list search UI.
 *
 * Renders:
 * - Search input with static search icon
 * - Status row showing "Loading…" or "{count} results" when query is active
 *
 * This component is shared between the main app (SessionList) and the playground.
 */

export interface SessionSearchHeaderProps {
  /** Current search query value */
  searchQuery: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed (X button) */
  onSearchClose?: () => void
  /** Called on keydown in the search input */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /** Called when input gains focus */
  onFocus?: () => void
  /** Called when input loses focus */
  onBlur?: () => void
  /** Whether content search is in progress */
  isSearching?: boolean
  /** Number of results to display (when not searching) */
  resultCount?: number
  /** Whether the result count exceeded the display limit (shows "100+" instead of exact count) */
  exceededLimit?: boolean
  /** Ref for the input element (for focus management) */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Placeholder text */
  placeholder?: string
  /** Whether the input is read-only (for playground demos) */
  readOnly?: boolean
}

export function SessionSearchHeader({
  searchQuery,
  onSearchChange,
  onSearchClose,
  onKeyDown,
  onFocus,
  onBlur,
  isSearching = false,
  resultCount,
  exceededLimit = false,
  inputRef,
  placeholder = 'Search titles and content...',
  readOnly = false,
}: SessionSearchHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      {/* A 28px field nested in the sidebar: 6px corners, the search icon in the rows' 20px slot, the text on the rows' label column. */}
      <div className="relative">
        <span className="pointer-events-none absolute top-1 left-1 flex size-5 items-center justify-center text-muted-foreground">
          <Search className="size-3.5" />
        </span>
        <Input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          readOnly={readOnly}
          placeholder={placeholder}
          className="h-7 rounded-sm pr-8 pl-8"
        />
        {onSearchClose && (
          <button
            onClick={onSearchClose}
            className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            title={t("session.closeSearch")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Search status row - shown when search mode is active (2+ characters) */}
      {searchQuery.length >= 2 && (
        <div className="flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground">
          {isSearching ? (
            <Spinner className="text-[9px] text-foreground/50" />
          ) : (
            <span>{t('session.results', { count: exceededLimit ? '100+' : (resultCount ?? 0) })}</span>
          )}
        </div>
      )}
    </div>
  )
}
