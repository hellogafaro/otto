---
version: alpha
name: Otto
description: >-
  Quiet, neutral workspace UI for people and AI agents. Vanilla shadcn
  (preset b1VlItvM, base-luma, Lucide icons) with one blue accent, a golden
  type and spacing scale, 32px controls and strictly nested radii. Light
  values are the defaults; "-dark" tokens are the dark theme. Floating
  surfaces (menus, tooltips, hover cards) are dark in both themes.
colors:
  background: "oklch(1 0 0)"
  background-dark: "oklch(0.17 0 0)"
  foreground: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  frame: "oklch(0.96 0 0)"
  frame-dark: "oklch(0.12 0 0)"
  card: "oklch(1 0 0)"
  card-dark: "oklch(0.22 0 0)"
  popover-dark: "oklch(0.22 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-dark: "oklch(0.27 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  muted-foreground-dark: "oklch(0.708 0 0)"
  primary: "oklch(0.588 0.158 241.966)"
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
  key:
    fontFamily: Inter Variable
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1rem
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
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
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
  frame:
    backgroundColor: "{colors.frame}"
  frame-dark:
    backgroundColor: "{colors.frame-dark}"
  page-column:
    width: 768px
  page-centerpiece:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  sidebar:
    backgroundColor: "{colors.frame}"
    width: 256px
  sidebar-icons:
    width: 48px
  page-header-row:
    height: 52px
  sidecar:
    width: 296px
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
  button-icon:
    rounded: "{rounded.md}"
    size: 32px
  button-compact:
    rounded: "{rounded.sm}"
    height: 28px
    padding: 8px
  button-xs:
    rounded: "{rounded.sm}"
    size: 24px
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
    rounded: "{rounded.sm}"
    height: 28px
    padding: 4px
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
    rounded: "{rounded.xs}"
    size: 24px
  list-row:
    typography: "{typography.body-medium}"
    rounded: "{rounded.md}"
    height: 36px
  settings-row:
    typography: "{typography.body-medium}"
    padding: 16px
  nested-control:
    rounded: "{rounded.sm}"
    height: 28px
  timeline-dot:
    backgroundColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    size: 8px
  menu:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: 4px
  menu-item:
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 28px
    padding: 4px
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
    typography: "{typography.key}"
    rounded: "{rounded.xs}"
    height: 20px
  input-invalid:
    textColor: "{colors.destructive}"
  avatar:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.xs}"
    size: 20px
  avatar-message:
    rounded: "{rounded.sm}"
    size: 28px
  icon-tile:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: 32px
  tag:
    textColor: "{colors.primary}"
    typography: "{typography.body-medium}"
  badge:
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    height: 24px
    padding: 8px
  attachment:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
  empty-state:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.heading}"
  ask-otto:
    backgroundColor: "{colors.card}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    height: 40px
    width: 450px
    padding: 4px
  scroll-button:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    height: 32px
  question-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: 12px
  question-choice:
    rounded: "{rounded.md}"
    height: 40px
    padding: 12px
  gallery-tile:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
  cover:
    rounded: "{rounded.md}"
  file-viewer:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
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
  orchestrator agent, in the floating chat: "New …" rows prefill the start
  of a sentence ("I spent ") instead of opening forms. Sending starts a chat
  about what is open; it is never a comment. Instant human actions
  stay one click: delete, copy, pick a file, change a property.
- **Domain words.** The UI names things as the product does: task, project,
  document, file, schedule, chat. Never resource, library, artifact,
  asset or automation (the data model is still called Resource). Prompts
  and placeholders use these words so Otto gets the same meaning the person
  sees.
- **Vanilla shadcn.** Preset `b1VlItvM` (base-luma, Lucide icons). Luma's
  pill radii (the 2xl to 4xl steps) are replaced in each component by the
  tokens below (buttons and inputs `md`, nested ones `sm`, menus `lg`, cards
  `xl`); its spacing, solid inputs and slider stay. When
  something must look different everywhere, change the `packages/ui`
  component and mark it with an `// Otto:` comment. Instance classes are for
  layout only.
- **Measured.** Spacing, alignment and radii follow the rules below to the
  pixel and are checked in the browser with measurements.

## Colors

The UI is neutral; color carries meaning, never decoration. Use theme tokens
(`bg-primary`, `text-muted-foreground`, `text-status-doing`), never raw values.

- **Primary** (Tailwind `sky-600`, `oklch(0.588 0.158 241.966)`, in both
  modes, with white text and white icons) marks
  the single main action of a surface (the composer's send and mic button) and
  tags (`@` mentions). It is never a navigation or selection state. White on it
  is about 4.1:1: fine for UI components and the medium-weight 13px labels,
  below AA (4.5:1) for body-size text.
- **Muted foreground** is the resting color of ghost buttons, sidebar rows,
  section titles and secondary text. **Foreground** is hover, open, pressed,
  current and content.
- **Destructive** red is only for destructive menu items (Delete, Log out).
- **Status** colors follow the task lifecycle and appear only on status icons:
  todo grey, doing purple, review yellow, done green. Lists, menus and number
  keys use that order: Todo → In progress → In review → Done.
- Floating surfaces render dark in both themes (`dark` class) at 70% opacity
  with a blur. Highlighted items use `foreground/10`; dividers `foreground/5`.

**Layers, lowest to highest.** Each layer is one small step in lightness from
the one under it, the same direction in both themes (higher is lighter in dark;
in light the frame is the grey one and everything on it is white), and a layer
the same color as its parent is separated by a 1px `foreground/10` hairline,
never a heavy shadow. L is OKLCH lightness, measured from the rendered page.

| Layer | Token and classes | Light L | Dark L |
| --- | --- | --- | --- |
| 0 Frame: `html`/`body` and the sidebar | `--sidebar` (`bg-sidebar`) | 0.96 | 0.12 |
| 1 Fill on the frame: sidebar row hover (60%) and open row | `--sidebar-accent` + `ring-foreground/10` when open | 1.0 | 0.22 |
| 2 Surface on the frame: `PageCard`, `PageCenterpiece`, the composer card, the sidecar when it is a card or overlays | `--card` + `ring-1 ring-foreground/10 shadow-xs` | 1.0 | 0.22 |
| 2 Raised control on a surface (`shadow-minimal`) | `--card` + `ring-foreground/10` | 1.0 | 0.22 |
| 3 Input and nested control well | `--input` at 50% (`bg-input/50`) | 0.96 | 0.29 on a card |
| 3 Hover and open row fill | `--muted`, `--secondary`, `foreground/5` (hover), `foreground/7-10` (open) | 0.95-0.97 | 0.24-0.27 |
| 4 Floating: menu, popover, tooltip, toast | `--popover` at 70%, `dark` class, `shadow-md` | about 0.45 over white | about 0.21 over the page |
| 5 Dialog | 50% black overlay, then the floating surface | | |

There is no page layer: the page IS the frame (layer 0), and a surface sits on it
directly. Rules that keep it true: a surface is `bg-card` (raised buttons and
badges too; popup menus use `bg-popover`), never `bg-background`; a surface never
contains another surface (siblings on the frame only; see Page anatomy); hover fills are 5% and open fills 7-10% of `foreground`, not
2-3%; the Craft `shadow-minimal` ring is the same 10% hairline as `ring-foreground/10`.

## Typography

Inter for everything; Geist Mono only for code. Sizes are theme tokens on a
golden scale from a 13px base. Each step is √φ (1.272), so every second step is
φ: body 13 → heading 16.5 → title 21 (→ 26.8 → 34 reserved). The smallest step
is fixed at 12px; 10.2px read too small.

| Token | Tailwind | Size (desktop) | Use |
| --- | --- | --- | --- |
| key | `text-[0.6875rem]` | 11px / 16px | Keys (`Kbd`) and the questionnaire's number keys |
| caption | `text-xs` | 12px / 16px | Badges, tooltips, times, day dividers, small metadata |
| body | `text-sm` | 13px / 20px | All UI text: buttons, rows, menus, comments, body |
| heading | `text-base` | 16.5px / 24px | Page section titles (`PageSection`), section headings (Activity), empty-state titles, editor H1 |
| title | `text-lg` | 21px / 28px | Page titles |

- The page ladder is golden: page title T = 21 (13 x φ); a section title is T / √φ
  = 16.5 (the heading step, weight 500); body 13 (T / φ); caption 12. T / φ
  alone is 13, the body size, so a section title built on it cannot read as a
  title: it takes the next step up instead. A section's description under its
  title stays body-size muted.
- Sizes are in rem and derive from `text-sm`, which is 14px below 768px, so the
  whole scale steps up on small screens and follows the browser's font size.
- Line heights stay on the 4px grid, so text never moves rows or spacing.
- Inputs are at least 16px on phones (iOS zooms below that).
- Weight 500 for titles, names and section labels; 400 elsewhere.
- Dates are date only: "Oct 1" in lists, "Oct 1, 2026" in detail. Numbers use
  `tabular-nums`.
- Copy: sentence case everywhere, prompts and prefills included, never all
  lowercase; no ellipses in placeholders; main calls to action read "New …";
  agents are never labeled "(agent)".

## Layout

Spacing is a 4px grid on a golden scale: 4 · 8 · 12 · 20 · 32 · 52.

- **The shell** is `[Sidebar][PageFrame]`. There is no top bar, no rail, no
  panels and no page-wide card. The frame (`bg-sidebar`) is the lowest and
  darkest layer: the sidebar sits directly on it and so does the main region
  (`PageFrame`), the same color, with no card, divider, ring or seam between them.
  What a page puts on the frame is **surfaces** (`PageCard`, `PageCenterpiece`,
  `bg-card`, hairline ring, `shadow-xs`, `xl` 12 corners), as siblings. Lower is
  darker (values under Colors).
- **The page frame** (`PageFrame`, the main region) lays out three tracks, a
  header row and a body (numbers are px at 1x):
  - **The column** is ONE width for every page (chat, lists, settings, empty
    states): **768px** (`48rem`), centered in the free space right of the sidebar.
    Narrower than 768 + 2 x 20 it fills the width with 20px on each side. Cards,
    the header row, headings and a centerpiece all span exactly the column and
    nothing is ever wider.
  - **The header row** is 52px, on the frame, above the column, 8px from the top
    of the window (so its title sits at y 18-50), and as wide as the column:
    its left edge and right edge are the cards' edges, while its content (back
    button, title, actions) is inset 16px (`PAGE_INSET`, the padding of a row in a
    card) so it lines up with the cards' content. It is pinned (it does not
    scroll away). The body starts at y 60 and ends 8px above the window.
  - **The gutters** are the free space left and right of the column; they hold
    the floating navigation (left) and the sidecar (right) and do not scroll:
    only the column's body scrolls (a blocks page as a whole, a centerpiece in
    itself). Frame width is the region right of the sidebar (window - 256, or
    - 48 icons only, or the whole window on a phone).
  - **Collapse rules.** Closed sidecar: both gutters equal, column centered. Open
    sidecar: its 324px (20px gap, 296px, 8px from the window) is reserved in the
    right track; while the gutter already is wider the column stays centered,
    else it shifts left (the column keeps 768px from a 1280px frame up). Under
    1280px of frame width the sidecar overlays the page instead. The floating
    navigation needs a left gutter of 56px; narrower it moves into the header row.
