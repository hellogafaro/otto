import * as React from 'react'
import { Bell, Check, ChevronDown, Folder, Info, MessagesSquare, Plus, Search, Trash2 } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@workspace/ui/components/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { FloatingNav, FloatingNavButtons } from '@workspace/ui/components/floating-nav'
import { Input } from '@workspace/ui/components/input'
import { ListCard, ListGroup, ListRow } from '@workspace/ui/components/list-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuKbd,
  SidebarProvider,
} from '@workspace/ui/components/sidebar'
import { Switch } from '@workspace/ui/components/switch'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Toggle } from '@workspace/ui/components/toggle'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import { SettingsSegmentedControl } from '@/components/settings/settings-segmented-control'
import { SettingsRow } from '@/components/settings/settings-row'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

// =============================================================================
// States: every interactive element in every state, light and dark side by
// side, to audit that one selected / hover / open / focus / disabled language
// is used everywhere. Real components; where :hover, :focus-visible and :active
// cannot be emulated the cell carries `data-force="hover|focus|focus-visible|active"`
// and the audit script forces the pseudo-class through the DevTools protocol
// (CSS.forcePseudoState), so the REAL rules apply (nothing is re-implemented).
// "Replica" cells copy classes of an inline renderer element that is not exported.
// =============================================================================

type Force = 'hover' | 'focus' | 'focus-visible' | 'active'
const force = (f?: Force) => (f ? { 'data-force': f } : {})
/** For components that do not spread props: the script forces the first button inside. */
function ForceIn({ f, children }: { f: Force; children: React.ReactNode }) {
  return <span data-force-in={f} className="contents">{children}</span>
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-1', className)}>
      <div className="font-mono text-[9px] leading-3 text-muted-foreground/80">{label}</div>
      {children}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {note && <p className="font-mono text-[10px] leading-3 text-muted-foreground">{note}</p>}
      {children}
    </section>
  )
}

/** A surface the controls sit on: the frame (grey, `bg-sidebar`) or a card. */
function OnFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-lg bg-sidebar p-3', className)}>{children}</div>
}
function OnCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('card-surface rounded-xl bg-card p-3 text-card-foreground', className)}>{children}</div>
}

// ---------------------------------------------------------------- Buttons ---

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const
const SIZES = [
  ['default', '32'],
  ['compact', '28'],
  ['icon', 'icon 32'],
  ['icon-compact', 'icon 28'],
] as const
const BTN_STATES: Array<[string, Force | null, Record<string, unknown>]> = [
  ['rest', null, {}],
  ['hover', 'hover', {}],
  ['focus-visible', 'focus-visible', {}],
  [':active', 'active', {}],
  ['disabled', null, { disabled: true }],
  ['pressed', null, { 'aria-pressed': true }],
  ['open', null, { 'aria-expanded': true }],
  ['current', null, { 'aria-current': 'page' }],
]

function ButtonMatrix({ variants }: { variants: readonly (typeof VARIANTS)[number][] }) {
  return (
    <div className="grid gap-x-1 gap-y-1" style={{ gridTemplateColumns: '88px repeat(8, minmax(0, 1fr))' }}>
      <div />
      {BTN_STATES.map(([name]) => (
        <div key={name} className="font-mono text-[9px] text-muted-foreground/80">{name}</div>
      ))}
      {variants.map((variant) =>
        SIZES.map(([size, sizeLabel]) => (
          <React.Fragment key={`${variant}-${size}`}>
            <div className="flex items-center font-mono text-[9px] text-muted-foreground/80">{variant} {sizeLabel}</div>
            {BTN_STATES.map(([name, f, extra]) => (
              <div key={name} className="flex items-center">
                <Button variant={variant} size={size} {...force(f ?? undefined)} {...extra} aria-label={`${variant} ${size} ${name}`}>
                  {size.startsWith('icon') ? <Bell /> : <><Bell />Label</>}
                </Button>
              </div>
            ))}
          </React.Fragment>
        )),
      )}
    </div>
  )
}

