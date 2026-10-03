---
version: alpha
name: Otto
description: >-
  Quiet, neutral workspace UI for people and AI agents. Vanilla shadcn
  (preset bIkg4yR, base-vega, Remix icons) with one blue accent, a golden
  type and spacing scale, 32px controls and strictly nested radii. Light
  values are the defaults; "-dark" tokens are the dark theme. Floating
  surfaces (menus, tooltips, hover cards) are dark in both themes.
colors:
  background: "oklch(1 0 0)"
  background-dark: "oklch(0.145 0 0)"
  foreground: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.205 0 0)"
  popover-dark: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-dark: "oklch(0.269 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  muted-foreground-dark: "oklch(0.708 0 0)"
  primary: "oklch(0.546 0.245 262.881)"
  primary-dark: "oklch(0.623 0.214 259.815)"
  primary-foreground: "oklch(0.985 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
  status-todo: "oklch(0.556 0 0)"
  status-todo-dark: "oklch(0.708 0 0)"
  status-doing: "oklch(0.558 0.288 302.321)"
  status-doing-dark: "oklch(0.714 0.203 305.504)"
  status-review: "oklch(0.795 0.184 86.047)"
  status-review-dark: "oklch(0.852 0.199 91.936)"
  status-done: "oklch(0.627 0.194 149.214)"
  status-done-dark: "oklch(0.723 0.219 149.579)"
typography:
  caption:
    fontFamily: Inter Variable
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  body:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-medium:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.25rem
  heading:
    fontFamily: Inter Variable
    fontSize: 1.0335rem
    fontWeight: 500
    lineHeight: 1.5rem
  title:
    fontFamily: Inter Variable
    fontSize: 1.3146rem
    fontWeight: 500
    lineHeight: 1.75rem
  code:
    fontFamily: Geist Mono Variable
    fontSize: 0.9em
    fontWeight: 400
rounded:
  xs: 2px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 32px
  2xl: 52px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  page-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: 16px
  card-dark:
    backgroundColor: "{colors.card-dark}"
    textColor: "{colors.foreground-dark}"
  composer:
    backgroundColor: "{colors.card}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 16px
  button-ghost:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 8px
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  button-ghost-dark:
    textColor: "{colors.muted-foreground-dark}"
  button-ghost-hover-dark:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.foreground-dark}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    size: 32px
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
  button-icon:
    rounded: "{rounded.md}"
    size: 32px
  button-compact:
    rounded: "{rounded.md}"
    height: 28px
    padding: 8px
  command-palette:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.xl}"
    width: 720px
  command-palette-row:
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 8px
  sidebar-row:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 8px
  sidebar-row-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  sidebar-row-dark:
    textColor: "{colors.muted-foreground-dark}"
  sidebar-row-hover-dark:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.foreground-dark}"
  row-action:
    textColor: "{colors.muted-foreground}"
    rounded: 4px
    size: 24px
  list-row:
    typography: "{typography.body-medium}"
    rounded: "{rounded.md}"
    height: 36px
  menu:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: 4px
  menu-item:
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 8px
  menu-item-highlighted:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.foreground-dark}"
  menu-item-destructive:
    textColor: "{colors.destructive-dark}"
  hover-card:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 12px
    width: 256px
  tooltip:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: 24px
    padding: 8px
  kbd:
    backgroundColor: "{colors.muted-dark}"
    textColor: "{colors.muted-foreground-dark}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    height: 20px
  input-invalid:
    textColor: "{colors.destructive}"
  avatar:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    size: 20px
  tag:
    textColor: "{colors.primary}"
    typography: "{typography.body-medium}"
  tag-dark:
    textColor: "{colors.primary-dark}"
  badge:
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    height: 24px
    padding: 8px
  attachment:
    backgroundColor: "{colors.card}"
    rounded: 7px
  empty-state:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.heading}"
  status-icon-todo:
    textColor: "{colors.status-todo}"
    size: 14px
  status-icon-todo-dark:
    textColor: "{colors.status-todo-dark}"
  status-icon-doing:
    textColor: "{colors.status-doing}"
    size: 14px
  status-icon-doing-dark:
    textColor: "{colors.status-doing-dark}"
  status-icon-review:
    textColor: "{colors.status-review}"
    size: 14px
  status-icon-review-dark:
    textColor: "{colors.status-review-dark}"
  status-icon-done:
    textColor: "{colors.status-done}"
    size: 14px
  status-icon-done-dark:
    textColor: "{colors.status-done-dark}"