- **Insets.** Controls sit **4px** inside their bar or card, so their corners
  nest (32px control `md` 8 + 4 = card `xl` 12). Content text sits 12–20px in.
- **Controls are 32px**: bar buttons and tabs. Task list and
  command palette rows are 36px. Sidebar rows (2px apart, their group titles too), dropdown, combobox and suggestion
  items, dense bars (filter groups, composer pickers) and controls nested in
  a row (settings) use 28px with 6px corners, the `compact` button; the
  smallest buttons are 24px (`xs`), like a sidebar row's actions, 2px inside
  it.
- **Tabs** (`TabBar`, one pattern everywhere: a project's sections, the
  command palette's categories): 32px buttons 4px apart, the open one filled
  (secondary), the rest ghost, an optional icon and a count right after the
  label.
- **Buttons** pad 8px on both sides, icon or text (6px at `xs`). Icon or
  avatar to label is 8px everywhere. Buttons in a bar sit 4px apart.
- **Even insets in rows.** What leads or ends a row (avatar, icon, key,
  check) sits in a 20px slot as far from the side as from the top: 4px in
  28px sidebar, menu, combobox and suggestion rows. A bare 14px icon gets 3px
  each side of the slot, so it is 7px from every edge. Labels after a slot
  share one column (32px in), and a
  combobox's search icon and text sit on the items' columns.
- **Sidebar** (`Sidebar`, design system). ONE width for every section and
  page: 256px expanded (also the sheet below 768px), 48px as icons only. It
  never changes with the page: no section sets `--sidebar-width`, and 256px is
  the width at which both the Chats list and the Settings pages fit. It is
  expanded from 1024px up and icons only below; below 768px it is a sheet
  opened by the menu button in the page header. There is no toggle button,
  cookie or shortcut: the window decides. No resizing. Inside, 8px from the
  window's edges and from the card, top to bottom, the header and four
  groups. They are **16px apart** (box to box, no divider lines, no titles on
  the header, group 1, group 2 or the footer), so the hierarchy reads from the
  space alone: header, Inbox and Search, the pages, the page's own content,
  the footer. Groups 1, 2 and the footer never scroll; group 3 does, inside
  itself. Icons only the groups are 8px apart and a 16px-wide hairline
  (`bg-foreground/10`) centered in each gap marks them (`SidebarGroup`, the
  header's bottom and the footer's top carry it); group 3 is hidden.
  - **Header** (group 0): the Otto mark alone, 20px (`size-5`, `text-foreground`), no
    name. On Electron the header is the window's drag region,
    its row clears the macOS traffic lights (68px in; icons only, the row sits
    below them) and Back / Forward end it as two 28px ghost icon buttons with
    their keys in the tooltip (history back and forward, see Navigation). The
    web app has neither: the browser has its own.
  - **Group 1, Inbox and Search**, only these two (Search opens the Chats
    search; its `Kbd` in the tooltip).
  - **Group 2, the pages**, in this order: Tasks, Projects, Chats, Schedules,
    Documents, Files. Both groups are small arrays in `app-sidebar.tsx`
    (`inboxSearch`, `pages`: id, icon, label, optional
    handler). A row with no route yet (Inbox, Tasks, Files) is a placeholder,
    shown not linked: no handler, no pointer, no tab stop (`aria-disabled`),
    no open state, and still fully readable (not dimmed); the layout is final.
    There is no New chat row: New chat is the page header's button and ⌘N. Rows are 28px with
    `sm` 6 corners, 14px icons in a 20px slot, muted at rest, foreground on
    hover; hover is `--sidebar-accent` at 60%, the open area is `--sidebar-accent`
    with the hairline ring. Schedules (automations) has its own row; Skills and
    Sources live under Settings, and opening one keeps Settings filled.
  - **Group 3, the page's own content** (`SidebarSection`), the only dynamic
    group: it takes the height that is left and scrolls inside itself (with
    the edge fade when its content is taller, e.g. an empty state on a short
    window). It starts with a 28px title row in 12px muted text, the page's
    name, with the page's own actions at its end (the Chats filter menu, a +
    to add), then its content on the same 28px, 2px-apart rhythm and the
    same left edge as groups 1 and 2. Chats: the status and label filters
    (collapsed to "All Sessions" and "Labels" until opened; the title is
    "Filters") above the session list, which is the list moved out of its old
    panel. Both are `SidebarMenuButton` rows: a nested level (statuses, labels)
    is indented by one icon slot (20px) with no guide line and the count is
    muted at the end. A session row is 28px and one line: its status icon in the
    slot (a checkbox while several are selected), the title (bright when
    unread), then only what needs a look (a spinner while it runs, an unread
    dot, a plan, a pending prompt, the project's color as a 6px dot), the time
    and, on hover or focus, a 24px More button over the time. A session with
    labels has them on a second 40px row, a dot and the name. The open session
    is filled like an open page, with no accent bar or stripe. The list's group
    labels (a day, a status) are 28px rows in 12px muted text on the same left
    edge as the title row; a collapsible one shows its chevron on hover and its
    count when closed. The search field is a 28px, 6px nested control on the
    rows' edges. Settings: the settings pages, titled "Settings". Sources and
    Skills (reached from Settings): their list, titled with the page's name.
    A section that is not built yet (Projects, Schedules, Documents) has no
    group at all: no title, list or +, no empty gap, the free space sits above
    the footer. Hidden when icons only.
  - **Footer** (group 4), pinned at the bottom: Settings, then the workspace row: a 32px `md` avatar in a 40px
    `xl` row (8 + 4 = 12, nested), the name and an up-down chevron. It opens the
    profile menu (`ProfileMenu`, 224px, the stock dark menu) upward, or to the
    right when icons only, where only the avatar shows, with the name in a
    tooltip; in the sheet it is the same row and menu. In order: a label with
    the workspace's name; **Workspace**, a submenu (Users icon) that is a radio
    list of the workspaces (avatar, cloud state, unread dot, a check on the
    active one, a trash on hover for the others) ending after a separator in
    "Add Workspace…"; **Settings** with its `Kbd` (the same as the Settings row
    above, which stays); **Appearance**, a submenu (Contrast icon) with a radio
    group Light, Dark, System (Sun, Moon, Monitor), the Settings → Appearance
    mode, applied at once; a separator; and **Log out** (destructive, LogOut
    icon). Log out is on the web app only: it posts to `/api/auth/logout`, which
    clears the session cookie, then opens `/login` (a failure toasts "Could not
    log out"). Electron has no web session, so the item and its separator are
    absent there. One click, no confirmation.
- **The page header** (`PageHeaderRow`, drawn by `PageHeader`): the 52px row
  above the column, on the frame (never inside a surface). Leading slot (the menu
  button below 768px, Back on a drill-down page), the page title (`PageTitle`,
  21px medium), a quiet crumb trail, and the page's actions at the right end,
  all 28px controls on the column's edges. Pages call `PageHeader` and pass no
  handlers (see Navigation); it portals its row into the frame's header slot, so
  it can sit anywhere in the page. On Electron the whole top band is a drag
  region and the controls opt out.
- **The sidecar** (`Sidecar`, undecided: canvas by default, `surface` wraps it in
  a card for testing), closed by default, is for an inspector or details (session
  info, files, a source's details). Docked in the right gutter it is a **canvas**:
  no background, ring, shadow or corners, 296px wide, 20px from the column, level
  with the header row; its title is the first subtitle (13px medium, Close a ghost
  28px icon at its end) and the blocks under it are quiet: small muted subtitles
  outside any surface, 13px text, flat rows, chips and avatars, bordered controls
  at most, never panels. Taller than the window it scrolls itself with the edge
  fade. With `surface` the same content is a card (`bg-card`, hairline ring,
  `shadow-xs`, 12px corners, 16px padding, as tall as the column). Under 1280px
  of frame width it overlays the page, and an overlay always has a surface
  (`bg-card`, ring, `shadow-md`, no backdrop; below 768px it spans the width):
  the one place the sidecar is a card without the flag, because it floats over
  content. Opening and closing is 200ms of slide and fade, none with reduced
  motion. Escape closes it while focus is inside, and it closes when the page
  changes. Pages open it through `useSidecar().openSidecar({ title, content })`.
- **New chat** is on Chats only: a ghost icon button (`SquarePen`, 28px) last
  in the page header's actions at every width, tooltip below with the label and
  its `Kbd`; ⌘N (`app.newChat`, bound by the shell, not the sidebar) does the
  same. There is no floating "+".
- **Floating navigation** (`FloatingNav`): Superhuman's controls, in the left
  gutter beside the column, level with the top of the body and 8px from the
  column: a round 32px Back button and a vertical pill of Previous (up) and Next
  (down), `bg-card`, hairline ring, `shadow-sm`, 14px icons, a tooltip each. Round
  on purpose: they float free of rows and bars. They stay put while the center
  scrolls. Shown on a page opened from a list (a chat) while the left gutter is
  at least 56px wide; narrower, Back moves into the header's leading slot and
  Previous / Next into its actions as 28px ghost buttons.
- **Widths**: the column is 768px for every page, the sidebar 256px on every
  page (48px as icons), the sidecar 296px. A centerpiece is never wider than the
  column.
- **One left line.** Cards and a centerpiece start on the column's left edge and
  end on its right; the page title, section titles (and their actions) and the
  text inside a card all sit 16px in (`PAGE_INSET`, one constant in `PageFrame`
  that the header row and `PageSection` share; a centerpiece's transcript or
  document 20px).
- **Page**: see Page anatomy.
- **Galleries** (`Gallery`): 3 columns for projects, 4 for documents and
  files; 12px between columns, 20px between rows so a title stays with its
  tile.

## Page anatomy

Final and extremely simple, as the settings pages are: **no wrapping surface:
the frame, then cards.** A page is the header row and, under it, surfaces. Surfaces
are siblings on the frame; a surface never contains another surface (no card in a
card, no panel in a panel, no wrapper, divider or border around a section).
Inside a surface: rows split by full-bleed hairlines, text, and nested controls
(28px / 6 and 32px / 8 buttons, inputs, badges). A code block, quote, table or
attachment chip inside a message or card is content: flat, a muted fill, no ring,
no shadow.

- **Every page** is the `PageHeader` title row (on the frame, above the column; see
  Layout) and ONE 768px column under it. Two kinds of page, by what the content is:
  long-form content read or written top to bottom is a **centerpiece**;
  collections of facts and settings are **blocks**.
- **Blocks** (`PageColumn`: settings, projects, lists, overviews, empty states):
  stacked sections 32px apart, the page scrolling as a whole in the column (edge
  fade, no scrollbar; the header row stays). A section (`PageSection`) is a
  title (heading step 16.5px, medium, outside its card, inset 16px like the
  card's content) with an optional one-line muted body-size description and
  optional actions at the right end of that row, also on the inset ("View all",
  "Create"), 12px above its `PageCard` (`bg-card`, hairline ring, `shadow-xs`,
  `xl` 12). Stat strips and rows in a card are split by hairlines. A section
  starts 28px under the header row and the last one ends 32px above the window's
  bottom. `SettingsSection` and `SettingsCard` are `PageSection` and `PageCard`; the
  settings pages are the reference implementation.
- **Centerpiece** (`PageCenterpiece`: the chat, a document): ONE card as wide as
  the column and as tall as the space under the header row (8px above the
  window's bottom), clipped, scrolling inside it with the edge fade. Never wider
  than the column. A toolbar is part of the header row, not a nested card.
  The chat adds a sibling card under it, 8px away: the composer (`bg-card`,
  hairline ring, `shadow-sm`, `xl` 12, auto height, pinned at the bottom of the
  column) whose top row holds the session chips (mode, status, labels, Info) and
  whose body is the input; the composer is not inside the centerpiece. Messages
  are flat: assistant text sits straight on the surface (no bubble, ring or
  shadow), the user message is a muted fill, code blocks are flat muted blocks.
- **Unbuilt sections** (Projects, Schedules, Documents) show only the empty state
  and its "New …" button until the page is designed: no header row (below 768px
  the menu button alone, so the sidebar sheet stays reachable), no list, cards or
  sidebar group 3. The state is the stock `Empty` (`SectionEmpty`) centered both
  ways on the frame, not in a card: the section's Lucide icon in the 32px tile
  (the usual 20px glyph), a heading-size title ("No projects"), one description
  sentence and one primary 32px button ("New project"), which has no action yet
  (enabled, no toast). The list and detail pages behind them are not routed.
- **Radii**, one table (inner = outer - gap):

| Surface | Radius | Inside it |
| --- | --- | --- |
| Card, centerpiece, composer, sidecar as card (`xl`) | 12 | Rows full-bleed, no radius; 28px controls |
| Row in a card, nested control | 28px, `sm` 6 | 24px action, `xs` 4 |
| Button | 32px, `md` 8 | 14px icon |
| Sidebar row | 28px, `sm` 6 | 24px action, `xs` 4 |
| Workspace row | 40px, `xl` 12 | 32px avatar, `md` 8 |
| Floating navigation, only | round | 14px icon |

## Navigation

One history stack, one rule for Back, one place the lists live.

- **History** is the navigation context's own (the URL; every view change
  pushes an entry). Back and Forward mean history back and forward everywhere:
  on Electron the two icon buttons in the sidebar header and their keys
  (⌘[ / ⌘] and ⌘← / ⌘→), on the web the browser's own buttons. The web app
  draws none.
- **Back in the page header** is a different thing and is shown ONLY on a
  drill-down view (a view with a parent), where it goes to the parent view by the
  route hierarchy (`useParentView`): a settings page below the landing page goes
  to Settings; a document goes to the Documents library; an item of a list (a
  chat, a source, a skill, a project, a schedule) goes to its list. The list
  lives in the sidebar, so below 768px (a sheet) Back opens the sheet on it;
  otherwise it closes the item and leaves the list. Without a parent there is
  no Back. Pages never pass handlers: `PageHeader` reads the route.
- **Crumbs** are the quiet trail after the title: the parent's name as a link
  to it (Settings, Sources, …). Next step: the trail starts with the Otto mark
  (home, the default area) and the workspace name (it opens the workspace menu).
- **Compact (below 768px)**: the leading slot is the sidebar sheet's menu
  button. On a drill-down view Back replaces it: Back from a list item opens the
  sheet on the list, so the sidebar stays one tap away; Back from a settings
  page or a document goes to its parent, which has the menu button.
- **Previous / Next** step through the list the page was opened from, as the
  sidebar shows it (Chats: filtered, grouped and sorted there): the context
  exposes `listNav` (`hasPrev`, `hasNext`, `goPrev`, `goNext`) from the session
  list's published order, and both are disabled at the ends. They show as the
  floating navigation. No keys are bound yet (none exist), so no `Kbd` shows.
  Quick actions in the Superhuman manner (next chat, next task, go back) are the
  next layer on this API.
- Existing navigation APIs: `navigate(route, { skipAutoSelect })`,
  `navigateToSession`, `navigateToSource`, `goBack` / `goForward`,
  `canGoBack` / `canGoForward`, `listNav`, `useNavigationState()`,
  `useParentView()`. There is one open route (`currentRouteAtom`); several
  panels side by side are gone, and so are open in a new panel, new chat in a
  panel and focus next / previous panel.

## Shell primitives

All in `design/ui` (`// Otto:` comments mark what differs from stock shadcn) and
shown together in the playground under Shell (resize the window: the sidebar and
the frame follow it; variants show both page types and the sidecar as canvas and
as a card).

| Primitive | API | Spec |
| --- | --- | --- |
| `SidebarProvider` / `Sidebar` | | one width, 256px on every page (also the sheet below 768px), 48px as icons; a row with `aria-disabled` is a placeholder (no pointer, readable); no toggle, cookie or shortcut; absolute inside the shell; 8px container padding is the gutter; no border or ring |
| `SidebarHeader`, `SidebarContent`, `SidebarFooter` | | header 8px above, 16px below; footer 16px above; content does not scroll, its groups do, and spaces them 16px apart (8px and a hairline icons only) |
| `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupAction` | | no padding of its own; 28px title row, 12px medium muted; the action is a 24px ghost button, `xs` 4 corners, 2px inside the row |
| `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` | `isActive`, `size="default" \| "lg"`, `tooltip` (text, or `{ children, hidden }` for a label and `Kbd`) | 28px row, `sm` 6, 14px icon in a 20px slot; hover `sidebar-accent` 60%; active `sidebar-accent` + hairline ring + `shadow-xs`; `lg` is 40px, `xl` 12, for a 32px avatar; icons only: 32px square, label and trailing icons hidden, plain tooltips show |
| `SidebarMenuAction` | | 24px, `xs` 4, 2px inside the row; shown on row hover or focus (always on touch) |
| `SidebarTrigger` | | the page header's menu button below 768px; 28px ghost |
| `PageFrame` | `aside` | the main region on the frame: header slot, 768px column (`@container/panel`), left and right gutters; see Layout |
| `PageHeaderRow` | `leading`, `title`, `crumbs`, `actions` | 52px, 28px controls, title is `PageTitle` (21px medium), on the column's edges |
| `PageCrumbs`, `PageScroll` | `crumbs: { label, onClick }[]` | muted 13px trail divided by a slash; scroll region with edge fade, no scrollbar |
| `PageColumn`, `PageSection`, `PageCard` | `title`, `description`, `action`, `danger` | blocks page; see Page anatomy |
| `PageCenterpiece` | `className` | the one big card of a long-form page; column width, fills the height |
| `Sidecar` | `open`, `onOpenChange`, `title`, `actions`, `closeLabel`, `surface` | canvas by default, `surface` wraps it in a card (undecided); see Layout; closed by default |
| `FloatingNav`, `FloatingNavButtons` | `back`, `previous`, `next`: `{ label, onClick, disabled, tooltip }` | see Layout; needs a 56px left gutter |

In the renderer: `PageHeader` (the header with the route's Back, crumbs and list
navigation wired), `AppSidebar`, `SidebarSection`, `useParentView`, `useSidecar` (and `SidecarHost`, the
`aside` of the shell's frame).

## Elevation & Depth

Depth comes from translucency and hairlines, not heavy shadows.

- **Frame**: the darkest layer, flat: the sidebar and the main region are the
  same color, nothing wraps the page. **Surfaces** (`PageCard`,
  `PageCenterpiece`, the composer, comments, question cards): card background,
  a `ring-foreground/10` hairline and `shadow-xs` (the composer `shadow-sm`),
  siblings on the frame, never one inside another. The sidecar is the exception
  that proves it: flat on the frame when docked, a card with `shadow-md` only
  when it overlays content.
- **Scrolling** areas fade at the edge where more content waits (shadcn
  `scroll-fade-*`): under the page header and off the bottom, the floating chat
  above the fade. The fade is the only sign: no scrollbar (`no-scrollbar`)
  on pages, panels, the file viewer and the floating chat's list, so the
  column never shifts when a page starts to scroll. The chat thread keeps the
  stock message scroller's thin one.
- **Floating surfaces** (dropdowns, combobox, popover, hover card, tooltip,
  editor menus): dark, `bg-popover/70`, `backdrop-blur-2xl` and saturation,
  `ring-foreground/10`, `shadow-md`, no entry animation.
- A floating surface opens 4px from its trigger and never covers it.
- **Dialogs** (the command palette) sit over a plain 50% black overlay, no
  blur. The file viewer is a full-screen dialog (`fullScreen`) on the page
  background.
- **The floating chat** floats on the command palette's glass (dark,
  translucent, blurred, hairline ring, `shadow-md`) on a layer above the
  scrolling page, never inside it (the page's fade mask, and the morph's
  named elements, would stop the blur), with nothing behind it: content
  scrolls on under the frost, keeping 88px free at its end. Only the bar
  takes clicks; no overlay, so the page stays usable while you chat.

## Shapes

Radius tokens: `xs` 4 · `sm` 6 · `md` 8 · `lg` 10 · `xl` 12 · `full`.
**Rule: inner radius = outer radius − the gap between them.** Never repeat the
container's radius inside it. `xl` is 12 because 32px controls sit 4px inside
cards and have an 8px radius.

| Container | Inside | Gap | Inner radius |
| --- | --- | --- | --- |
| Card, centerpiece, composer (`xl` 12) | 32px buttons, rows | 4px | `md` 8 |
| Sidebar row, 28px (`sm` 6) | 24px row action | 2px | `xs` 4 |
| Menu, combobox, popover, hover card (`lg` 10) | Items, search field | 4px | `sm` 6 |
| Command palette (`xl` 12) | Rows | 4px | `md` 8 |
| Tooltip (`sm` 6) | Key | 4px | `xs` 4 |

- Buttons are never fully round: 32px `md` 8, 28px and 24px `sm` 6, except
  where a 24px button sits 2px inside a 28px row (a sidebar row action): `xs`
  4, to nest.
- Keys are `xs` 4: a soft corner, short of a pill. Elements only a few pixels
  inside their container (attachment thumbnails and remove button) use `xs`.
- A tooltip is `sm` because it holds a label, not nested items.
- Gallery tiles, covers, attachments and media in the file viewer are `md` 8.
- Avatars are rounded squares at about a quarter of their side: 20px `xs`,
  28px `sm`, 32px `md`, 40px `lg`. Badges stay pills.
- Bars and inputs are never fully round: the floating chat keeps the composer's `xl`.

## Components

**Buttons.** Ghost for nearly everything, muted at rest; foreground on hover,
while its menu is open, pressed or current. Active navigation is the
`secondary` button. `default` (primary) only for a surface's main action.
Icon buttons are 32px with 14px icons.

**Icons and avatars.** Lucide icons at **14px** everywhere (the old Remix names below map to their Lucide twins). Fixed icons: project
`RiBox3Line`, repeat `RiLoopRightLine`, agent `RiRobot3Line`, time
`RiTimeLine`, row remove `RiCloseLine`, add `RiAddLine`, files
`RiFolder3Line`. **Avatars are at least 20px** (`ActorAvatar`): people show
initials, agents their pixel mascot in their name color, nobody a person
outline. Lists mixing avatars and
icons give icons a 20px slot so labels align. Brand logos follow the same
rule: 14px, drawn to fill the same live area as a Lucide glyph (20 of 24, see
`assets/provider-icons`), never a bigger size to make a logo look equal. The one
exception is a row with two lines of text (label and description): its icon
sits in a 32px tile, see Row icons.

**Logo** (`Logo`). The six-blade mark, drawn with `currentColor`, so it is
dark in light mode and light in dark mode with `text-foreground` (or
`text-background` on an inverted surface). It is never the primary or any
brand color. It has no size of its own: use `size-4`, `size-5`, `size-6`,
`size-8` or `size-10` (16, 20, 24, 32, 40px; the mark sits centered and
letterboxed in the square), or `h-N w-auto` to fill a height. It is
decorative (`aria-hidden`) unless given a `title`. Sources live in
`design/brand/` and `bun scripts/generate-brand-assets.ts` rebuilds every
raster from them. The colored glass app icon (`otto-app-icon.svg`) is the
only colored version: it is the dock, window, installer, home-screen and
web-manifest icon, full-bleed with no extra rounding or shadow, and, as a 40px
tile (see Sign-in header), the head of the sign-in and onboarding
screens. In-app chrome uses the black mark, never the colored icon. The tab icon
(`favicon.svg`) is the mark, black in light and white in dark; its `favicon.ico`
fallback is the same mark in neutral gray (`#8a8a8e`) on transparent, so it
reads on any tab strip. The page's `theme-color` is the frame: `#f2f2f2` in
light, `#060606` in dark.

**Keys** (`Kbd`). 20px (16px in tooltips), 11px text, `xs` corners.

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
border. "/" and "@" suggestion lists use the same 28px rows.
Page shortcuts pause while a modal dialog or sheet is open, including when its
buttons have focus; the modal keeps its own keyboard controls.

**Details** (inside the sidecar). Collapsible sections with stock
spacing and no dividers. Muted section titles with an optional count, hidden
when there is nothing (no "0"). Counts everywhere sit right after their label,
softer than it (`Count`), the label's icon-to-label gap away. Property rows open
their menu; each has a hotkey. A "New …" row ends a list. Row actions appear on
hover (always on touch), and hovering one keeps its row highlighted. Repeat
stores an iCalendar rule: presets plus Custom, which asks Otto.

**Composer** (`Composer`). The one input for comments, chats and agent
requests. Card surface; one line that grows to 240px. **+** adds files (drop
and paste too), shown as `Attachment`s with upload state. The main button
dictates when empty, sends with content and stops while `busy`. A `tools` slot
after + holds pickers (model, agent). Enter sends, Shift+Enter adds a line.
`@` opens a grouped palette (people, agents, tasks, projects, files). Otto is
not in it: Otto is reached through the floating chat, not tagged.

**Tags** (`MentionChip`). Everywhere (composer, messages, comments): the type
icon and label in primary on a soft primary tint (10%, 15% dark) with `xs`
corners, stored as `@[label](type:id)`. Tag text on its tint is 3.5:1 in light
(4.4:1 dark), a known tradeoff of the sky tone: medium weight, 13px.

**Dictation.** While listening the composer row shows ×, the level as 4px
bars 2px apart, the elapsed time and Done. The bars start flat (a row of 4px
dots) and rise only with the mic level; the speech range (up to ~6 kHz) spans
the width, mirrored from the center. Done stops the recording; the main
button shows a spinner ("Transcribing") while the server transcribes it, then
the text is typed in at the cursor. A failure is a toast ("Unable to transcribe", no retry action) and
the recording is dropped; Cancel drops it too.

**Floating chat** (`FloatingChat`). On every page but Chats (and in the file
viewer): one row at the bottom, kept one line tall so it never covers the
page, floating 16px above the bottom: the compact composer as a 40px, 450px
bar (the 728px column ÷ φ), "Ask Otto about this task / page": +, the text,
Chats (a red dot while any need you) as a ghost button before the main
button, shown only while the bar is empty. Bar and window wear the command
palette's surface: dark, translucent (popover at 70%), blurred. Attachments
in the bar and the window are 28px chips: a 20px thumbnail, the name cut in
the middle, and remove (in the embedded composer, 4px corners and a 2px
thumbnail corner, to nest). Sending starts a chat with Otto in the page's
project (fixed), the first message led by an inline link to the item, and the
bar grows into a window up over the page. The window is a 12px card on the
bar's surface (no change as it grows), the column plus 4px a side, fitting
its content up to 30rem, with the panel's insets: a 40px top bar (32px
buttons 4px in, the title 16px in), messages and the composer's text on the
same 16px line, the embedded composer (`Composer embedded`) 4px in with 8px
corners, 28px buttons 6px in with 6px corners (the 28px buttons' radius), one
step lighter. The title switches chats: a search grouped like the Chats
sidebar (Pinned, Waiting, Working, Snoozed, Done; no archived), one thing at
each row's end (status, else time; the open chat shows the check). Then Chats
(the list of chats waiting on your input or ready for your review, as 28px
rows like the sidebar's, with no composer; a row opens that chat), New chat (who it's with: Otto
unless picked), Minimize, Open as a page and Close. Minimized, the bar reads
"Reply to Otto" and shows the chat's status and title, which reopens it; the
chat follows you from page to page. Escape minimizes. The agent sees the page
you are on. Page actions (log time, a custom repeat) prefill it. The same
chats as in Chats.

**Morph.** Folding, growing and switching between a chat and Chats morph
(View Transitions, 320ms ease-out, off with reduced motion;
`floating-chat.css`): the window grows from the bar's box, widening evenly
and rising; the composer morphs with its bottom edge pinned (its old and new
boxes share it), its corners settling from 12px to 8px. Each part clips its
snapshots, which keep their size, so nothing stretches, and blurs what is
behind it, so its translucent snapshot looks like the real surface at every
frame: no flash at either end. Old snapshots leave quickly where both sides
have content, so nothing shows twice.

**Activity.** A timeline (`Timeline`), like Shopify's: one straight
hairline down the left, under the cards' avatars. Cards (comments, a
schedule's runs, the comment composer at the end) sit over it at full width,
so it shows only between them; events are muted single lines on an 8px dot,
their text lined up with the cards' names. Comment cards have Copy and Reply
in the top-right corner on the card insets. Replies stay flat: Reply tags the
author. Comment attachments open in the file viewer.

**Inbox** is home ("/"), like Notion's Home: your day under a centered
greeting ("Good afternoon, Johan", the page title's size and spacing), in
one section per kind: an h2 with its count, like Activity's, then rows the
same as on their own pages, their icons lined up with the heading. Tasks:
what you own or are assigned, still open, review first. Notifications:
mentions, assignments, review requests and shares today ("Forge mentioned
you in …", read ones muted). Chats: waiting on you (a question, a review, a
failed run, with what it wants) or unread. Schedules: today's runs, done
("Ran 9:00") or still to come ("Today 18:00"). Empty sections don't show;
with nothing at all, it reads "Nothing needs you".

**Chats.** One chat model for every kind: a project's one general chat
(#name), group chats (any members, with or without a project) and direct
chats with a person or an agent; several chats with the same person or agent
are fine. A chat may belong to a project and then works in its context.

- **Sidebar**: Pinned, Waiting, Working, Snoozed and Done, collapsible, each
  with its count. Rows are one line at normal weight (bright when unread or
  waiting on you), the whole title running under the right slot instead of
  truncating. Icons: # for a general chat, the group icon for group chats,
  the avatar for direct chats. The slot is solid in the row's color, fading
  in from the left, and holds one thing: the status (yellow circle waiting
  on you, red warning when a run failed, purple part-filled circle while an
  agent works, draft, green check when done) or else the time since the last
  message; on hover, keyboard focus or an open menu only Pin, Archive and
  More. Hovering a title shows a card: the title, what it is, then a divider,
  the members and when it was last active. No status in the card.
- **New chat** (`+`, /chats/new): a generic empty state, With (one or several
  people and agents) and Project as 28px text-only pickers 8px above the
  composer, on its text edge. Sending creates the chat and stays disabled until
  someone is chosen under With (yourself counts); no project is a valid choice.
- **Sub-threads**: an agent's session opened from a chat is a child chat, one
  level only, kept out of the sidebar. The parent shows it inline as a card
  (agents, title, status, chevron) that opens it; its top bar leads back to
  the parent.

One chat:

- **Messages** follow one pattern for everyone, like Slack, all on the left:
  a 28px avatar (its top 2px above the name's capitals), the name and time on
  one line, then each message as plain text (shadcn `Message` with ghost
  `Bubble`s), keeping line breaks. Consecutive messages from one sender within
  five minutes form a turn. Copy shows on hover at the end of the name line.
- **Names** carry an assigned color each (six hues tuned per theme, never the
  primary blue); yours reads "You" in the plain text color.
- **Rhythm**: 20px between turns and around day dividers. Turns keep 2px above
  and 4px below inside their paint-contained items.
- **Day dividers**: the stock shadcn separator `Marker` (Today, Yesterday,
  then the weekday and date), its 12px label soft like the lines, with a 1px
  highlight below.
- **Agent runs**: "Worked for 52s" folds the run's steps (a `Marker` as the
  collapsible trigger); a failed run reads "Failed after 2m 41s" in red. While
  an agent works, one shimmering line opens on its real status, then fades
  through playful lines, with the real status every third turn. No spinner.
- **Files** in messages are attachment chips that open the file viewer, which
  steps through everything shared in the chat.
- **Questions** from agents: a compact card (stock small `Card` at 12px): the
  question, then the choices as one bordered list of 40px rows split by
  hairlines (number keys pick), then Send on the right. Answered, it keeps the
  question and the picked row.
- **Scroll to end**: a 28px outline button with its label, on the card color
  with `shadow-md`, 8px above the composer, shown once you scroll up.
- **Panel**: Project (a link for general chats and sub-threads, else a
  picker), Members (people, then agents; Add member) and Files shared in the
  chat, hidden until something is shared. A project's panel lists its chats.

**Schedules.** Automations: on a time pattern, run a prompt (an agent you
pick answers it) or code, and post the result to a chat: an existing one, or
a new chat each run (a setting; nothing is made until it runs). No project
row: less is more. Made and changed by asking an agent: + starts the floating
chat with "Every ", and the prompt (or code, as a code block) shows
read-only: that body is what tells them apart, so the panel has no type
row. A person sets the state (Active or Paused), the agent (prompts
only), Repeat (the tasks' dropdown, each preset with its time; Custom asks),
and Chat, where it posts ("A new chat each run", then the chats; channels show their #
icon, never a # in the name), and can Run now (then a toast). Its page
follows the task's: owner and agent under the title, then Activity: created
and each change as events, each run as a card like a comment (who ran
it, when, Ran or Failed on the right, then what it said). The list is Tasks'
pattern (`ListGroup`): Active, Paused, then Archived folded; rows show the
owner's and agent's avatars, like a task's people, and the next run
("Tomorrow 9:00"); filters by type, agent and owner; right-click opens the
item menu. The next run ends the Activity timeline on a hollow dot, not a
panel row: panel rows are controls, never read-only text. Picking a state
on an archived schedule restores it.
Schedules archive, never delete.

**Settings** (from the profile menu), as lean as the MVP allows: a left
panel like Chats', Account (Profile, Notifications, Models, Connections,
Agents) then Workspace (General, Members). The theme stays in the profile
menu; usage and activity wait for a Reports page. Each section is a page
titled with its name: optional h2 sections (Activity's size), each a 12px
card of rows split by hairlines. One row pattern: what it is and a line on
it on the left, one control on the right; rows listing things (agents,
members, connections) lead with their avatar or icon. Controls nested in a
row are 28px with 6px corners: a switch, a choice (an outline `compact`
button opening a radio menu, as Appearance in the profile menu), a text
field, or a `compact` button. Everything saves as you go, no Save button: a
change waits 800ms for the next (`useDebounced`), blur or leaving saves at
once, and a value flipped back sends nothing. Every save shows the
"Settings saved" toast, one at a time: saves close together refresh it.
Deleting sits last under "Danger zone" and asks first. Adding an agent, a
connection or a member asks Otto.

**Models** (Settings › Models). Two lists by who can use the account:
"Your connections" (only you) and "Workspace connections" (everyone in the
workspace), each a card whose first row says "1 connection" / "No
connections" with a ghost + that opens the providers (Codex). No filters, no
priority order, no fallback and no "runs out" setting: an agent names its one
account and model. A connection row leads with its provider icon, then the
name, one line of state ("Connected", "Sign-in needed", "Disabled", plus
"Added by <name>" when it is someone else's), a "Reconnect needed" badge while
signed out, a ghost ⋯ menu (Reconnect or Enable, Share with workspace or Make
private, Disable, then a red Disconnect, all asked first) and a chevron that
opens its name, sign-in and models. Adding one signs in at once, in its open
row. Disconnect removes the stored sign-in for good and takes the row off the
page; the record stays only as history for sessions and runs pinned to it.

**Agents** (Settings › Agents). Each agent shows its pixel mascot (BB's ten
8x8 sprites, MIT, from MonoCode) in its name color wherever its avatar
appears. The list opens each agent's own page (its row a link with a
chevron); "+" asks Otto to create one. An agent's page, in the settings
patterns: Profile (name, description, the mascot and color pickers as 28px
buttons, the chosen one filled, and who can use it), Instructions (the card
is the field), Model, then Skills and Connections as checklists ("Can use 3
of 8 skills.", All first, the whole row toggles). Everything saves as you go
("Agent saved"). More holds Copy link and Delete; Otto, the default agent,
has none.

**Empty states and 404.** `EmptyPage` is only for when a place has nothing at
all (no tasks, not "no matches"). It replaces the whole page, title and
actions included, with the stock `Empty` centered both ways: a 32px muted tile
holding a 20px icon (32 / φ), a heading-size title, one line of description
and one 32px primary button ("New task", "New project", "New schedule"…).
Every main section starts this way, with the floating chat there as on any
page: the button starts the sentence in it ("Add a task to ", "Every "),
never a form; a person's own action (Upload file) sits beside it. Missing pages and records use `NotFound`
(the same, with "Go home").

**No results.** When filters match nothing, the page, its header and the
filter bar stay; the list area shows the same `Empty` shape: the filter icon
tile, "No results", one line, and an outline "Clear filters".

**Filters** (`FilterMenu`, `FilterBar`, `NoResults`; one shared set). The
header's Filter button opens a menu with a submenu per property (Tasks:
owner, assignee, project, priority; Documents: created by, project,
label, visibility; Files: type, project, label, made by); each starts with "Any" (the property's icon, muted) and lists
options with their icons or avatars. Filters
live in the URL and are never saved. While any is set, a filter bar sits under
the title: one read-only 28px `ButtonGroup` per filter (the property and value
as text, then ×) and an outline 28px Clear on the right. Changing or adding
filters happens only in the menu.

**Command palette** (`CommandPaletteProvider`). One palette for the whole app:
⌘K / Ctrl+K anywhere, or a page's search button with its category already
selected. 720px wide, 15% from the top, card radius. A borderless 48px search
field over a full-width divider; the shared 32px tabs for categories (Tab
switches) 8px above and below; 36px rows that match
names containing the query, with edges that fade while more results scroll;
a 48px footer with key hints. Categories: All, Tasks, People, Projects,
Documents, Files, Actions. Picking a result goes there (a file opens
in the viewer). Text and icons sit
16px in throughout.

**Task list.** Groups by status in lifecycle order under full-width
`secondary` header buttons. Each row: its status icon (under the header's),
the title, then an avatar group of everyone involved (owner first, then
assignees; one tooltip lists them), with the project badge and date on the
right. 20px avatars in a group overlap 4px.

**Detail pages** (`DetailView`). Tasks, projects and documents share one shape:
the top bar, then the page (optional cover, title, people row, body), the
right panel and the floating chat.

- **Task:** owner and assignee as avatar buttons (no labels; hover names the
  role and its key); the description (markdown editor with `/` blocks);
  Activity; the comment composer.
- **Project:** cover, owner and members; 32px tabs with icons and muted counts
  (Overview, Tasks, Documents, Files), kept in the URL (`?tab=`). Overview
  is the description; Tasks is the task list without the project badge;
  Documents and Files are galleries. Empty tabs show the `Empty` shape
  without an action. Panel: Properties (Status, Priority) and its Chat.
- **Document:** cover when it has an image, the author as plain text (set by
  the server), the content in the editor. Panel: Project (or none) and
  Visibility (Only me / Workspace).

**Dithered images** (`Dither`, `Cover`). Covers and previews are drawn once in
the image's own colors with an 8×8 ordered dither in four steps, never
animated. Each dot is a whole number of device pixels (3 on 2x screens, 2 on
1x), so dots stay square and even at any size. `Cover` is a 4:1 banner above a
page title.

**Galleries** (`Gallery`, `GalleryItem`). Not cards: a tile with its icon and
title under it; the ring darkens on hover. Projects are 16:9 covers;
documents are 4:5 pages showing their image or opening text fading out;
files are 4:5 showing their picture or their type ("PDF").

**File viewer** (`Lightbox`). Full screen on the page background, in two
full-height columns. The file: its 40px top bar (type icon, title, "Image ·
Oct 3"; Ask about this file, Open task, Download), then the file centered
with `md` corners and the ring, 48px from the sides where the previous and
next arrows sit 9px in (← → too, except inside a player). On wide screens a
280px details panel with its own top bar (Details, then Close in the
corner, like the panel toggle): one Properties list in Otto's words
(folder, project, task, chat, created by, visibility, added; project, task
and chat link to them, rows it lacks are left out), then Labels. No composer inside: Ask closes the viewer and starts the page's
floating chat with a link to the file. Read-only previews: images, video and
audio in the browser's players, PDFs in its viewer, Markdown rendered like a
document, canvases (an agent's HTML page) sandboxed as they are; anything
else shows its type. The open file is in the URL (`?open=`) on the Files
page.

**Right-click menus** (`ContextMenu`, stock shadcn styled like the
dropdown: 28px rows, even insets). Wherever an item has actions: chat rows,
task rows, and document, project, file and folder tiles. A right-click menu
and the item's More menu share one list (`ItemMenuItems`; chats'
`ChatMenuItems`), short and in one order: Open, Ask about it (the page's
floating chat), Download, Rename, Copy link; then Archive and Delete apart.
Chats: Pin, Mark as done, Snooze, Copy link; then Archive. Projects
archive, never delete.

**Menu keys and Delete.** Quick actions show their key as a `Kbd` on the
right, and the key runs them while the menu is open (ahead of typeahead):
Rename R, Copy link C, Pin P, Mark as done E, Archive A, Delete ⌫ (Backspace
or Delete); options with number keys pick by them too. Delete is always the
destructive variant: red text and icon, a red-tinted highlight.

**Alert dialog** (`AlertDialog`, stock shadcn, small; `useConfirm()`). The one
place an action asks first: Delete, always. shadcn's destructive example as
is: the bin on a red-tinted tile, then copy as plain as a toast's: a short
question naming what it is, not which ("Delete file?", "Delete account?"),
and one line ("This can't be undone."); Cancel and the action, red when it
destroys. The work runs inside it: the action keeps its label and gains a
spinner (shadcn's button spinner) while both buttons wait, then the dialog
closes and the toast says it is done ("“Fix plan” deleted"); a failure stays
open and says "Something went wrong. Try again.". A plain darker overlay, no
blur, like the dialog's.

**Toasts** (stock shadcn `Toaster`, Sonner's own `toast.success()`, re-exported
from `@workspace/ui/components/sonner`). One plain row and nothing else: the
status icon in its color (a green check for done), a short sentence-case
message ("Link copied", "“Fix plan” deleted"; always one sentence with no period,
which the shared `toast` enforces), and Close at the end. On the
menus' surface in both themes with a card's 12px corners: Close is the 28px
ghost button 6px in (nested), the message 12px in and wrapping, so the toast
is as tall as its message (40px for one line); bottom right.
Copy link, Archive and Delete say they are done with one.

**Files.** Everything saved is a file: uploads, task and chat attachments,
and agents' outputs, canvases included (never "artifact"). Like a drive:
folders, nested to any depth, come first in the gallery as 4:5 tiles (a big
folder and how many items it holds), then the files; inside a folder the top
bar's breadcrumb (Files › Brand › Logos) is the way back up, and the page
takes the folder's name. No side panel. Filters, the shared set (type,
project, label, made by), search the open folder and everything inside it as
one flat list. + is one menu: Upload file, or New folder, named in place on
its tile (Enter makes it, Escape drops it); both land in the open folder.
Folder, filters and open file live in the URL. Folders persist through the
backend, nest at most eight levels, and archive only when completely empty.

**Live data states.** Server reads use the shared skeleton (three full-width 40px rows, no
extra padding so they align with the page title) and inline error with Retry; unavailable controls explain the missing capability and never
show success. The authentication boundary uses the stock Field/Input/Button
composition. Workspace switching clears prior workspace data and opens Inbox.
Account forms use a centered 336px column, 24px side padding and 64px vertical
padding, with the shared page-title typography and no logo. Labels stay above
their inputs; the primary submission spans the column and secondary account
actions center beneath it. Sign-in methods reflect configured backend support.
The browser sign-in page (`apps/webui/src/login.html`) is static HTML served
before the app, so it inlines the `:root` and `.dark` token values (light and dark
by `prefers-color-scheme`) instead of loading the app stylesheet. It has no card:
a left-aligned 336px column with 24px side padding, centered on the page layer
(`--background`). Its header is the one every first-run screen shares (**Sign-in
header**): the colored app icon (never the mark) as a 40px tile with `9px` corners
(22.37% of the side, the iOS icon radius, not an avatar radius) and a
`foreground/10` hairline, from `/login-assets/otto-app-icon.png` (the only path
besides `/favicon.ico` served without a session; the app bundles its own copy).
Below it, 20px apart, the title in the heading token
(`text-base`, weight 500, never the title size), then 4px below a muted
`text-sm` line, all left-aligned. The form is
placeholder-only (no label; `aria-label` keeps the name): one 32px `md` 8 field
(`bg-input/50`, no focus ring) with a nested 28px `sm` 6 ghost eye button on the
right that shows or hides the password, then the full-width 32px primary button 12px
below. A failed sign-in fills the field with `destructive/10` (`destructive/20` in
dark) and a `destructive` border (`/50` in dark), and shows the message beneath
the field in `text-xs` `destructive`, above the button.

**Onboarding and workspace screens** (`StepFormLayout`: connection setup,
Select Workspace, add workspace) use the same header and the plain page layer:
`bg-background` with `text-foreground`, no card, gradient, dither or other
ambient backdrop, in light and dark. The block is a left-aligned column of the
step's own width (28rem), centered in the window, header aligned with the
content's left edge: icon tile, 20px, title, 4px, muted description, 32px, the
content (a `SettingsCard` or form), then actions. Full-width buttons under the
content stack main action first; a secondary action such as "Setup later" stays
a full-width muted ghost button directly under the card (`mt-2`). The splash is not that tile: it shows the
foreground-colored mark debossed (inset shading, never colored), 40px wide,
centered on the page layer. The glyph is the page tinted with `foreground` at 8%
in light, 6% in dark; a soft shadow falls inside its top-left edges (black at
22% in light, 60% in dark, 0.8px blur, offset 0.8px down and right) and a 1px
highlight catches the page just outside its bottom-right edges (white at 60% in
light, where on white it only reads against the tint; 10% in dark). It is one SVG
filter on `Logo` (`DebossedLogo` in `splash-screen.tsx`), copied into the pre-load
loader of both `index.html` files so loader and splash are the same picture: the
loader fades the mark in (300ms ease-out) and the splash continues at full
opacity, then fades it out with a 1.04 scale (no scale with reduced motion). The completion step swaps the tile for a
spinner while saving. Error and success lines under the content are `text-xs`,
flush with the content's left edge (no extra padding), like the sign-in error.
A control that opens something outside the app ends with ArrowUpRight (trailing,
14px); never ExternalLink, never leading. In a menu item it sits at the right edge
(`ml-auto`).
The profile menu names the signed-in person and lists their accessible workspaces.
When direct setup or creation is necessary before an Agent can run, a compact
stock dialog may capture the backend's required fields. Ask remains available;
direct controls use the same tokens and do not simulate an Agent response.
Native selects use the shared 32px control, or 28px when nested, with the
corresponding 8px/6px corners. Task search and Inbox name one Project explicitly;
search requests five matches per group and uses whole words. Directory pickers
continue through bounded pages instead of treating the first hundred as complete.

## Do's and Don'ts

- Do change shared looks in the `packages/ui` component with an `// Otto:`
  comment; don't override colors or type on one instance.
- Do use only the spacing scale, the two insets, 32px bar controls and 28px
  rows and nested controls; don't invent values to make one screen fit.
- Do start cards on the column's edge and inset the title and section titles 16px
  to line up with the cards' content; don't wrap a
  surface in a surface or make anything wider than the column.
- Do save ordinary settings as they change, with the one "Settings saved" toast.
  Multi-field Agent and Schedule configuration uses explicit Save/Cancel with one
  captured edit token; Documents and Skill content preserve fenced drafts until Save.
- Do nest radii (inner = outer − gap); don't reuse a container's radius inside
  it.
- Do keep primary for the main action and tags; don't use it for navigation,
  selection or decoration.
- Do keep icons 14px and avatars at least 20px; don't mix icon sizes in a row.
  A row with a description puts its icon in a 32px tile with a 16px glyph.
- Do keep chat messages in one left-aligned pattern; don't right-align your
  own or bring back bubbles for some senders.
- Do keep tooltips to one label; don't put metadata in a tooltip.
- Do route creation through the floating chat; don't add a form for something a
  sentence can ask for, and don't send it as a comment.
- Do use the domain words (task, project, document, file) in copy and
  prompts; don't call a file a resource or the Files section a library.
- Do check a visible change in the browser and measure it; don't ship from a
  screenshot guess.
- Don't nest tasks or comments, add subtitles to data-heavy pages, or use
  ellipses in placeholders.

### Live mention discovery

Composer mentions query real workspace members, Agents, Projects and Files, with at most three results per kind. Task suggestions require the composer's explicit Project scope. Searches follow server whole-word matching; empty results and request failures are visible. File mentions use the File discriminator and saved identity.

Command search omits empty result groups and the redundant Task scope label. Its placeholder is “Search”; an entered query with no matches shows a compact empty state (icon tile and “No results for “query””, no period) after loading completes. Search uses the shared 800 ms debounce and stock Skeletons for a category heading and three icon/title rows, matching result spacing while waiting.

### Accounts and workspace access

Authentication uses the real account service for sign-in, registration and password reset, with acknowledged results and request errors. Registration does not grant installation or workspace authority. A person without workspace access can accept a known invitation ID. Workspace selection loads additional server pages and clears the previous workspace cache before navigation. The profile menu omits workspace selection when there is only one workspace and no further page.

### Fenced configuration and content

Agent account/model/Skill selection and Schedule configuration use explicit Save/Cancel for one atomic change protected by the opening edit token. Document content, labels, visibility and folder are one fenced draft; Skill content and supporting Files have separate acknowledged fences. Failed or stale edits retain input. Unsupported decorative fields and fabricated activity are removed; Schedule timing shows the saved cron/timezone without guessing a next-run date.

### Real workflow controls

Task details show the server lifecycle Todo/In progress/Done, mixed assignees, occurrence links and human-owned manual time in whole minutes. Unsupported priority, review status, comments and decorative metadata have no mutable controls. Files and Documents retain folder/label organization and real creator identities. Avatar names come from the workspace directory; Agents use the existing robot sprite because the API has no mascot setting. Identity color is a stable display value derived from its ID, not saved configuration. Desktop tabs start with the current route and load the real item title.

Chats show metadata update time separately from message activity. New Chats require explicit participants and scope; a configured Agent/account controls actual Run admission. Pending sends preserve the draft and uploaded File identities until acknowledgement. Failed creation with unknown outcome directs the person to inspect Chats before creating again. Pin/done/snooze/thread controls without persistence are unavailable. Settings show current server data, acknowledged autosave for profile fields, and explicit unavailable states for unsupported preferences or account/workspace changes. Connections and Codex accounts use their real setup and authorization flows, with exact scoped grants and provider-confirmed authentication.

### Files and public frozen selections

File uploads show pending, cancellation and retry of the same File/request identity; there is no simulated progress. Download uses the verified server route. Previews stay within 8 MiB, and HTML runs in a credential-free sandbox. Folder breadcrumbs and mixed lists keep Files, Documents and Folders grouped, with server sorting within kind. Sharing requires a preview of the explicit frozen selection before publishing; the anonymous share page shows only acknowledged frozen content and optional selected bytes, with revoked/unavailable and retry states. It sits outside authenticated workspace navigation.

Inbox continues its four independent server attention cursors with one More attention items control. An exhausted group keeps its final cursor while other groups continue; counts describe loaded entries.

The File share byte-selection control uses the shared Checkbox primitive, with its stock compact size and focus behavior, beside the descriptive label.

Below 768px the whole sidebar (areas, the open area's section, footer) is the shared Sheet, opened by the page header's menu button; choosing a route closes it.

Private pages remain behind the session-loading state until the previous authenticated session's requests and cache have been cleared. Current Project authority resolves independently of the displayed member page; incomplete pickers never decide who can edit.

Mention chips preserve the exact selected display label, including brackets and backslashes, through editing, sending and notification delivery.

Unknown creation outcomes disable another submission in the current form and direct the person to check saved records. A definite client refusal preserves the draft for correction. Relation writes and document content share one pending fence so an acknowledgement cannot overwrite a newly typed draft. Denied reads hide cached private content; transient read failures retain fenced drafts with Retry.

**Empty-state rules (binding for every page).**

1. Nothing exists and nothing is filtered: the header-free `EmptyPage`, with the floating chat kept. Title "No <things>" (sentence case, no period); description one sentence ending in a period, "<Things> … show up here." Exactly one 32px primary button, the "+ New <thing>" that prefills the floating bar (never a form); a person's own action (Upload file) sits beside it as a quiet outline button. Never a second primary button. The Inbox has no button ("Nothing needs you"); Projects is the one page whose button opens its form, because nothing exists yet to ask about.
2. Something is filtered and nothing matches: the page, header and active filter bar stay and the list area shows `NoResults` ("No results", "No <things> match these filters.", Clear filters).
3. There is no permanent toolbar. A page header holds the Filter menu (real properties and archive state), a Search icon that opens the command palette on that category, and "+". Active filters show as chips in the filter bar; no search box, sort picker, order or page-size control is drawn on a page. Settings lists show only their own property filters.
4. Inline empties (a folder, a project tab, chat messages, delivery history, settings rows) use the same `Empty` shape or a `Row`: title "No <things>", one description line ending in a period, no action.
5. Command palette: an entered search with no results shows a compact tile and "No results for “query”" with no period, and its category tabs are hidden when no category has results. Skeletons are stock and use the small radius.
6. Tasks list the first Project when none is chosen, so an empty page never asks for one. Chats: `/chats` opens the first chat, or the empty page with its New chat button (which opens /chats/new) when there is none.
7. The floating bar shows its Inbox button only while something needs attention (an unread chat or an unanswered question).
8. The Chats sidebar is hidden entirely while there are no chats; /chats/new fills the screen until the first one exists.
9. Chat attachments have no visibility control or explanation: whoever is in the chat reads what is attached, and loses it on leaving. The File stays private in the library.
10. A new chat has two pickers, With and Project. It is always participants-only; the project's own chat is the one open to everyone in the project.

## Craft shell

The app now runs on Otto (see `UPSTREAM.md`); these are the Otto rules
that carry over, applied where Craft draws the same thing.

- **Layers and the sidebar**: see Layout. The sidebar's lists (Chats, Settings)
  keep these row rules: 28px rows with 6px corners, a 20px icon slot, the open
  row filled; one line per row, no descriptions, no dividers.
- **Settings pages.** Sections are an h2 (`text-base`, medium) with an optional
  one-line description, then a 12px card with a hairline ring whose rows are
  split by hairlines. A row is a label and one muted line on the left and one
  control on the right, 16px sides and 12px above and below.
  Hairlines are full-bleed `divide-y divide-foreground/10` drawn by the card
  itself (never `h-px` siblings, which leave a line under a collapsed panel).
  A note under the last row is a plain row (16px sides, muted `text-xs`). A
  collapsible card's header is a `SettingsRow` with `expanded` (chevron turns
  90deg); its body is rows split by hairlines, with group titles as small
  uppercase muted labels 16px in.
- **Row icons.** The leading icon of a `SettingsRow` or `SettingsToggle` (and
  any row that lists providers, workspaces or options) is sized by the row, 12px
  before the text and centered on it, so nothing is sized per instance: Lucide
  icons and brand logos (`ProviderLogo`) alike.
  - *One line:* a bare 14px glyph in a 20px slot, as in the sidebar and menus.
  - *Two lines (label and description):* an `IconTile`, 32px square (the control
    height), `rounded-md` (8px, the card's 12px inset keeps it nested) on
    `bg-muted` (one step lifted from the `bg-card` row, no border), holding a 16px
    glyph (`size-4`, half the tile, the same as the 32px avatar's fallback).
    18px read as a size of its own and 20px (the empty-state tile) as too loud
    beside 13px text; 14px alone looked lost next to the 40px text block. Brand logos
    get the same 16px box and their live area (about 14px ink, like Lucide).
    An avatar (`data-slot="avatar"`) fills the tile instead: 32px, `md` radius. The
    row is `items-center`, so the tile and the label and description block share a
    center; rows under it with no icon of their own (topics, owners) keep a 32px
    spacer. Used by provider, workspace, connection, messaging and access rows, the
    default-source toggles, and the mobile drawers' mode, folder and workspace rows.
  - Entity rows in the left lists (sessions, sources, skills, projects) keep the
    icon inline with the title (one icon beside two lines of a compact list, not a tile); the
    chevron is 14px (`size-3.5`).
- **Root font size** stays at Craft's 15px; Craft sizes in `rem`.