function ExtraSizes() {
  const rows: Array<[string, React.ComponentProps<typeof Button>['size'], boolean]> = [
    ['ghost xs (24)', 'xs', false],
    ['ghost icon-xs (24)', 'icon-xs', true],
  ]
  return (
    <div className="grid gap-x-1 gap-y-1" style={{ gridTemplateColumns: '88px repeat(8, minmax(0, 1fr))' }}>
      {rows.map(([label, size, icon]) => (
        <React.Fragment key={label}>
          <div className="flex items-center font-mono text-[9px] leading-3 text-muted-foreground/80">{label}</div>
          {BTN_STATES.map(([name, f, extra]) => (
            <div key={name} className="flex items-center">
              <Button variant="ghost" size={size} {...force(f ?? undefined)} {...extra} aria-label={`${label} ${name}`}>
                {icon ? <Bell /> : <><Bell />Label</>}
              </Button>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

// ---------------------------------------------------------- Sidebar rows ----

function SBRow({ label, f, active, open, disabled, kbd, action }: {
  label: string
  f?: Force
  active?: boolean
  open?: boolean
  disabled?: boolean
  kbd?: boolean
  action?: boolean
}) {
  return (
    <Cell label={label}>
      <SidebarMenu className="w-[200px]">
        <SidebarMenuItem {...force(f === 'hover' ? 'hover' : undefined)}>
          <SidebarMenuButton
            isActive={active}
            aria-disabled={disabled || undefined}
            {...force(f)}
            {...(open ? { 'data-popup-open': '' } : {})}
          >
            <MessagesSquare />
            <span>Chats</span>
          </SidebarMenuButton>
          {kbd && <SidebarMenuKbd>⌘K</SidebarMenuKbd>}
          {action && (
            <SidebarMenuAction aria-label="More">
              <Plus />
            </SidebarMenuAction>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </Cell>
  )
}

function SidebarRows() {
  return (
    <OnFrame>
      <SidebarProvider className="h-auto min-h-0 bg-transparent">
        <div className="grid grid-cols-3 gap-x-3 gap-y-2">
          <SBRow label="rest" />
          <SBRow label="hover" f="hover" />
          <SBRow label="active (isActive)" active />
          <SBRow label="active + hover" active f="hover" />
          <SBRow label="open (data-popup-open)" open />
          <SBRow label="focus-visible" f="focus-visible" />
          <SBRow label="active + focus-visible" active f="focus-visible" />
          <SBRow label="placeholder (aria-disabled)" disabled />
          <SBRow label="hover + kbd" f="hover" kbd />
        </div>
      </SidebarProvider>
    </OnFrame>
  )
}

// ----------------------------------------------------------- List rows -----

function ListRows() {
  return (
    <OnFrame>
      <ListCard>
      <ListGroup icon={<Folder />} label="Group band" count={4}>
        <ListRow media={<Folder />} title="rest" end="Oct 1" />
        <ListRow media={<Folder />} title="hover" end="Oct 1" {...force('hover')} />
        <ListRow media={<Folder />} title="active (aria-current=page)" end="Oct 1" active />
        <ListRow media={<Folder />} title="focus-visible" end="Oct 1" {...force('focus-visible')} />
      </ListGroup>
      </ListCard>
    </OnFrame>
  )
}

// ------------------------------------------------------------ Menus --------

function MenuDemo() {
  const [value, setValue] = React.useState('b')
  return (
    <div className="flex min-h-[330px] flex-col gap-3">
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger render={<Button variant="outline" size="compact" className="w-56 justify-between">Dropdown menu<ChevronDown data-icon="inline-end" /></Button>} />
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Label</DropdownMenuLabel>
            <DropdownMenuItem>Item rest</DropdownMenuItem>
            <DropdownMenuItem {...force('focus')}>Item highlighted (focus)</DropdownMenuItem>
            <DropdownMenuItem disabled>Item disabled</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Checkbox checked</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={false}>Checkbox unchecked</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked {...force('focus')}>Checked + highlighted</DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
            <DropdownMenuRadioItem value="a">Radio a</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Radio b (selected)</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive"><Trash2 />Destructive</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" {...force('focus')}><Trash2 />Destructive highlighted</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SelectDemo() {
  return (
    <div className="flex min-h-[170px] flex-col gap-2">
      <Select open defaultValue="b" modal={false}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option a</SelectItem>
          <SelectItem value="b">Option b (selected)</SelectItem>
          <SelectItem value="c" {...force('focus')}>Option c highlighted (focus)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Replica of the legacy renderer popover rows (slash-command-menu, label-menu, settings-menu-select, compact selectors). */
function LegacyPopoverRows() {
  const item = 'flex h-7 w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-sm'
  return (
    <div className="flex w-56 flex-col gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-modal-small">
      <div className={item}>rest</div>
      <div className={cn(item, 'hover:bg-foreground/5')} {...force('hover')}>hover (foreground/5)</div>
      <div className={cn(item, 'bg-foreground/5')}>selected (foreground/5)<Check className="size-3.5" /></div>
      <div className={cn(item, 'bg-foreground/7')}>selected (foreground/7, session-status-menu)</div>
    </div>
  )
}

function CommandDemo() {
  return (
    <Command value="Selected item" className="dark h-auto w-56 rounded-lg p-1 ring-1 ring-foreground/10">
      <CommandList>
        <CommandGroup>
          <CommandItem value="Rest item">Rest item</CommandItem>
          <CommandItem value="Selected item">Selected item (cmdk)</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

// -------------------------------------------------- Tabs, toggles, segments --

function Segmented() {
  const [tab, setTab] = React.useState('a')
  const [seg, setSeg] = React.useState('a')
  return (
    <div className="flex flex-col gap-3">
      <Cell label="Tabs on a page 32px, in a card, dialog or popover compact 28px: active | rest | hover | focus-visible">
        <div className="flex flex-col gap-2">
          {(['default', 'compact'] as const).map((size) => (
            <Tabs key={size} size={size} value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="a">Active</TabsTrigger>
                <TabsTrigger value="b">Rest</TabsTrigger>
                <TabsTrigger value="c" {...force('hover')}>Hover</TabsTrigger>
                <TabsTrigger value="d" {...force('focus-visible')}>Focus</TabsTrigger>
              </TabsList>
            </Tabs>
          ))}
        </div>
      </Cell>
      <Cell label="Toggle: rest | hover | pressed | pressed+hover | focus-visible | disabled">
        <div className="flex gap-1">
          <Toggle aria-label="t1"><Bell /></Toggle>
          <Toggle aria-label="t2" {...force('hover')}><Bell /></Toggle>
          <Toggle aria-label="t3" pressed><Bell /></Toggle>
          <Toggle aria-label="t4" pressed {...force('hover')}><Bell /></Toggle>
          <Toggle aria-label="t5" {...force('focus-visible')}><Bell /></Toggle>
          <Toggle aria-label="t6" disabled><Bell /></Toggle>
        </div>
      </Cell>
      <Cell label="ToggleGroup default / outline (first on, second hover)">
        <div className="flex flex-col gap-1">
          <ToggleGroup defaultValue={['a']}>
            <ToggleGroupItem value="a">On</ToggleGroupItem>
            <ToggleGroupItem value="b" {...force('hover')}>Hover</ToggleGroupItem>
            <ToggleGroupItem value="c">Off</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup variant="outline" defaultValue={['a']}>
            <ToggleGroupItem value="a">On</ToggleGroupItem>
            <ToggleGroupItem value="b" {...force('hover')}>Hover</ToggleGroupItem>
            <ToggleGroupItem value="c">Off</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </Cell>
      <Cell label="SettingsSegmentedControl (selected = aria-checked, rest = ghost)">
        <SettingsSegmentedControl value={seg} onValueChange={setSeg} options={[{ value: 'a', label: 'Light' }, { value: 'b', label: 'Dark' }, { value: 'c', label: 'System' }]} />
      </Cell>
    </div>
  )
}

// ----------------------------------------------------------- Settings ------

function SettingsStates() {
  return (
    <div className="flex flex-col gap-3">
      <Cell label="SettingsRow (button): rest | hover (muted/70)" className="w-full">
        <div className="card-surface w-full overflow-hidden rounded-xl bg-card">
          <SettingsRow label="Row rest" onClick={() => {}} />
          <div className="h-px bg-[var(--card-divider)]" />
          <ForceIn f="hover"><SettingsRow label="Row hover" onClick={() => {}} /></ForceIn>
        </div>
      </Cell>
    </div>
  )
}

// ------------------------------------------------------------ Chips --------

function Chips() {
  return (
    <OnCard className="flex flex-col gap-3">
      <Cell label="Mode chip (replica, active-option-badges.tsx:497): h-30, shadow-tinted, NO hover / focus / open style">
        <div className="flex gap-2">
          <button type="button" className="flex h-[30px] items-center gap-1.5 rounded-md bg-foreground/5 pr-2 pl-2.5 text-xs font-medium text-foreground/60 shadow-tinted outline-none select-none" style={{ '--shadow-color': 'var(--foreground-rgb)' } as React.CSSProperties}>
            <Search className="size-3.5" />Explore<ChevronDown className="size-3.5 opacity-60" />
          </button>
          <button type="button" {...force('hover')} className="flex h-[30px] items-center gap-1.5 rounded-md bg-info/10 pr-2 pl-2.5 text-xs font-medium text-info shadow-tinted outline-none select-none" style={{ '--shadow-color': 'var(--info-rgb)' } as React.CSSProperties}>
            <Search className="size-3.5" />Ask (hover: no change)<ChevronDown className="size-3.5 opacity-60" />
          </button>
        </div>
      </Cell>
      <Cell label="MetadataBadge (Todo / label chips): rest | hover | open(isActive) | focus-visible">
        <div className="flex gap-2">
          <MetadataBadge label="Todo" badgeColor="var(--status-doing)" showChevron icon={<Bell className="size-3.5" />} />
          <MetadataBadge label="Todo" badgeColor="var(--status-doing)" showChevron icon={<Bell className="size-3.5" />} {...force('hover')} />
          <MetadataBadge label="Todo" badgeColor="var(--status-doing)" open showChevron icon={<Bell className="size-3.5" />} />
          <MetadataBadge label="Todo" badgeColor="var(--status-doing)" showChevron icon={<Bell className="size-3.5" />} {...force('focus-visible')} />
        </div>
      </Cell>
      <Cell label="Info chip (replica, active-option-badges.tsx:419): h-30 shadow-minimal; rest | hover | open (data-state)">
        <div className="flex gap-2">
          {([[], ['hover'], ['open']] as const).map(([s], i) => (
            <button
              key={i}
              type="button"
              {...force(s === 'hover' ? 'hover' : undefined)}
              {...(s === 'open' ? { 'data-state': 'open' } : {})}
              className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)] pr-[14px] pl-[12px] text-xs font-medium text-foreground/80 shadow-minimal outline-none transition-colors select-none hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
            >
              <Info className="size-3.5 shrink-0" />Info
            </button>
          ))}
        </div>
      </Cell>
      <Cell label="Real design-system buttons used as chips: outline 28 | secondary 28 | ghost 28 (rest)">
        <div className="flex gap-2">
          <Button variant="outline" size="compact"><Bell />Chip</Button>
          <Button variant="secondary" size="compact"><Bell />Chip</Button>
          <Button variant="ghost" size="compact"><Bell />Chip</Button>
        </div>
      </Cell>
    </OnCard>
  )
}

// -------------------------------------------------- Badges, form controls ---

function BadgesAndForms() {
  return (
    <div className="flex flex-col gap-3">
      <Cell label="Badge variants (rest) | secondary as link hover">
        <div className="flex flex-wrap gap-1">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="destructive">destructive</Badge>
          <Badge variant="secondary" render={<a href="#states" {...force('hover')} />}>link hover</Badge>
          <Badge variant="outline" render={<a href="#states" {...force('hover')} />}>outline link hover</Badge>
        </div>
      </Cell>
      <Cell label="Select trigger 32: rest | hover | focus-visible | open | disabled">
        <div className="flex gap-2">
          {([[], ['hover'], ['focus-visible'], ['open'], ['disabled']] as const).map(([s], i) => (
            <Select key={i} defaultValue="a" disabled={s === 'disabled'}>
              <SelectTrigger className="w-24" {...force(s === 'hover' || s === 'focus-visible' ? s : undefined)} {...(s === 'open' ? { 'aria-expanded': true } : {})}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent><SelectItem value="a">Option</SelectItem></SelectContent>
            </Select>
          ))}
        </div>
      </Cell>
      <Cell label="Input 32: rest | focus-visible | disabled | invalid  (no hover state)">
        <div className="flex gap-2">
          <Input className="w-24" defaultValue="Rest" />
          <Input className="w-24" defaultValue="Focus" {...force('focus')} />
          <Input className="w-24" defaultValue="Disabled" disabled />
          <Input className="w-24" defaultValue="Invalid" aria-invalid />
        </div>
      </Cell>
      <Cell label="Switch | Checkbox | focus-visible">
        <div className="flex items-center gap-3">
          <Switch defaultChecked /><Switch /><Switch {...force('focus-visible')} />
          <Checkbox defaultChecked /><Checkbox /><Checkbox {...force('focus-visible')} />
        </div>
      </Cell>
    </div>
  )
}

function FloatingNavStates() {
  return (
    <OnFrame className="flex gap-6">
      <Cell label="FloatingNav (outline 32): rest | disabled (Next)">
        <FloatingNav
          back={{ label: 'Back', onClick: () => {} }}
          previous={{ label: 'Previous', onClick: () => {} }}
          next={{ label: 'Next', onClick: () => {}, disabled: true }}
        />
      </Cell>
      <Cell label="FloatingNavButtons (ghost icon 28)">
        <FloatingNavButtons
          back={{ label: 'Back', onClick: () => {} }}
          previous={{ label: 'Previous', onClick: () => {} }}
          next={{ label: 'Next', onClick: () => {}, disabled: true }}
        />
      </Cell>
    </OnFrame>
  )
}

// ------------------------------------------------------------------ Page ---

function Panel({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <div
      data-states-panel={mode}
      className={cn(mode === 'dark' && 'dark', 'flex min-w-0 flex-col gap-6 bg-background p-5 text-foreground')}
    >
      <h2 className="text-lg font-medium">{mode}</h2>
      <Section title="Buttons on a card" note="grid: variant x size (rows) by state (columns)">
        <OnCard><ButtonMatrix variants={VARIANTS} /></OnCard>
      </Section>
      <Section title="Buttons on the frame (ghost, secondary, outline)">
        <OnFrame><ButtonMatrix variants={['secondary', 'outline', 'ghost']} /></OnFrame>
      </Section>
      <Section title="Small sizes in the primitive (24 xs)">
        <OnCard><ExtraSizes /></OnCard>
      </Section>
      <Section title="Sidebar rows (SidebarMenuButton, on the frame)">
        <SidebarRows />
      </Section>
      <Section title="List rows (ListGroup / ListRow, in the ListCard)">
        <ListRows />
      </Section>
      <Section title="Floating navigation (on the frame)">
        <FloatingNavStates />
      </Section>
      <Section title="Tabs, toggles, segmented controls (on a card)">
        <OnCard><Segmented /></OnCard>
      </Section>
      <Section title="Settings (rows, radio) on the frame">
        <OnFrame><SettingsStates /></OnFrame>
      </Section>
      <Section title="Composer chips (on the composer card)">
        <Chips />
      </Section>
      <Section title="Badges and form controls (on a card)">
        <OnCard><BadgesAndForms /></OnCard>
      </Section>
      <Section title="Menus: dropdown (open, always dark), select, cmdk, legacy popover rows">
        <OnCard>
          <div className="grid grid-cols-2 gap-4">
            <MenuDemo />
            <div className="flex flex-col gap-3">
              <SelectDemo />
              <Cell label="cmdk item (Command palette / combobox)"><CommandDemo /></Cell>
              <Cell label="Legacy renderer popover rows (replica)"><LegacyPopoverRows /></Cell>
            </div>
          </div>
        </OnCard>
      </Section>
    </div>
  )
}

export function StatesPage() {
  return (
    <div data-states-root className="grid min-w-[1700px] grid-cols-2">
      <Panel mode="light" />
      <Panel mode="dark" />
    </div>
  )
}

export const statesComponents: ComponentEntry[] = [
  {
    id: 'states',
    name: 'States audit',
    category: 'Shell',
    description: 'Every interactive element in every state, light and dark side by side (audit page).',
    component: StatesPage,
    props: [],
    layout: 'top',
    previewOverflow: 'auto',
  },
]