---

# Otto design

The rules behind the web UI as built. The front matter holds exact tokens; the
sections below hold the rules and reasons. Keep this file current: when a UI
decision changes, change it here in the same commit. Implementation lives in
`packages/ui` (shadcn components, `styles/globals.css`) and `apps/web`. Where
the earlier [brand guidelines draft](docs/otto/brand-guidelines.md) differs,
this file wins.

## Overview

Otto is a quiet, neutral workspace where people and AI agents do the same work
side by side. The UI stays out of the way: flat surfaces, hairline rings, one
accent, compact 32px controls.

- **Less is more.** Show state clearly and keep controls few. No subtasks, no
  nested comments, no subtitles on data-heavy pages.
- **AI-first.** Creating and editing go through a sentence to Otto, the
  orchestrator agent, in the composer: "New …" rows prefill `@Otto …` instead
  of opening forms. Instant human actions stay one click: delete, copy, pick a
  file, change a property.
- **Vanilla shadcn.** Preset `bIkg4yR` (base-vega, Remix icons). When
  something must look different everywhere, change the `packages/ui`
  component and mark it with an `// Otto:` comment. Instance classes are for
  layout only.
- **Measured.** Spacing, alignment and radii follow the rules below to the
  pixel and are checked in the browser with measurements.

## Colors

The UI is neutral; color carries meaning, never decoration. Use theme tokens
(`bg-primary`, `text-muted-foreground`, `text-status-doing`), never raw values.

