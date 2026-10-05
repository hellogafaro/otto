import * as React from 'react'
import {
  ArrowLeft,
  CircleCheck,
  Circle,
  CircleDashed,
  CircleDot,
  Clock,
  Folder,
  Library,
  LogOut,
  MessagesSquare,
  Monitor,
  Moon,
  Settings,
  SquarePen,
  Sun,
  Zap,
  DatabaseZap,
} from 'lucide-react'
import type { ComponentEntry } from './types'
import { CommandPalette, type PaletteItem } from '@/components/command-palette/command-palette'
import { PALETTE_CATEGORIES, type PaletteCategory, type PaletteData } from '@/components/command-palette/palette-model'
import { SETTINGS_ICONS } from '@/components/icons/settings-icons'
import { cn } from '@/lib/utils'

// =============================================================================
// CommandPalette: the panel the ⌘K dialog shows, here inline on a dimmed page so
// both themes sit side by side (the palette itself is dark in both, like every
// floating surface). Type to filter, ↑↓ to move, Tab / Shift+Tab to switch the
// category, Enter to pick (the pick shows under the page).
// =============================================================================

const status = (Icon: typeof Circle, color: string) => (
  <span className="flex size-3.5 shrink-0 items-center justify-center" style={{ color }}>
    <Icon />
  </span>
)
const STATUS = {
  backlog: status(CircleDashed, 'var(--muted-foreground)'),
  todo: status(Circle, 'var(--foreground)'),
  review: status(CircleDot, 'var(--info)'),
  done: status(CircleCheck, 'var(--success)'),
}

const noop = () => {}
const chat = (id: string, title: string, s: keyof typeof STATUS, meta: string): PaletteItem => ({
  key: `chat:${id}`,
  title,
  icon: STATUS[s],
  meta,
  run: noop,
})
const row = (key: string, title: string, Icon: React.ComponentType<{ className?: string }>, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  key,
  title,
  icon: <Icon />,
  run: noop,
  ...extra,
})

const CHATS = [
  chat('c1', 'Fix the sidebar width', 'review', '3m'),
  chat('c2', 'Plan the release', 'todo', '20m'),
  chat('c3', 'Summarize the thread about the quarterly planning review and what we decided', 'backlog', '45m'),
  chat('c4', 'Review pull request 412', 'review', '2h'),
  chat('c5', 'Debug the login flow', 'todo', '3d'),
  chat('c6', 'Write the migration notes', 'backlog', '1w'),
  chat('c7', 'Draft the changelog', 'done', '2w'),
]

const SETTINGS: [string, string][] = [
  ['app', 'App'], ['ai', 'AI'], ['appearance', 'Appearance'], ['input', 'Input'], ['shortcuts', 'Shortcuts'],
  ['preferences', 'Preferences'], ['workspace', 'Workspace'], ['permissions', 'Permissions'], ['labels', 'Labels'], ['messaging', 'Messaging'],
]

const DATA: PaletteData<PaletteItem> = {
  pinned: [CHATS[0]!],
  recent: [CHATS[1]!, CHATS[3]!, CHATS[4]!],
  chats: CHATS,
  pages: [
    row('page:tasks', 'Tasks', CircleCheck),
    row('page:projects', 'Projects', Folder),
    row('page:chats', 'Chats', MessagesSquare),
    row('page:routines', 'Routines', Clock),
    row('page:library', 'Library', Library),
  ],
  settings: SETTINGS.map(([id, title]) =>
    row(`settings:${id}`, title, SETTINGS_ICONS[id as keyof typeof SETTINGS_ICONS], id === 'shortcuts' ? { hotkey: '⌘/' } : {}),
  ),
  skills: [row('skill:release-notes', 'Release notes', Zap), row('skill:code-review', 'Code review', Zap)],
  sources: [row('source:linear', 'Linear', DatabaseZap), row('source:github', 'GitHub', DatabaseZap)],
  actions: [
    row('action:newChat', 'New chat', SquarePen, { hotkey: '⌘N' }),
    row('action:settings', 'Open settings', Settings, { hotkey: '⌘,' }),
    row('action:theme-light', 'Light theme', Sun),
    row('action:theme-dark', 'Dark theme', Moon, { checked: true }),
    row('action:theme-system', 'System theme', Monitor),
    row('action:back', 'Go back', ArrowLeft, { hotkey: '⌘[' }),
    row('action:logOut', 'Log out', LogOut),
  ],
}

const EMPTY_SECTIONS: PaletteData<PaletteItem> = { ...DATA, pinned: [], recent: [], skills: [], sources: [] }

function Demo({ theme, category, sparse }: { theme: 'light' | 'dark'; category: PaletteCategory; sparse: boolean }) {
  const [picked, setPicked] = React.useState<string | null>(null)
  return (
    <div className={cn(theme === 'dark' && 'dark', 'w-full')}>
      <div className="relative h-[720px] w-full overflow-hidden rounded-lg bg-sidebar text-foreground">
        {/* A page behind the glass, so the blur has something to show. */}
        <div className="flex flex-col gap-3 p-8">
          <div className="text-lg font-medium">Chats</div>
          {CHATS.map((c) => (
            <div key={c.key} className="card-surface flex h-11 items-center gap-2 rounded-xl bg-card px-4 text-sm">
              {c.icon}
              {c.title}
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-x-4 top-[15%] mx-auto max-w-[720px]">
          <div className="dark overflow-hidden rounded-xl bg-popover/70 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150">
            <CommandPalette
              key={category}
              data={sparse ? EMPTY_SECTIONS : DATA}
              initialCategory={category}
              onPick={(item) => setPicked(item.title)}
            />
          </div>
        </div>
        {picked && (
          <div className="absolute bottom-3 left-4 rounded-sm bg-background px-2 py-1 text-xs text-muted-foreground">
            Picked: {picked}
          </div>
        )}
      </div>
    </div>
  )
}

export const commandPaletteComponents: ComponentEntry[] = [
  {
    id: 'command-palette',
    name: 'Command palette',
    category: 'Shell',
    description:
      'The ⌘K palette: 720px, 15% from the top, the dark glass surface over a plain 50% black overlay. A 48px search field, the 32px category tabs (Tab switches), 36px rows under group headings in All (Pinned and Recent first while the field is empty), and a 48px footer with the keys. Empty categories have no tab; a search that finds nothing shows the compact empty state without tabs.',
    component: Demo,
    layout: 'top',
    previewOverflow: 'auto',
    props: [
      { name: 'theme', description: 'The app theme behind the palette', control: { type: 'select', options: [{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] }, defaultValue: 'light' },
      { name: 'category', description: 'The category it opens on', control: { type: 'select', options: PALETTE_CATEGORIES.map((c) => ({ label: c, value: c })) }, defaultValue: 'all' },
      { name: 'sparse', description: 'No pins, recents, skills or sources (their tabs go)', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Light', props: { theme: 'light', category: 'all', sparse: false } },
      { name: 'Dark', props: { theme: 'dark', category: 'all', sparse: false } },
      { name: 'Settings tab', props: { theme: 'dark', category: 'settings', sparse: false } },
      { name: 'Without skills and sources', props: { theme: 'light', category: 'all', sparse: true } },
    ],
  },
]
