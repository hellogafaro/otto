/**
 * CommandPalette - the palette's panel, drawn from data it is given (`usePaletteData`
 * in the app, dummy data in the playground). The dialog around it, ⌘K and the
 * `useCommandPalette()` API are the provider's.
 *
 * Top to bottom: the borderless 48px search field over a full-width divider; the
 * category tabs (32px, 8px above and below; Tab and Shift+Tab switch them, an empty
 * category has none, and none are drawn while nothing matches anywhere); the 36px
 * rows, under group headings in All, with edges that fade while more scroll; the
 * 48px footer with the keys (hidden on phones). Focus never leaves the field: the
 * tabs do not take it, so typing always searches.
 *
 * The field is never delayed, the results are: they follow the query after the shared
 * `DEBOUNCE_MS`, with skeleton rows meanwhile (`paletteView`). Nothing can be
 * picked while they wait: ↑↓ do nothing and Enter only skips the wait (it shows the
 * results and picks nothing), so a row is only ever picked from results the user sees.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@workspace/ui/components/command'
import { Empty, EmptyMedia, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  availableCategories,
  buildGroups,
  cleanQuery,
  hasAnyMatch,
  paletteView,
  resolveCategory,
  rowValue,
  stepCategory,
  type PaletteCategory,
  type PaletteData,
  type PaletteEntry,
  type PaletteGroupKey,
} from './palette-model'

/** One row: what it shows and what picking it does. */
export interface PaletteItem extends PaletteEntry {
  /** A 14px icon (a chat's status, a page's icon, a skill's or source's avatar). */
  icon: React.ReactNode
  /** Muted text at the row's end: a chat's time. */
  meta?: string
  /** The action's key, as a `Kbd` at the row's end. */
  hotkey?: string | null
  /** What is on now (the current theme): a check at the row's end. */
  checked?: boolean
  run: () => void
}

const LABEL_KEYS: Record<PaletteCategory | PaletteGroupKey, string> = {
  all: 'commandPalette.all',
  pinned: 'sidebar.pinned',
  recent: 'sidebar.recent',
  chats: 'sidebar.chats',
  pages: 'commandPalette.pages',
  settings: 'sidebar.settings',
  skills: 'sidebar.skills',
  sources: 'sidebar.sources',
  actions: 'commandPalette.actions',
}

interface CommandPaletteProps {
  data: PaletteData<PaletteItem>
  /** The tab it opens on (a page's search button opens on its own). */
  initialCategory?: PaletteCategory
  onPick: (item: PaletteItem) => void
}

export function CommandPalette({ data, initialCategory = 'all', onPick }: CommandPaletteProps) {
  const { t } = useTranslation()
  const [text, setText] = React.useState('')
  const [wanted, setWanted] = React.useState(initialCategory)
  // The highlighted row; '' (or a row that is gone) means the first one.
  const [selected, setSelected] = React.useState('')

  const [debouncedText, , skipWait] = useDebouncedValue(cleanQuery(text))
  const { query, pending } = paletteView(cleanQuery(text), debouncedText)
  const available = React.useMemo(() => availableCategories(data), [data])
  const category = resolveCategory(available, wanted)
  const groups = React.useMemo(() => (pending ? [] : buildGroups(data, category, query)), [data, category, query, pending])
  // While waiting, the tabs keep the state of the last results.
  const nothing = !!query && !hasAnyMatch(data, query)
  const showTabs = available.length > 1 && !nothing

  const values = groups.flatMap((group) => group.items.map((item) => rowValue(group.key, item)))
  const highlighted = values.includes(selected) ? selected : (values[0] ?? '')

  const switchTo = (next: PaletteCategory) => {
    setWanted(next)
    setSelected('')
  }

  return (
    <Command
      data-command-palette=""
      label={t('commandPalette.placeholder')}
      shouldFilter={false}
      value={highlighted}
      onValueChange={setSelected}
      onKeyDown={(event) => {
        if (pending && ['Enter', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          // Nothing to pick or move over yet; Enter only skips the wait.
          event.preventDefault()
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) skipWait()
          return
        }
        if (event.key !== 'Tab') return
        // Tab never leaves the field: it switches the category.
        event.preventDefault()
        if (showTabs) switchTo(stepCategory(available, category, event.shiftKey ? -1 : 1))
      }}
    >
      <CommandInput
        value={text}
        onValueChange={(value) => {
          setText(value)
          setSelected('')
        }}
        placeholder={t('commandPalette.placeholder')}
      />
      {showTabs && (
        <Tabs size="compact" value={category} onValueChange={(value) => switchTo(value as PaletteCategory)} className="no-scrollbar shrink-0 overflow-x-auto p-2">
          <TabsList aria-label={t('commandPalette.categories')}>
            {available.map((value) => (
              // The field keeps focus (and the caret) when a tab is clicked.
              <TabsTrigger key={value} value={value} tabIndex={-1} onMouseDown={(event) => event.preventDefault()}>
                {t(LABEL_KEYS[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <CommandList className={showTabs ? 'pt-0' : undefined} aria-busy={pending}>
        {pending && <PaletteSkeleton heading={category === 'all'} />}
        {query && !pending && (
          <CommandEmpty className="py-0">
            <Empty className="gap-2 p-6">
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle className="text-sm">{t('commandPalette.noResults', { query: text.trim() })}</EmptyTitle>
            </Empty>
          </CommandEmpty>
        )}
        {groups.map((group) => (
          <CommandGroup key={group.key} heading={category === 'all' ? t(LABEL_KEYS[group.key]) : undefined}>
            {group.items.map((item) => (
              <CommandItem
                key={item.key}
                value={rowValue(group.key, item)}
                onSelect={() => onPick(item)}
                data-checked={item.checked ? 'true' : undefined}
              >
                {item.icon}
                <span className="min-w-0 truncate">{item.title}</span>
                {item.meta && <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">{item.meta}</span>}
                {item.hotkey && <Kbd className="ml-auto max-sm:hidden">{item.hotkey}</Kbd>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <PaletteKeys showCategory={showTabs} />
    </Command>
  )
}

/** The rows while the results wait: a heading (in All) and three rows, drawn like the real ones (28px, 36px, 16px in). */
function PaletteSkeleton({ heading }: { heading: boolean }) {
  return (
    <div aria-hidden>
      {heading && (
        <div className="flex h-7 items-center px-3">
          <Skeleton className="h-3 w-14" />
        </div>
      )}
      {['w-44', 'w-32', 'w-52'].map((width) => (
        <div key={width} className="flex h-9 items-center gap-2 px-3">
          <Skeleton className="size-3.5" />
          <Skeleton className={`h-3.5 ${width}`} />
        </div>
      ))}
    </div>
  )
}

/** The footer: the keys that drive the palette. Phones have none, so it is hidden there. */
function PaletteKeys({ showCategory }: { showCategory: boolean }) {
  const { t } = useTranslation()
  const hints = [
    { keys: ['↑', '↓'], label: t('commandPalette.hintNavigate') },
    { keys: ['↵'], label: t('commandPalette.hintOpen') },
    ...(showCategory ? [{ keys: ['Tab'], label: t('commandPalette.hintCategory') }] : []),
    { keys: ['Esc'], label: t('commandPalette.hintClose') },
  ]
  return (
    <div className="hidden h-12 shrink-0 items-center justify-end gap-4 border-t border-foreground/10 px-4 text-xs text-muted-foreground sm:flex">
      {hints.map(({ keys, label }) => (
        <span key={label} className="flex items-center gap-2">
          <KbdGroup>
            {keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
          {label}
        </span>
      ))}
    </div>
  )
}