- **Primary** (Tailwind `blue-600` light, `blue-500` dark, white text) marks
  the single main action of a surface (the composer's send and mic button) and
  tags (`@` mentions). It is never a navigation or selection state.
- **Muted foreground** is the resting color of ghost buttons, sidebar rows,
  section titles and secondary text. **Foreground** is hover, open, pressed,
  current and content.
- **Destructive** red is only for destructive menu items (Delete, Log out).
- **Status** colors follow the task lifecycle and appear only on status icons:
  todo grey, doing purple, review yellow, done green. Lists, menus and number
  keys use that order: Todo → In progress → In review → Done.
- Floating surfaces render dark in both themes (`dark` class) at 70% opacity
  with a blur. Highlighted items use `foreground/10`; dividers `foreground/5`.

## Typography

Inter for everything; Geist Mono only for code. Sizes are theme tokens on a
golden scale from a 13px base. Each step is √φ (1.272), so every second step is
φ: body 13 → heading 16.5 → title 21 (→ 26.8 → 34 reserved). The smallest step
is fixed at 12px; 10.2px read too small.

| Token | Tailwind | Size (desktop) | Use |
| --- | --- | --- | --- |
| caption | `text-xs` | 12px / 16px | Badges, keys, tooltips, small metadata |
| body | `text-sm` | 13px / 20px | All UI text: buttons, rows, menus, comments, body |
| heading | `text-base` | 16.5px / 24px | Section headings (Activity), empty-state titles, editor H1 |
| title | `text-lg` | 21px / 28px | Page titles |

- Sizes are in rem and derive from `text-sm`, which is 14px below 768px, so the
  whole scale steps up on small screens and follows the browser's font size.
- Line heights stay on the 4px grid, so text never moves rows or spacing.
- Inputs are at least 16px on phones (iOS zooms below that).
- Weight 500 for titles, names and section labels; 400 elsewhere.
- Dates are date only: "Oct 1" in lists, "Oct 1, 2026" in detail. Numbers use
  `tabular-nums`.
- Copy: no ellipses in placeholders; main calls to action read "New …"; agents
  are never labeled "(agent)".

## Layout

Spacing is a 4px grid on a golden scale: 4 · 8 · 12 · 20 · 32 · 52.

- **Two insets.** Visible edges (a button's background, a card's outline, an
  attachment's border) sit **9px** inside their container. Content (text,
  icons) sits **16px** inside. Buttons paint inside a 1px transparent border
  and cards draw a 1px ring outside their box; classes compensate so the
  visible result lands on these numbers.
- **Controls are 32px**: bar buttons, menu items, sidebar rows, list rows in
  menus. Rows may take two lines when a title needs it; the icon stays on the
  first line. Task list and command palette rows are 36px. Dense bars (filter
  groups, palette tabs) use the 28px `compact` / `icon-compact` button.
- **Buttons** pad 8px on both sides, icon or text (6px at `xs`). Icon or
  avatar to label is 8px everywhere. Buttons in a bar sit 4px apart.
- **Shell.** App rail on the left (`AppRail`): 8px padding around 32px
  buttons, so it is 48px wide. Then the page.
- **Top bar** (`Topbar`): the same 8px padding, 48px tall. Breadcrumb on the
  left; page actions on the right, ending with the panel toggle.
- **Page** (`Page`): a centered column, `default` (max 3xl) for reading and
  settings, `wide` (max 5xl) for lists. 20px between header and content;
  20px side padding, 52px top and bottom on desktop.
- **Right panel**: a floating `Sidebar` card directly under the top bar, 9px
  from the screen edges, 256px wide.

## Elevation & Depth

Depth comes from translucency and hairlines, not heavy shadows.

- **Page**: the background, flat.
- **Cards** (comments, composer, side panel): card background, a
  `ring-foreground/10` hairline and `shadow-xs`.
- **Floating surfaces** (dropdowns, combobox, popover, hover card, tooltip,
  editor menus): dark, `bg-popover/70`, `backdrop-blur-2xl` and saturation,
  `ring-foreground/10`, `shadow-md`, no entry animation.
- A floating surface opens 4px from its trigger and never covers it.
- **Dialogs** (the command palette) sit over a plain 50% black overlay, no
  blur.

## Shapes

Radius tokens: `xs` 2 · `sm` 6 · `md` 8 · `lg` 10 · `xl` 16 · `full`.
**Rule: inner radius = outer radius − the gap between them.** Never repeat the
container's radius inside it. `xl` is 16 because controls sit 8px inside cards
and have an 8px radius.

| Container | Inside | Gap | Inner radius |
| --- | --- | --- | --- |
| Card, composer, side panel (`xl` 16) | Buttons, rows | 8px | `md` 8 |
| Sidebar row (`md` 8) | Row action | 4px | 4px |
| Composer (`xl` 16) | Attachment | 9px | 7px |
| Menu, combobox, popover, hover card (`lg` 10) | Items, search field | 4px | `sm` 6 |
| Command palette (`xl` 16) | Rows | 8px | `md` 8 |
| Tooltip (`sm` 6) | Key | 4px | `xs` 2 |

- Elements only ~6px inside their container (keys, attachment thumbnails, the
  attachment's remove button) use `xs`, never square.
- A tooltip is `sm` because it holds a label, not nested items.
- Avatars are round (`full`).

## Components

**Buttons.** Ghost for nearly everything, muted at rest; foreground on hover,
while its menu is open, pressed or current. Active navigation is the
`secondary` button. `default` (primary) only for a surface's main action.
Icon buttons are 32px with 14px icons.

**Icons and avatars.** Remix icons at **14px** everywhere. Fixed icons: project
`RiBox3Line`, repeat `RiLoopRightLine`, agent `RiRobot3Line`, time
`RiTimeLine`, row remove `RiCloseLine`, add `RiAddLine`. **Avatars are at least
20px** (`ActorAvatar`): people show initials, agents the robot, nobody a person
outline. Lists mixing avatars and icons give icons a 20px slot so labels align.

**Badges.** Pills sized like tooltips: 24px tall, 8px on both sides, 12px
text, 14px icon with a 4px gap so it reads as one unit. Used for metadata on
list rows (the project).

**Focus.** Text fields show no ring or border change; the caret shows focus.
Buttons keep a keyboard-only focus ring. Invalid fields turn red.

**Tooltip vs hover card.** A tooltip is one label, optionally with its key
(`Kbd`), 24px tall. Anything richer (metadata, notes) is a `HoverCard` at body
size. Blocks of data inside it are split by a content-width divider (spans the
text, not the card) with 8px above and below.

**Menus.** `DropdownMenu` for short option sets: a label row with the menu's
hotkey, then options with number-key shortcuts shown as keys; the selected
option shows a check instead of its key. A searchable `Combobox` for long
lists, topped by `ComboboxSearch`: like the command palette, a search icon on
the item icon column and a transparent 36px input over a full-width bottom
border. "/" and "@" suggestion lists use the same 32px rows.

**Right panel.** Collapsible sections divided by full-width separators; muted
13px section titles with an optional count. Property rows open their menu; each
has a hotkey. A "New …" row ends a list. Row actions appear on hover (always on
touch), and hovering one keeps its row highlighted. Repeat stores an iCalendar
rule: presets plus Custom, which asks Otto.

**Top bar.** Breadcrumb as small ghost buttons with icons; the current item
shows its status icon. Right side: More (copy link, delete) and then the panel
toggle, always rightmost, labeled "Open panel" / "Close panel".

**Composer** (`Composer`). The one input for comments, chats and agent
requests. Card surface; one line that grows to 240px. **+** adds files (drop
and paste too), shown as `Attachment`s with upload state. The main button
dictates when empty, sends with content and stops while `busy`. A `tools` slot
after + holds pickers (model, agent). Enter sends, Shift+Enter adds a line.
`@` opens a grouped palette (people, agents, tasks, projects, resources); a tag
is a primary chip with its type icon, stored as `@[label](type:id)`.

**Activity.** Events are muted single lines with a 20px avatar. Comments are
cards with Copy and Reply in the top-right corner on the card insets. Replies
stay flat: Reply tags the author.

**Empty states and 404.** `EmptyPage` is only for when a place has nothing at
all (no tasks, not "no matches"). It replaces the whole page, title and
actions included, with the stock `Empty` centered both ways: a 32px muted tile
holding a 20px icon (32 / φ), a heading-size title, one line of description
and one 32px primary button ("New task", "New project", "New schedule"…).
Every main section starts this way. Missing pages and records use `NotFound`
(the same, with "Go home").

**No results.** When filters match nothing, the page, its header and the
filter bar stay; the list area shows the same `Empty` shape: the filter icon
tile, "No results", one line, and an outline "Clear filters".

**Filters.** The header's Filter button opens a menu with a submenu per
property (owner, assignee, project, priority); each starts with "Any" (the
property's icon, muted) and lists options with their icons or avatars. Filters
live in the URL and are never saved. While any is set, a filter bar sits under
the title: one read-only 28px `ButtonGroup` per filter (the property and value
as text, then ×) and an outline 28px Clear on the right. Changing or adding
filters happens only in the menu.

**Command palette** (`CommandPaletteProvider`). One palette for the whole app:
⌘K / Ctrl+K anywhere, or a page's search button with its category already
selected. 720px wide, 15% from the top, card radius. A borderless 48px search
field over a full-width divider; 28px category tabs (All, Tasks, People,
Projects, Actions; Tab switches) 8px above and below; 36px rows that match
names containing the query, with edges that fade while more results scroll;
a 48px footer with key hints. Picking a result goes there. Text and icons sit
16px in throughout.

**Task list.** Groups by status in lifecycle order under full-width
`secondary` header buttons. Each row: its status icon (under the header's),
the title, then an avatar group of everyone involved (owner first, then
assignees; one tooltip lists them), with the project badge and date on the
right. 20px avatars in a group overlap 4px.

**Task page.** Title; owner and assignee as avatar buttons (no labels; hover
names the role and its key); the description (markdown editor with `/`
blocks); Activity; the composer.

## Do's and Don'ts

- Do change shared looks in the `packages/ui` component with an `// Otto:`
  comment; don't override colors or type on one instance.
- Do use only the spacing scale, the two insets and 32px controls; don't
  invent values to make one screen fit.
- Do nest radii (inner = outer − gap); don't reuse a container's radius inside
  it.
- Do keep primary for the main action and tags; don't use it for navigation,
  selection or decoration.
- Do keep icons 14px and avatars at least 20px; don't mix icon sizes in a row.
- Do keep tooltips to one label; don't put metadata in a tooltip.
- Do route creation through Otto in the composer; don't add a form for
  something a sentence can ask for.
- Do check a visible change in the browser and measure it; don't ship from a
  screenshot guess.
- Don't nest tasks or comments, add subtitles to data-heavy pages, or use
  ellipses in placeholders.
