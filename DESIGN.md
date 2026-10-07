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
  card-dark: "oklch(0.19 0 0)"
  popover-dark: "oklch(0.22 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-dark: "oklch(0.27 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  muted-foreground-dark: "oklch(0.708 0 0)"
  fill-hover: "oklch(0.145 0 0 / 5%)"
  fill-hover-dark: "oklch(0.985 0 0 / 5%)"
  fill-selected: "oklch(0.145 0 0 / 10%)"
  fill-selected-dark: "oklch(0.985 0 0 / 10%)"
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
    padding: 12px
  button-ghost-hover:
    backgroundColor: "{colors.fill-hover}"
    textColor: "{colors.foreground}"
  button-ghost-selected:
    backgroundColor: "{colors.fill-selected}"
    textColor: "{colors.foreground}"
  button-ghost-dark:
    textColor: "{colors.muted-foreground-dark}"
  button-ghost-hover-dark:
    backgroundColor: "{colors.fill-hover-dark}"
    textColor: "{colors.foreground-dark}"
  button-ghost-selected-dark:
    backgroundColor: "{colors.fill-selected-dark}"
    textColor: "{colors.foreground-dark}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 12px
  button-icon:
    rounded: "{rounded.md}"
    size: 32px
  button-compact:
    rounded: "{rounded.sm}"
    height: 28px
    padding: 10px
  button-xs:
    rounded: "{rounded.sm}"
    height: 24px
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
    rounded: "{rounded.sm}"
    height: 28px
    padding: 8px
  sidebar-row-hover:
    backgroundColor: "{colors.fill-hover}"
    textColor: "{colors.foreground}"
  sidebar-row-selected:
    backgroundColor: "{colors.fill-selected}"
    textColor: "{colors.foreground}"
  sidebar-row-dark:
    textColor: "{colors.muted-foreground-dark}"
  sidebar-row-hover-dark:
    backgroundColor: "{colors.fill-hover-dark}"
    textColor: "{colors.foreground-dark}"
  sidebar-row-selected-dark:
    backgroundColor: "{colors.fill-selected-dark}"
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
    backgroundColor: "{colors.fill-selected-dark}"
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
    width: 448px
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
- **AI-first.** Creating and editing go through a sentence to an agent,
  in the floating chat: "New …" rows prefill the start
  of a sentence ("I spent ") instead of opening forms. Sending starts a chat
  about what is open; it is never a comment. Instant human actions
  stay one click: delete, copy, pick a file, change a property.
- **Domain words.** The UI names things as the product does: task, project,
  document, file, routine, chat; the Library is the one place for documents and
  files. Never resource, artifact, asset, schedule or automation (the data model
  is still called Resource). Prompts
  and placeholders use these words so an agent gets the same meaning the person
  sees.
- **Names.** Never name the agent in copy: write "your agents" or "an agent", or
  interpolate the name of the agent in context (the chosen one, else the default
  agent's, `AGENT_DEFAULT_NAME`, only as the fallback), because there are several
  agents. The product's name comes from `PRODUCT_NAME` (`@otto/shared/branding`),
  typed nowhere else: i18n strings use `{{product}}`, code and prompts import the
  constant, and the system prompt's identity, self-reference and co-author trailer
  take the agent's name as a parameter. Static HTML (`index.html`,
  `manifest.json`) cannot import it and keeps a literal.
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
  current and content. The focus `--ring` is `oklch(0.55 0 0)` in light and
  `oklch(0.556 0 0)` in dark: 3:1 on the white card and on the frame.
- **Destructive** red is only for destructive menu items (Delete, Log out).
- **Status** colors follow the task lifecycle and appear only on status icons:
  todo grey, doing purple, review yellow, done green. Lists, menus and number
  keys use that order: Todo → In progress → In review → Done. A chat's status
  icon follows it: the default Todo and Cancelled are grey, Needs Review amber, Done
  green (never the `accent` surface grey, which vanishes on the page); a custom
  status keeps its own color.
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
| 2 Surface on the frame: `PageCard`, `PageCenterpiece`, `Card`, the sidecar when it overlays, the empty-state tile | `--card` + `card-surface` (1px border, `shadow-xs`) | 1.0 | 0.19 |
| 2 The composer, every look (v1's full composer) | `--card` + `ring-1 ring-foreground/10`, `shadow-xs` | 1.0 | 0.19 |
| 2 Outline control (`Button outline`) | `--card` + 1px `--card-ring` border, no shadow | 1.0 | 0.19 |
| 3 Input and nested control well | `--input` at 50% (`bg-input/50`) | 0.96 | 0.27 on a card |
| State fills (hover, pressed, open, selected) | not a layer: alphas of `foreground`, 5% hover, 10% pressed / open / selected | hover / selected: 0.92 / 0.88 on the frame, 0.96 / 0.91 on a card | 0.16 / 0.20 on the frame, 0.23 / 0.27 on a card |
| 4 Floating: menu, popover, tooltip, toast | `--popover` at 70%, `dark` class, `shadow-md` | about 0.45 over white | about 0.21 over the page |
| 5 Dialog | 50% black overlay, then the floating surface | | |

There is no page layer: the page IS the frame (layer 0), and a surface sits on it
directly. Rules that keep it true: a surface is `bg-card` (raised buttons and
badges too; popup menus use `bg-popover`), never `bg-background`; a surface never
contains another surface (siblings on the frame only; see Page anatomy); state fills are alphas of `foreground`
(hover 5%, selected 10%), never a layer token (`muted`, `secondary`, `sidebar-accent`), so they read the same on the
frame, on a card and in dark.
A card's edge is `card-surface` (tokens `--card-ring`, `--card-divider`): in dark the layer step is small (0.12
to 0.19), so the border is white 14% over the frame, solid `oklch(0.281 0 0)` (it was 10%,
which vanished on the frame). There is no inner top highlight: it follows the
rounded corners and reads as a second line beside the border. In light the white
card on the 0.96 frame keeps the same weight, solid `oklch(0.87 0 0)`, and
`shadow-xs`, which read crisp without a stronger shadow.

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
| heading | `text-base` | 16.5px / 24px | Page section titles (`PageSection`), section headings (Comments), empty-state titles, editor H1 |
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
  `bg-card`, hairline border, `shadow-xs`, `xl` 12 corners), as siblings. Lower is
  darker (values under Colors).
- **The page frame** (`PageFrame`, the main region) lays out three tracks and
  the column's body (numbers are px at 1x):
  - **The column** is ONE track for every page (chat, lists, settings, empty
    states): **768px** (`48rem`), centered in the free space right of the sidebar.
    Narrower than 768 + 2 x 20 it fills the width with 20px on each side. Nothing
    is ever wider. Its body scrolls from the window's top edge (no strip above
    it) to 8px above the window's bottom.
  - **One page spacing, the roomy one** (the owner's call: "make all pages
    except chats/id, but chat index as well, to follow the normal page spacings,
    not the compact version", after Capy's General). Every page but the open
    chat is a `PageColumn` in that track: from 768px **24px sides** (content,
    cards and the title row 720px wide), **the title row 64px from the top**,
    **40px between blocks** and **40px under the last one** (a centerpiece's card
    instead runs to the frame's 8px bottom; while the composer bar shows, the
    last block ends 24px above it and a card 8px above it: Components,
    Composer, Clearance). Below 768px the sides are the
    frame's 20px, the title row sits on the top axis beside the sheet's menu
    button and the gaps stay 40px. See Page anatomy.
  - **Nothing is pinned above a page.** Its title row is the first block of the
    scrolling column (Capy's settings pattern) and scrolls away with the content;
    see The page header. The one exception is the **open chat**
    (`/chats/<id>`): a compact 80px header (`density="compact"`, see Density) pinned
    above its transcript, which scrolls on the frame on the same 24px sides as every
    page (no card, no wrapper); it is the only page on the compact spacing.
  - **The top axis** (`--axis-y`, 34px, one CSS variable in `globals.css`): **the
    sidebar's mark** and, below 768px, every roomy title row and the sheet's menu
    button share the center y 34 (the compact chat header is no longer on it: it
    is the row between two equal 24px gaps, center 40). Each offsets from the variable by half its own height
    (the chat's row: top 18, 32px; Back and a title row below 768px: top 18,
    32px; the mark's row: top 20, 28px), so changing it moves them all. The
    value is the sidebar's: its first row starts one group gap (20px) from the
    top, 20 + 28 / 2 = 34. From 768px every other page's title row is lower,
    at y 64 (its center 80): expected, the roomy spacing does not line up with
    the mark.
  - **The gutters** are the free space left and right of the column; they hold
    the floating navigation (left, level with the title row, 16px from the column) and,
    mirrored, the sidecar's toggle (right, level with the title row) over the floating
    sidecar (right, starting at the **content start**, below), and do not
    scroll (so the navigation is sticky: it never moves while the title and the
    page scroll away beside it): only the column's body scrolls (a blocks page as
    a whole, a centerpiece in itself). Frame width is the region right of the
    sidebar (window - 256, or - 48 icons only, or the whole window on a phone).
    On Electron the gutters and the window's top 8px are the drag region; the
    column is not, so what scrolls under the top stays clickable.
  - **Collapse rules.** Closed sidecar: both gutters equal, column centered. Open
    sidecar: `--sidecar-reserve` (320px: `--nav-gap` 16, `--sidecar-width` 296, 8px
    to the window; `FRAME_TOKENS`) is reserved in the right track; while the gutter
    already is wider the column stays centered, else it shifts left, the composer
    with it (it is in the column's track), so the panel never covers the content
    (measured at 1440: content 488..1208 closed, 376..1096 open; composer
    624..1072 -> 512..960; panel 1136..1432). Both fit from **1160px of frame
    width** (the nav's 72px gutter + 768 + 320; a container query takes no
    variable, so the number is written out); under it the sidecar overlays the
    page instead. The floating
    navigation needs a left gutter of 72px (20px, the 32px buttons, 20px to the
    column); narrower it moves into the title row's trailing actions.
  - **The content start** is the top of the first block after the title row: the
    first section's title row on a blocks page, the first card when there is no
    section title (y 136 at scroll 0 from 768px: the title row is 64 to 96, then
    40px; lower under an item's description), on the open chat the body's top
    under its pinned header (y 80; the transcript marks no block). Blocks mark themselves (`data-content-start`), `PageFrame`
    measures the first one (unscrolled) and publishes it as `--content-start`.
    The floating sidecar starts there (it is the sidecar's line, not the floating
    navigation's nor its toggle's: those are level with the title row).
- **Insets.** Controls sit **4px** inside their bar or card, so their corners
  nest (32px control `md` 8 + 4 = card `xl` 12). Content text sits 12–20px in.
- **Controls are 32px**: bar buttons and tabs on a page. Task list and
  command palette rows are 36px. Sidebar rows (28px, 2px apart; their group titles are 20px) are 28px with
  6px corners, the `compact` control; so are dropdown, combobox and suggestion
  items, dense bars (filter groups, composer pickers) and controls nested in
  a row (settings); the smallest buttons are 24px (`xs`); a sidebar row's
  actions and key are 20px, 4px inside the row on every side.
- **Tabs** (`Tabs`, one pattern everywhere: a project's sections, the
  command palette's categories): the Button's two heights, 4px apart, the open one with the
  selected fill (`foreground/10`), the rest ghost, an optional icon and a count right after the
  label. **Tabs on a page are 32px; tabs inside a card, dialog or popover are 28px**
  (`size="compact"` on `Tabs`, `sm` 6 corners, the compact Button's padding and gaps).
- **Buttons** pad by their content (table under Components): text 12px at
  32px (32 x 0.382 = 12.2, 1 / phi squared, on the 4 · 8 · 12 ladder), 10px at 28px,
  8px at 24px; beside an icon the icon's side takes 10 / 8 / 6px. Icon to
  label is 8px (6px at 28px, 4px at 24px) everywhere. Buttons in a bar sit 4px apart.
- **Even insets in rows.** What leads or ends a row (avatar, icon, key,
  check) sits in a 20px slot as far from the side as from the top: 4px in
  28px menu, combobox and suggestion rows. A bare 14px icon gets 3px each side
  of the slot, so it is 7px from the row's sides. Labels after a slot
  share one column (32px in), and a
  combobox's search icon and text sit on the items' columns. **The sidebar is
  the exception** (it is tight, on the frame): a 14px icon, no slot, 8px
  padding and an 8px gap to the label (8 / 14 is about 1 / φ, a step of the
  4 · 8 · 12 · 20 ladder), so the icon's left edge is 16px and the label 38px
  from the sidebar's edge on every row (the group titles start on the icon
  line, 16px); two vertical lines, whatever the row.
- **Sidebar** (`Sidebar`, design system). ONE width for every section and
  page: 256px expanded (also the sheet below 768px), 48px as icons only. It
  never changes with the page: no section sets `--sidebar-width`, and 256px is
  the width at which both the Chats list and the Settings pages fit. It is
  expanded from 1024px up and icons only below; below 768px it is a sheet
  opened by the menu button fixed at the page's top-left (see The page header). There is no toggle button,
  cookie or shortcut: the window decides. No resizing. Inside, 8px from the
  window's sides, top to bottom, the header and four groups.
  **One vertical rhythm, one gap: 20px** (the golden ladder's 12 x φ = 19.4 ->
  20; it was 16, off the ladder, and the header band left 24px above the mark
  but 16px below it). Derivation and the numbers, all measured in the browser:

  | Space | px | How |
  | --- | --- | --- |
  | Window top -> the header's 28px row | 20 | the container's 8 + 12 (`pt` from `--axis-y` - 22) |
  | The mark (20px) in its row | 4 above, 4 below | centered |
  | Above the mark / below it (to the first row) | 24 / 24 | 20 + 4 / 4 + 20: symmetric |
  | The mark's center, the top axis | 34 | 20 + 28 / 2 (`--axis-y`) |
  | Group to group (box to box) | 20 | `SidebarContent` `gap-5` |
  | Above a group title (Pins, Recent) | 20 | the group gap |
  | A group title | 20 tall | 12px text; its rows 4px under it (2px margin + the 2px row gap) |
  | Rows | 28, 2 apart | |
  | Last group -> footer | at least 20 | `mt-5`; the footer is pinned at the bottom |
  | The footer's row -> window bottom | 20 | 8 + 12: the mirror of the top |
  | Sides | 8 | the container's padding |

  No divider lines, no titles on the header, group 1, group 2 or the footer, so
  the hierarchy reads from the space alone: header, Home and Search, the
  pages, the page's own content, the footer. Groups 1, 2 and the footer never
  scroll; group 3 does, inside itself. Icons only the groups are 8px apart (the
  header ends 8px above the first one) and a 16px-wide hairline
  (`bg-foreground/10`) centered in each gap marks them (`SidebarGroup`, the
  footer's top carries it too); group 3 is hidden; the 20px top and bottom
  insets stay. Groups 1, 2 and the footer never scroll; group 3 does, inside
  itself. Icons only the groups are 8px apart and a 16px-wide hairline
  (`bg-foreground/10`) centered in each gap marks them (`SidebarGroup`, the
  header's bottom and the footer's top carry it); group 3 is hidden.
  - **Header** (group 0): the Otto mark alone, no name, in a 28px row 20px from
    the top of the window and 20px above the first group. The mark is a 32px
    ghost button (`Button` `ghost` `icon`: 4px around the 24px mark, the same
    hover and pressed fills and `md` 8 corners as every 32px control, the focus
    ring for the keyboard only) that opens Home, its tooltip "Home" then the
    `nav.home` `Kbd`. It overhangs the 28px row by 2px each way and sits 2px in,
    so the mark's center is where the old 20px mark's was: x 26, the top axis
    (y 34; roomy titles sit at y 64 from 768px, the compact chat header's center is 40). The sheet below 768px keeps the same 8px inset (plus
    the iOS safe area), so its mark is on the axis of the page's menu button. On Electron the header is the window's drag region,
    its row clears the macOS traffic lights (68px in; icons only, the row sits
    below them) and Back / Forward end it as two 28px ghost icon buttons with
    their keys in the tooltip (history back and forward, see Navigation). The
    web app has neither: the browser has its own.
  - **Group 1, Home and Search**, only these two: Home (`House`, `/home`, see
    Home) shows your unread notifications' count in the row's
    right slot (12px muted tabular, the slot's time look; `99+` at most, nothing
    at 0, hidden icons only), filled while Home or its Notifications list is open; Search opens the
    command palette on All (⌘K does the same).
  - **Group 2, the pages**, in this order: Tasks, Projects, Chats, Routines
    (`Clock`), Library (`Library`: documents and files in one place). Both groups
    are small arrays in `app-sidebar.tsx` (`homeSearch`, `pages`: id, icon, label,
    optional handler, optional count). A row with no route yet is a placeholder,
    shown not linked: no handler, no pointer, no tab stop (`aria-disabled`),
    no open state, and still fully readable (not dimmed); the layout is final.
    There is no New chat row: New chat is the page header's button and ⌘N. Rows are 28px with
    `sm` 6 corners, a 14px icon and an 8px gap (see Even insets: no slot),
    muted at rest, foreground on hover; hover is `foreground/5`, the current
    row and a row whose menu is open are `foreground/10`: a flat fill, no ring,
    no shadow, no weight change, so the row never changes width. Only keyboard
    focus draws a ring, inside the row (rows sit flush with the clipping edge
    of the sidebar and of its scrolling group, so an outer ring would be cut
    off on both sides). **A row with a shortcut (a pinned or recent row's number) shows its
    `Kbd` at the row's end** (`SidebarMenuKbd`: the standard 20px key, muted,
    absolute over the row, 4px from the top, the right edge and the bottom, so
    the three are equal; it keeps the key's own `xs` 4 corners, the concentric
    6 - 4 = 2 would read sharp; no width of its own so nothing shifts). **Keys show
    only while the reveal key is held, never on hover or focus** (as in Otto v1): ⌘ in the desktop app on macOS,
    Ctrl in the desktop app elsewhere, Option/Alt in the browser
    (`useShortcutReveal`, which the sidebar passes to its rows as
    `data-reveal-shortcuts`; it resets when the window loses focus), and
    then every row's key fades in (100ms) at once. The row has **no tooltip**: its label is on the row, so
    a tooltip would repeat it. Icons only the key is hidden and the tooltip shows
    the label with its `Kbd`; rows without a shortcut show a plain label tooltip
    then. Expanded and in the sheet no row has a tooltip. Routines (automations) have their own row; Skills and
    Sources live under Settings, which opens from the workspace menu.
  - **Group 3, the one dynamic group**: Pins and Recent (see Pins and recents;
    `SidebarPinsRecents`, after the pages, none when both are empty; each a 20px
    title 4px above its rows, the two 20px apart), the only
    thing that scrolls, inside itself with the edge fade. **The sidebar carries no sub-navigation**:
    no filters, no session list, no skills or sources list. What used to live here
    is an index page before the detail (see Page anatomy, Index pages). Settings is
    the one exception, and it replaces the whole sidebar (below). Hidden when icons only.
  - **Footer** (group 4), pinned at the bottom, **the workspace menu alone** (no Settings row: Settings is
    in the menu, and ⌘, stays bound by the shell): the workspace row, the
    one 32px sidebar row (`SidebarMenuButton size="lg"`, 6px corners: an avatar row looks better a step
    taller than the 28px nav rows) with a 20px avatar (`xs` 4) as its
    icon, an 8px gap, the name in medium and an up-down chevron (14px, muted)
    at the end. It sits 8px from the bottom edge, the same as its 8px side inset (the footer adds no
    padding of its own; the sheet below 768px adds 12px). It opens the
    **workspace menu** (`WorkspaceMenu`, 240px, the stock dark menu) upward, or to the
    right when icons only, where only the avatar shows, with the name in a
    tooltip; in the sheet it is the same row and menu. **Everything in it aligns
    on one icon axis, one text line and one trailing line** (a local `LEAD` slot
    in `workspace-menu.tsx`, no per-row offsets): every row (the two blocks,
    Settings, each workspace, New workspace, Log out) leads with a **20px slot**
    at the row's 8px padding, its content centered, so 20px avatars fill it and
    14px icons center in it (axis 18px from the row's left), an 8px gap, and
    **every label starts at 36px** (8 + 20 + 8), like the sidebar's rows; there
    are no 32px avatars here. The muted **Workspaces** label starts at 8px, the
    slot's left edge (the icon line, as the sidebar's group titles do); and what
    ends a row (the Settings `Kbd`, 20px tall and centered, the check, the remove
    button) ends **8px from the row's end**, the side padding (the check moves
    from the design system's 4px to 8px here, right-aligned in its 20px slot).
    Rows are 28px. It is a workspace menu,
    not a user menu: in order, the **current workspace** as a static block (a 36px
    row, 8px padding all round, 20px avatar, `xs` 4, and its name in medium; no second line, since the folder
    name only repeats it); a hairline; **Settings** (Settings icon) with its `Kbd` inline;
    a hairline; the muted **Workspaces** label over the list of workspaces, 28px
    rows (20px avatar, cloud state, unread dot, a check on the current one, a
    trash on hover for the others; a disconnected one reopens its reconnect
    flow), then **New workspace** (Plus icon; the existing add flow); a hairline;
    the **account**, always shown (the Shopify shape): a 48px item (two lines of
    18 + 16px sit 7px from the top and bottom; 8px gap), transparent at rest and
    filled `foreground/10` only while highlighted, the same 6px item corners, a 20px
    tile (`xs` 4, `bg-muted`, centered on the two lines) in the slot with the
    initials of the name, or a User icon when none is set, and
    two lines, the name (13px medium) over the role in this workspace and the email
    ("Owner · ada@example.com", 12px, muted, truncating; the role from
    `useWorkspaceMembers`, absent until it loads). On the
    web it is the signed-in person (`useCurrentUser`, `GET /api/auth/get-session`,
    fetched once per page load), a static block that opens nothing, so a second person
    never sees the first one's identity; on Electron both come from Settings →
    Preferences. A field not set
    shows its placeholder in muted text, "Your name" and "Add your email", so the
    block is never absent and plainly editable; nothing is invented and nothing is
    fetched (no gravatar). The Email field on that page is optional (empty or a basic
    email shape; an invalid one shows an inline error and is not saved, the last saved one stays). It is a menu item (highlight `foreground/10`): it opens
    Settings → Preferences; and **Log out**
    (destructive, LogOut icon). Theme lives in Settings → Appearance, not here. Log out is on the web app
    only: it posts to `/api/auth/sign-out`, which ends the session, then
    opens `/login` (a failure toasts "Could not log out"). Electron has no web
    session, so the item is absent there (the account block stays). One click, no confirmation.
  - **Settings: its own sidebar** (`settings-sidebar.tsx`, swapped in by
    `AppSidebar` while the route is a settings page, Skills or Sources; the owner's
    call, after Capy's settings sidebar). Settings is a world of its own, a few
    dozen pages that are configuration, not work, so it is the ONE place whose
    sidebar content is replaced whole: the mark, Home and Search, the pages,
    Pins and Recent and the workspace-menu footer all go. The same `Sidebar`
    (one width, icons only below 1024px, the sheet below 768px), no second
    framework. In it: **Back to app** in the header row where the mark was
    (a standard 28px sidebar row: ChevronLeft and the label, its icon on the
    mark's 16px line and its center on the axis; on Electron the row keeps the
    traffic-light inset, the drag region and the history buttons; icons only the
    chevron alone with its tooltip). It returns to the view Settings was entered
    from (the shell keeps the last view outside Settings; Chats when Settings was
    the first view opened). Then, 20px down, the registry's groups exactly as
    `SETTINGS_NAV_GROUPS` orders them: **Account** (General, AI, Appearance,
    Input, Shortcuts, Preferences) and **Workspace** (Workspace, Members,
    Permissions, Labels, Statuses, Messaging, then Agents, Skills and Sources), each under its
    20px muted group title, every page a standard 28px row with its own icon
    (`SETTINGS_ICONS`; Agents `Bot`, Skills `Shapes`, Sources `DatabaseZap`), the open one filled
    `foreground/10`, hover `foreground/5`, the inset ring for keyboard focus only.
    A direct URL fills its row. The groups scroll as a whole on a short window
    (edge fade, no scrollbar). No footer. Settings opens from the workspace
    menu (and ⌘,) on **General**, the registry's first page.
    On the web, General has no Notifications and Power sections: they are the
    desktop app's (OS notifications and the power blocker are its main process).
    The Labels, Statuses and workspace Permissions pages are data in the
    database, not files: the agent edits labels and statuses with the `otto`
    CLI and the rules with its `permissions_edit` tool, and the pages reload
    when they change. **Statuses** is read-only like Labels: one card of rows (the status
    icon, tinted by its color when it is an SVG, the name, and an outline Open /
    Closed / Archived badge: open shows in the inbox, closed in the archive; Archived
    is the one fixed status archiving a chat moves it to), its Edit
    prefilling the composer. A status icon is an emoji or an SVG image data URL
    that stays tinted by the status color.
    **Edit with the agent** (the owner's call: no "ask the agent" popovers): every
    Edit button of a page (`AgentEditButton`, the outline compact "Edit") and every
    add action (Add skill / source, New routine) prefills the one floating
    composer with a sentence naming the thing and its place cursor-last ("Edit the
    source GitHub to "), then focuses it; Enter starts the chat. Sources, skills and
    routines have no entity token yet, so their name is plain text. No "Edit file"
    secondary action. Copy lives in `agentEdit.*` strings, never a hardcoded name.
- **The page header** (`PageHeaderRow`, drawn by `PageHeader`) is the page's
  **title row: the first block of the scrolling column**, never a pinned bar
  (the owner's call, after Capy's settings, where "General" is simply the first
  element of the 768px content column). It is 32px tall, **its top 64px below
  the window's top** from 768px (its own margin, `md:mt-16`; below 768px 18px,
  `--axis-y` - 16, so its center is the axis beside the sheet's menu button),
  inset 16px (`PAGE_INSET`) inside the column's 24px sides, 40px above the first
  block (the column's gap), and it scrolls away with the content; the column
  ends 40px under its last block. It holds the page title (`PageTitle`, 21px medium, plain text with
  its badge where it has one) and the page's actions right-aligned on the same
  row, all 28px ghost controls (Filter, Search, New chat, More…).
  **The title is one line, never an ellipsis and never a dropdown**: it runs the
  full width and fades out over its last 16px (8 x 2) where the actions start
  (a mask, the technique of the sidebar's rows; a short title is untouched). A
  page with a menu of actions on its subject (a chat's session menu, a source's,
  a skill's, an automation's) ends its actions with **More actions** (`Ellipsis`,
  28px ghost icon button, tooltip "More actions", open state the standard
  `foreground/10` fill) that opens that menu; below 768px a chat's opens the
  drawer instead. **The title never has a back button or a breadcrumb.** Going
  back and stepping through a list is the floating navigation. Pages call
  `<PageHeader title actions />` anywhere and pass no handlers (see Navigation):
  it draws its row in the column's title slot (`PageColumn`'s first child, so
  the title scrolls with the content; in place on a page with no column, such
  as a not-yet-loaded item, at the same height).
  **An item's description** (`PageHeader description`: a skill's description, a
  source's tagline, an automation's summary) is the page's lead line, muted
  body text 4px under the title in the same slot (inset like the title; one
  block, so the 40px gap comes after it), shown there once and never repeated
  in the page: the same pattern as a document, its title then its body.
  - **Density: ONE row, one `density` prop (`roomy` | `compact`), no per-page
    override.** The spacing tokens live in ONE place, `FRAME_TOKENS` in
    `page-frame.tsx` (published on the frame's grid, so the owner can tweak and
    compare), on the golden scale 8, 13, 21, 34, 55 (`--gr-8` ... `--gr-55`, the
    same steps as the type scale 13, 16.5, 21):

    | Token | Value | What |
    | --- | --- | --- |
    | `--nav-gap` | 16 | the navigation's right edge to the column (owner: 16, never above): its x is the same on EVERY page (x 336 at 1280) |
    | `--nav-top-roomy` | 64 | roomy: the nav top and the title row's top |
    | `--header-gap` | 24 | compact: the gap above the title row AND below it (equal) |
    | `--header-compact` | 80 | compact: 24 + 32 + 24, where the transcript starts |
    | `--nav-top-compact` | 96 | `--header-compact` + the 16px a turn row carries on top (the transcript's top fade covers it): the first row's top (the day divider) |
    | `--composer-gap` | 24 | the clear space between the floating composer and the content above it |

    **Roomy** (every page in the column: skill, source, routine, task, project,
    library item, settings): the title row 64 down, the big title (21px), 16px in
    to line up with the cards' text; the nav top is 64 (level with it).
    **Compact** (the open chat only): the row in the frame's header slot, the
    section title size (`text-base`, 16.5px), its left edge on the column's
    content edge (24px in from 768px, the frame's 20px below: the same x as the
    transcript's text and the composer's left; measured at 1440: title, text and
    composer all x 488, the composer's right = the transcript's right, x 1208),
    and the nav top on the transcript's first row (80 + 16 = 96, measured equal).
    There is no wrapper, card or line around the transcript (the owner's call,
    2026-10-07: "fully remove the bordered wrapper ... one less padding"): it scrolls
    on the frame, so the first row is 40px under the title row, the roomy
    pages' block gap. On Electron the compact row is the window's drag region and
    the controls opt out.
  - **Below 768px** the sidebar is a sheet, so its menu button must stay
    reachable without a pinned bar: a **32px raised icon button** (`outline`, as
    the floating navigation: content scrolls under it, so it needs the card
    fill) **fixed over the column's top-left**, 16px in, on the axis, outside the
    scroll (the frame's leading slot), and the title row clears it (its title
    starts 56px in: 16 + 32 + 8). On the chat it leads the compact row instead (a
    28px ghost button). A page showing only its empty state (`PageHeader` with no
    title) draws only this button.
- **The sidecar** (`Sidecar`), closed by default, holds an item's details (a
  task, project, routine, library item; `SidecarDetails` in a page). It looks
  **exactly like Otto v1's right column** (the owner's call, 2026-10-07): plain
  text on the page background, no card, border, background, shadow or title,
  muted section labels, rows of icon + value (`PropertySection` / `PropertyRow`,
  see Components, Property list; never hand-made rows). It **floats**: an
  absolute layer in the right gutter's area, never a grid item, 296px
  (`--sidecar-width`) wide, `--nav-gap` (16px) right of the column (the
  toggle's x) and from the content start to the frame's 8px bottom; the column
  makes room for it (Collapse rules), so it never covers content. Taller than the
  window it scrolls itself with the edge fade. Under 1160px of frame width it
  overlays the page on a surface (`bg-card`, ring, `shadow-md`, no backdrop; the
  one place it is a card, because it floats over content) with its title and a
  Close (it covers the toggle there); below 768px it spans the width (the phone
  sheet). Opening and closing is 200ms of slide and fade, none with reduced
  motion. Escape closes it while focus is inside, and it closes when the page
  goes away.
- **The sidecar's toggle** (`SidecarToggle`) is **never in the title row**: it is
  the floating navigation mirrored, the same 32px raised icon button (`outline`,
  `md` 8, 14px `PanelRight`, the same hover and pressed rules), in the frame's
  trailing slot: in the right gutter `--nav-gap` from the column, its top
  `--nav-top` (level with the title row: y 64), while that gutter is 72px wide
  (from 912px of frame width); narrower, fixed over the column's top-right on the
  title row's line (40px in from 768px; 16px in on the axis below, mirroring the
  sheet's menu button) and the title row clears it (`pr-14`, as `pl-14` for the
  menu button). It stays put while the page scrolls. Open, it is the Close (X,
  label "Close") in the same place, right above the panel's left edge; the panel
  has no Close of its own except when it overlays. Tooltip below: the label
  (Details / Close); there is no shortcut. Pages render
  `<SidecarDetails title>{details}</SidecarDetails>` anywhere; the details mount
  on the first open.
- **New chat** is on the Chats index only (a chat has More actions there
  instead): the create "+" (`CreateButton`, 28px, Buttons, Create actions) last
  in the title row's actions at every width, tooltip below with the label and
  its `Kbd`; ⌘N (`app.newChat`, bound by the shell, not the sidebar) does the
  same. There is no floating "+".
- **Floating navigation** (`FloatingNav`): Superhuman's controls, in the left
  gutter beside the column, **`--nav-gap` (13px) from it**, **level with the title row**: Back's
  top is y 64, the title row's top, so the two share a center at scroll 0. It is
  fixed to the frame, not to the title row or the first block, so the title
  scrolls away beside it. On the open chat (the one compact page, `PageFrame`
  reads its header's density, one rule) the top is `--nav-top-compact`
  (96, the transcript's first row) instead; the x is the same. They are our standard raised icon button
  (`outline`, 32px, `md` 8 corners, 14px icons, a tooltip each), never round and
  with no pill or wrapper: Back (ArrowLeft), then 8px below it Previous (up) and
  Next (down) as a vertical `ButtonGroup` whose `ButtonGroupSeparator` is the one
  1px divider between them, in the buttons' own border color, edge to edge (the
  group squares only the inner corners; the outer ones stay 8px). Disabled at the
  ends (dimmed). They stay put while the center scrolls (sticky: the gutter does not
  scroll), on the chat too. They float over the empty canvas, never over content, so the hairline
  border alone reads as raised: no shadow. Every page that has
  anywhere to go shows them (Back when it has a parent, Previous / Next when it
  has a list), none otherwise; **Settings' own pages never show them** (its own sidebar lists the pages and
  leads with Back to app); **a skill and a source do** (the one exception in Settings, the owner's call:
  Back to their grid, Previous / Next through it), while their sidebar row stays filled; narrower than a 72px gutter (or below 768px) they
  move into the title row's trailing actions (the chat's compact row's) as 28px ghost icon buttons in the
  same order (Back, Previous, Next), never leading and never beside the title. **Below 768px (phones)
  the row keeps only the menu, Back, the title and More**: Previous and Next (and the chat's Session
  info) are the first items of More (a dropdown; the chat's drawer), so the title gets the room. One
  rule for every detail page.
- **Widths**: the column track is 768px for every page (720px of content inside
  its 24px sides on every page, the open chat included), the sidebar 256px on every
  page (48px as icons), the sidecar 296px (`--sidecar-width`). A centerpiece is never wider than the
  column's content.
- **One left line.** Cards, a list's card and a centerpiece start on the column's
  content edge (24px inside the track from 768px) and end on its right; the page
  title, section titles (and their actions), the text inside a card and a list
  card's band chevron all sit 16px in (`PAGE_INSET`, one constant in `PageFrame`
  that the title row and `PageSection` share; a list card is 8px padding + the
  band's 8px; a centerpiece's document 20px). The open chat's transcript, its
  compact title and the composer sit ON the content edge (0 in).
- **Page**: see Page anatomy.
- **Galleries** (`Gallery`): 3 columns for projects, 4 for documents,
  files, skills and sources; 12px between columns, 20px between rows so a title stays with its
  tile. Every page's content is 720px (the roomy column): projects 3 columns of
  232px, the Library, a project's Documents and Files, Skills and Sources 4 of
  171px (checked in the browser: still the Library's feel; 3 would be 232px, a
  project's size).

## Page anatomy

Final and extremely simple, as the settings pages are: **no wrapping surface:
the frame, then cards.** A page is its title row and, under it, surfaces, in one
scrolling column. Surfaces
are siblings on the frame; a surface never contains another surface (no card in a
card, no panel in a panel, no wrapper, divider or border around a section).
Inside a surface: rows split by full-bleed hairlines, text, and nested controls
(28px / 6 and 32px / 8 buttons, inputs, badges). A code block, quote, table or
attachment chip inside a message or card is content: flat, a muted fill, no ring,
no shadow.

- **Every page** is ONE roomy column (`PageColumn`) in the 768px track whose
  first block is the `PageHeader` title row (on the frame, never in a card; it
  scrolls with the page, see Layout): from 768px **24px sides** (720px content),
  **the title row 64px from the top**, **40px between blocks** and 40px at the
  end; below 768px the frame's 20px sides, the title row on the top axis beside
  the sheet's menu button and the same 40px gaps. Only the open chat is
  compact (below). Two kinds of page, by what the content is:
  long-form content read or written top to bottom is a **centerpiece**;
  collections of facts and settings are **blocks**.
- **Blocks** (`PageColumn`: settings, projects, lists, overviews, empty states):
  the title row, then stacked sections, 40px apart, the page scrolling as a whole
  in the column (edge fade, scroll-driven so the top is not faded at scroll 0; no
  scrollbar; nothing stays pinned). The whole page area right of the sidebar
  scrolls the page, not only the column: a wheel or trackpad scroll over the
  gutters, the floating navigation or the space around the column scrolls it
  too, the same amount (`PageFrame` forwards it; the open sidecar scrolls its
  own content, and the chat's feed is unchanged). A section (`PageSection`) is a
  title (heading step 16.5px, medium, outside its card, inset 16px like the
  card's content) with an optional one-line muted body-size description and
  optional actions at the right end of that row, also on the inset ("View all",
  "Create"), 12px above its `PageCard` (`bg-card`, hairline border, `shadow-xs`,
  `xl` 12). Stat strips and rows in a card are split by hairlines. The first
  section starts 40px under the title row (y 136 at scroll 0, the content start,
  where the sidecar starts) and the last one ends 40px above the column's end. `SettingsSection` and `SettingsCard` are `PageSection` and `PageCard`; the
  settings pages are the reference implementation.
- **Settings** (`SettingsPage`, the one shell every settings page renders: its
  name from the settings registry alone in the title row, no actions of
  navigation, then its sections in the page column). The Skills and Sources
  grids and a skill's and a source's pages (`Info_Page.Content`) are the same
  column. The roomy spacing started here (Capy's General) and is now every
  page's.
- **Centerpiece** (`PageColumn fill` + `PageCenterpiece`: a task, a document, a
  file's preview): ONE card as wide as the column's content and as
  tall as the space under the title row (to 8px above the window's bottom),
  clipped, scrolling inside it with the edge fade. `fill` makes the column fill
  the height without scrolling as a whole; its title row is 64px down and the
  card 40px under it (y 136), like any page. A toolbar is part of the title
  row, not a nested card. **The open chat is the one compact page** and takes no
  `PageColumn`: its title row is the compact one (80px, see Density) and its
  transcript is **no card and no wrapper** (the owner's call, 2026-10-07: "fully
  remove the bordered wrapper, it is ugly"): it scrolls straight on the frame
  from y 80 to the frame's 8px bottom, its text on the column's content edges
  (24px sides from 768px, 0 in below: the compact title's left, the composer's
  left and right). Its top is the 16px a turn row carries (the top fade is as
  tall), so the first row (the day divider) is at y 96, the nav's top. **The floating composer
  is the shell's, in the frame's one slot, as on every page**: on the content
  edges, 8px above the body's end (16px above the window); the transcript's
  bottom padding is `--composer-lift` (the slot's height) + `--composer-gap`
  (24px), so nothing hides behind it at the end.
  Messages are flat: every message sits straight on the frame under its
  author's header (no bubble, ring or shadow, see Chats > One chat), code
  blocks are flat muted blocks.
- **The list card: a dense list page's table in the Settings card.** A page of
  many small rows with small details (Chats, Tasks and a project's Tasks tab,
  Routines, Home's Notifications) puts its list in ONE `ListCard` (list-group.tsx): the
  Settings card itself (`PageCard`: `bg-card`, the card edge, `shadow-xs`, `xl` 12
  corners) with the table **8px in** (`p-2`, the ONE padding of a list page, so
  the table is inset from the card's edge, not docked to it: the owner's
  reference, 2026-10-07). There is NO line wrapper around it any more (the
  bordered `PageWrap`, its `--wrap-*` tokens and its 29px nested corner are gone).
  Inside, Otto v1's table is unchanged (`ListGroup` rounded tinted bands, chevron
  first, rounded 44px rows, no hairlines; Data patterns 1); the bands and rows
  pad 8px, so with the card's 8px the chevron (Notifications: the row's media) is 16px
  in, on the page title's line (`PAGE_INSET`; measured at 1440: card x 488, its
  1px edge, chevron x 505, title text x 504). The card wraps the list block
  only: the title row and the filter chips (`FilterBar`) stay above it, 12px
  over its top. Pages of bigger cards and structured sections (settings, the
  Project Overview tab, detail pages, galleries) keep their own cards. Below
  768px it stays on the column's content edges. **Empty and loading:** an empty
  state (the section's `Empty`, `NoResults`, a tab's inline `Empty`) is not a
  row: it stays centered on the frame, no card; a loading list is rows, so its
  three `ListRowSkeleton`s (a row's 44px and grid: a 14px dot, a title bar, both
  `foreground/10`) sit in the `ListCard` where the list will be.
- **Index pages.** Sub-navigation is an index page before the detail, never a
  sidebar list: a data page of a grouped list or a grid of links that opens the
  detail. Chats opens on its index (`ChatsIndexPage`: the title row's ghost Filter, then
  the chats grouped by status in the `ListCard`; it never opens the first chat; with no chat at all only the empty state, no title row). The sidebar's rows open them; the detail's Back
  returns to them. **Settings has no index** (the owner's call: no grid of
  settings): `/{ws}/settings` is replaced with General and the settings sidebar
  lists the pages (see Layout, Sidebar). Its Skills and Sources rows open grids (below).
- **Skills and Sources** (`SkillsPage`, `SourcesPage`, `/{ws}/settings/skills`,
  `/{ws}/settings/sources`; the owner's call: "a grid exactly the same as the
  library, just without tabs"): the Library's anatomy without tabs or folders, on
  Settings' roomy column (see Settings above). The title row ("Skills" / "Sources")
  holds the 28px ghost actions of the data pattern: **Filter** (Sources only: Type,
  MCP / API / Local, `?type=`; one value at a time, the last picked, chips in the
  `FilterBar` while set; Skills has none, every skill is the workspace's: the
  global and per-project scopes are gone, and an old `?scope=` is ignored), **Search** (`CommandPaletteButton`: the palette on its Skills or Sources
  category) and **"+"** (Add skill / Add source in its tooltip): the existing
  add action, which prefills the composer ("Add a skill that ", "Add a source that
  connects to ", or the filtered type's sentence) and an agent writes it in a new
  chat. Then `Gallery columns={4}` of 4:5 tiles on the frame (`GalleryItem`):
  the item's own icon (`SkillAvatar` / `SourceAvatar`, chromeless: 16px in the
  icon tile, 14px before the title; a source with no icon file shows its type's glyph,
  never a favicon fetched from a third party), the muted caption under it (a source's type;
  a skill has none), the name under the tile; sorted by name. **A tile only opens
  the item** (keeping the filter): no right-click menu (the
  owner's call: the actions belong to the opened item; see Galleries). Loading
  is eight `GalleryItemSkeleton`s; none at all (no skill, no source) is the stock
  empty page alone, no title row or actions (the data-page rule under Empty
  states; its button the same Add popover); a filter that keeps none keeps the
  title row and shows `NoResults`.
  **An item** (`SkillInfoPage`, `SourceInfoPage`, both `Info_Page`) says each fact
  once: the title row is its name and **More actions**, the one menu of the item
  (Copy link (C), Show in the file manager, then Delete (⌫) apart, asked first with
  the stock destructive dialog, "Delete skill?" / "Delete source?", "This can't be
  undone.", and back to the grid after; the server refuses a member who is neither
  the skill's creator nor an owner); its description (a source's tagline) is the lead line
  under the title; no hero, avatar or table row repeats the name or the
  description. Then its sections, `PageSection` over `PageCard` as on every
  settings page, each with its Edit button (it prefills the composer naming the item and the
  section; an agent edits the file) as the section action. **A skill**: Instructions, SKILL.md's body as
  the Library's read-only markdown (`Markdown mode="full"`, 16px in the card, the
  page scrolls; a leading `# {name}` is dropped, it is the title), then Metadata
  rows (Location, Required sources, Always allowed tools; the rows exist
  only when set). **A source**: Connection (Type, URL, Last tested and its
  connection error), Tools (MCP), Permissions, Documentation (guide.md, the same
  markdown). The item has the floating navigation: Back to the grid under its
  filter, Previous / Next in the grid's order and filter.
  A skill an agent edited while a newer version was saved elsewhere shows one
  warning toast (`skillInfo.conflictKept`, naming the slug): the newer version is
  loaded and the edit is kept aside, never lost.
- **Projects index** (`ProjectsPage`, `pages/projects/`): a blocks page titled
  "Projects" whose actions are Filter (one on/off field, Archived:
  `?status=archived` lists the archived projects instead of the active ones,
  their titles muted), Search (the palette on Projects) and "+" (New project, in
  its tooltip); no counts or covers yet. Under the title
  the `FilterBar` while Archived is on, then `Gallery columns={3}` of 16:9
  tiles on the frame (the Folder glyph, the sidebar's Projects icon, in the
  icon tile; Folder and the title under it). A tile opens its project; its
  right-click menu (a long press on touch) is Open, Copy link (C), then
  Archive / Restore (A), which applies at once with the one "Saved" toast (a
  discrete action: no confirmation; projects are never deleted here). Loading
  is three `GalleryItemSkeleton`s. No projects at all: only the section's empty
  state ("No projects yet", "New project"), no title row or actions, whose button opens
  the same dialog as "+" (empty-state rule 1); only archived ones: the same
  empty state under the full header, so Filter stays reachable; Archived with
  none: `NoResults`. **New project** (`ProjectFormDialog`, reused by Tasks and
  the sidebar) is the stock dialog: Title (required, at most 200) and
  Description (a textarea), Cancel and Create (`loading` while it saves); it
  opens the new project, a failure toasts and keeps what was typed.
- **Tasks index** (`TasksPage`, `pages/tasks/`): the workspace's tasks across
  ALL projects (the owner's call; v1 listed one project at a time), a grouped
  list in the `ListCard` (`TaskGroups`, Data patterns 1, also a project's Tasks tab
  without the project badge). Actions: Filter (Project, Assignee: you as "Me"
  first, then people, then agents, Status: Todo / In progress / Done, then
  Archived on/off; Project and Assignee take one value, the URL's), Search (the
  palette on Tasks) and "+" (New task). Groups Todo, In progress, Done (folded unless the Status filter asks for
  it), Archived (folded last; the whole list, open, when Archived is on); a
  group's "+" starts a new task in that status; each band is tinted by its
status color (Archived neutral). A row (44px): the status icon
  (`TaskStatusIcon`: Circle todo grey, CircleDot doing purple, CircleCheck done
  green, Archive muted), the title (at 80% when done or archived), the
  assignees' 20px `AvatarGroup` (one tooltip names them), the project as an
  outline `Badge`, the due date ("Oct 4", else nothing) in the end column; the
  right-click menu: Open, Status (submenu, keys 1 to 3), Copy link (C), Archive / Restore
  (A), applied at once with the "Saved" toast. Loading: three
  `ListRowSkeleton`s in the `ListCard`. No tasks at all: only the section's empty state (no title row or actions), whose
  button is "New task", or "New project" while no project exists (a task needs
  one: it opens New project, then New task in it). Filters that keep nothing:
  `NoResults`. **New task** (`TaskFormDialog`) is the stock dialog: Title
  (required), Project (`ProjectPicker`, the searchable `Picker` opened by a
  field-look button: the filtered project, else the first active one),
  Assignees (`AssigneePicker`, the same `Picker` (multiple) from a field-look
  button listing the chosen names), Due date (`DatePicker` from the same
  field-look button), Cancel and Create; it opens the new task. No native
  select or date input anywhere.
- **Task page** (`TaskPage`, Otto v1's task page): a centerpiece page. The
  title row's title is the task's title, edited in place (an input that looks
  like the title; Enter or blur saves, an emptied title springs back); actions
  More (Copy link C, Archive / Restore A); Details is the floating sidecar
  toggle. The centerpiece: "Created by {name}, {date}" (12px muted) over the
  description in the markdown editor (`TiptapMarkdownEditor`, `/` blocks).
  Title and description autosave as one draft (Autosave). Under the
  description, 32px down, the task's **Activity** (`ActivityFeed`, see
  Activity): one chronological feed of what happened (created, status,
  title, assignees, due date, project, links, time logged) with the comments
  inside it (there is no separate Comments section), then the comment box. The sidecar "Details" (closed by default):
  Properties (each row's key works while the Details are open and shows as its
  `Kbd`: Status S, a menu, keys 1 to 3; Assignees, the searchable `Picker`
  (multiple); Due date D, the `DatePicker` popover from the row, × clears it;
  Project P, the searchable `ProjectPicker` of active projects), Links (web
  links, library items and chats, `ResourceList`: a row opens it, × removes it;
  the section's "+" ("New link") opens no form: it prefills the floating
  composer "Add a link to {task chip}: " and an agent adds it with `otto tasks
  update`; at most 50), Time (v1's time tracking: entries "Maria · 1h 30m ·
  Oct 4" with the person's avatar, notes in a hover card, × on your own; the
  total is the section's count; "New time entry", the section's "+": minutes
  and notes; no timer, v1 had none). Assignees and due date autosave; status,
  project, links and time apply at once; every change shows the one "Saved"
  toast and a `conflict` reloads. An id the workspace does not have shows the
  not-found page.
- **Routines index** (`RoutinesPage`, `pages/routines/`; the owner's call: "the
  exact same table for tasks and for routines"): the workspace's routines (the
  `routines` rows with their last runs, read through `useRoutines`) as the grouped list in the
  `ListCard`, like Tasks. Actions: Filter (Type, one at a time, `?type=`) and "+"
  (New routine); no Search (the palette has no Routines category). Groups by what
  starts them, in order and only when not empty: Scheduled (`Clock`), Events
  (`Zap`, Otto's own events) and Agent events (`Bot`), neutral bands, no group
  "+". A row (44px): the state icon (`CirclePlay` green active, `CirclePause`
  muted paused (`paused_at` set), `CircleAlert` red failing: the last run that ran failed; a
  skipped or running run does not count), the name (at 80% when paused), then what starts
  it in muted text after the name ("Weekdays at 9:00 AM (Berlin)", "Label added
  matching ^bug$": the cron in words in the UI language, the expression itself
  for an uncommon one), its kinds of action as outline badges (Prompt, Script,
  Webhook), and when it last ran ("2h", else "Never") in the end column; the
  right-click menu: Open, Run now, Pause / Resume, then Delete (⌫) apart, asked first
  ("Delete routine?", "This can't be undone."). Run now starts a run in the
  background ("Routine started"; its end arrives as a live update); Pause / Resume shows "Saved". Loading: three
  `ListRowSkeleton`s in the `ListCard`. No routines at all: only the section's empty
  state, whose "New routine" is the same as "+": it prefills the composer ("Add a
  routine that "), where you say what should run and when, and an agent writes it
  in a new chat (no form). A filter that keeps none:
  `NoResults`.
- **Routine page** (`RoutinePage`, `/{ws}/routines/{id}`): a blocks page. The
  title row is the name (read-only; changes go
  through Edit) with the trigger in words as the lead line; the floating Details
  toggle; actions More (Run now, Pause / Resume, then
  Delete, back to Routines after). Then **Actions**, a card with each action
  read-only (its kind over the prompt, or the webhook's URL or the script in mono;
  the section's Edit prefills the composer with "Edit the actions of the routine {name}
  to "), for a webhook routine **Webhook** (`RoutineWebhook`, between Actions and
  Run history): a card with a muted line over the URL in mono (`break-all`) and the
  section's Rotate (outline compact button, `RefreshCw`), asked first in a small
  alert dialog ("Rotate the webhook URL?", the old URL stops working at once;
  destructive action). The secret is shown once: the URL reads "Shown once. Copy it
  now, ..." with a ghost icon Copy button (tooltip "Copy", no key; `Check` after) only
  while the new URL is on screen; before that, and after leaving the page, the
  secret is bullets and the line says it is shown once when made. A running run
  shows as a spinning `Loader` in place of the row's state icon in the index, and the
  Running badge in the history, both live (`domain:changed` `routines`). Then **Run history**, a card of its last 20 runs, newest first:
  the date and time, the error or why it was skipped under it, and a Running / Ran / Failed /
  Skipped badge; a run that started a chat opens it (chevron). None: "No runs
  yet". The Details sidecar: Properties, read-only rows (Trigger, the cron in mono
  or the event; Timezone for a schedule, "Local time" when unset; Actions; Labels)
  and Status (Active, Paused or Failing, read-only: Pause / Resume is in More). Back returns to the index under its type;
  Previous / Next step through its order. An id the workspace does not have shows
  the not-found page.
- **Project page** (`ProjectPage`, `pages/projects/project-page.tsx`): a blocks
  page. The title row's title is the project's title, edited in place like the
  task's; the floating Details toggle; actions More (Copy link
  C, Archive / Restore A, at once with the "Saved" toast). Under it, 12px above
  the content, the 32px `Tabs` with their `Count`s (labels on the title's 16px
  line, no icons, like the Library's; on a phone they scroll sideways), in
  `?tab=`: Overview, Tasks (open tasks), Documents, Files. A tab's one action
  ends the tab row, the create "+" 16px in (the header actions' line;
  on a phone it wraps under the tabs): Tasks "New task" (`TaskFormDialog` with
  the project preset; a group's "+" too), Documents and Files "Add from
  library" (a searchable list of the library's items of that kind not linked
  yet; a pick links it at once). **Overview**, sections 40px apart: the
  description in a card (the markdown editor, 16px in; it autosaves with the
  title as one draft), Links (`ResourceList` in a card, 4px in: web links,
  library items, chats; × removes at once; "New link", the section's "+",
  prefills the composer "Add a link to {project chip}: ", like the task's) and Members (the
  settings row: 20px `ActorAvatar`, name, a × that removes them; "Add
  member" ends the section's title row and lists the workspace's people and
  agents not in the project). There are no member roles (`projects.members`
  is a list of actors): nobody's buttons are gated. **Tasks**: `TaskGroups` of the project (in the
  `ListCard`, a list like the Tasks index), or the inline `Empty` "No tasks
  yet" on the frame. **Documents / Files**: the project's library
  links (`resources` of type `library`) as a 4-column `Gallery` of
  `LibraryTile`s (Open, Copy link, then Remove from project apart); a link
  whose item is gone is a tile captioned "Unavailable", title muted, whose menu
  is Remove from project (its tab comes from its title: `.md` is a document);
  none is the inline `Empty` "No documents yet" / "No files yet", no action.
  The Details sidecar (closed by default): Properties (Status, Active or
  Archived from its menu; Created) and Chats (the chats bound to the project by
  `projectId`, newest first, a row opens it; not drawn when none). An empty
  picker says why ("Everyone is already in this project"). An id the workspace
  does not have shows the not-found page.
- **Data patterns.** Two ways to show a set of things, by what it is:
  1. **Grouped list** (`ListGroup`, `ListRow`; Otto v1's table, Linear's and
     Codex's pattern) for collections you work through: Chats, Tasks, Routines.
     - **No toolbar.** The title row carries only 28px ghost icon buttons:
       Filter (`FilterMenu`), Search (`CommandPaletteButton`: the command palette
       on the page's category; tooltip "Search" and ⌘K), then "+" / New (Chats:
       the title row's New chat). No search box, no sort or view picker.
       Active filters show as chips (`FilterBar`) on the frame under the title row,
       12px above the list, ONLY while one is set.
     - **In the list card, no hairlines.** The groups sit in the page's
       `ListCard` (the Settings card, see Page anatomy), as wide as the column
       (the page scrolls), 8px in from its edge. Nothing in it is a surface and
       NO hairline is drawn inside it: not under a band, not between rows, not
       between groups. A group is a rounded band with its rows plain on the
       card, 4px under the band; a group sits 8px under the last row of the
       one before.
     - **Proportions** (measured on Codex and Linear at 1x: rows 44, group
       bands 36, metadata chips 24, body 13; the owner's reference table measures the
       same, 36px bands and 44px rows): body text 13px on its 20px line;
       a row is 44px = 20 + 12 + 12, a group band 36px = 20 + 8 + 8, a
       metadata badge 24px = 16 + 4 + 4: the padding steps down the 12 · 8 · 4 of
       the golden ladder (row ≈ 28 × φ = 45, header ≈ 28 × √φ = 36, both on the
       4px grid).
     - **One grid.** Bands and rows share the columns, measured from the
       band's edge: 8px in, a 14px column (the band's chevron; empty in a
       row), 8px, a 14px icon column (the group's icon, the row's status icon or
       avatar), 8px, then the text at 52px (the group's name, the row's title).
       With the card's 8px (and its 1px edge), the chevron is on the page
       title's 16px line, as in v1.
     - **Group band** (v1's secondary button): 36px, the table's full width,
       `md` 8 corners, a `foreground/5` fill (`foreground/10` on hover) with the
       group's status color laid over at 5% (`tint`: Needs review faintly
       amber, In progress faintly purple, Done faintly green; Archived and
       groups without a color stay neutral). The whole band toggles the group
       (Enter or Space, an inset focus ring for the keyboard only). Left to
       right: a muted 14px chevron FIRST (down when open, right when folded,
       rotating; foreground on hover), the group's icon, its name (medium) and
       its `Count`. An optional 24px ghost action at the far right (the "+", a
       new chat or task in that status) sits 6px inside the band's end, shown on
       hover or focus (always on touch). Empty groups are not drawn; a last
       group such as Archived starts folded (open when Archived is the filter).
     - **Row**: 44px, `md` 8 corners, plain on the card (no divider), 8px
       in, the whole row opens the item (outside a group, Notifications, the same row
       with its media on the chevron's column): icon, title (13px,
       truncated; a read chat at `foreground/80`, an unread one at full
       foreground with its blue dot), small marks after the title (working,
       plan, flagged), then on the right the metadata badges 6px apart (outline
       `Badge`s, 24px pills: two labels then "+n", then the model; hidden in a
       column under 448px) and a 12px muted tabular relative time in a 40px
       right-aligned column, 8px from the end. States are the ghost ones,
       rounded and as wide as the band: hover `foreground/5`, current and
       pressed `foreground/10`, an inset focus ring (keyboard only);
       the item's menu is its right-click menu (a long press on touch, the menu
       key by keyboard; never a ⋯ button), and the row stays highlighted while
       it is open. `ListRow` owns this (`menu`); a page passes a
       `ContextMenuContent`.
     - **Filters** combine: the fields AND together and the values of one field
       OR together (Status: Todo, Done). They live in the route (Chats:
       `useChatFilters`, one value as the route-string filter, more as
       `allSessions?status=…&label=…` in the URL search), and the published
       Previous / Next order is exactly the list shown.
  2. **Gallery** (`Gallery`, `GalleryItem`, `GalleryItemSkeleton`; built, in
     `design/ui`, playground "Gallery and property list") for Library,
     Projects, Skills and Sources. Not cards: a tile with its icon and the title UNDER it; the ring
     darkens on hover; 16:9 covers for projects, 4:5 pages for documents and
     files (and skills and sources), 1:1 where a tab wants squares (3 columns
     for projects, 4 for documents, files, skills and sources). Spec under Components, Galleries.
- **Radii**, one table (inner = outer - gap):

| Surface | Radius | Inside it |
| --- | --- | --- |
| Card, centerpiece, composer, overlaid sidecar (`xl`) | 12 | Rows full-bleed, no radius; 28px controls. The list card (`ListCard`): the grouped list's bands and rows `md` 8, 8px in (not concentric on purpose: v1's table kept as is, the owner's reference) |
| Row in a card, nested control | 28px, `sm` 6 | 24px action, `xs` 4 |
| Button | 32px, `md` 8 | 14px icon |
| Sidebar row | 28px, `sm` 6 | 20px action and key, 4px in, `xs` 4 |
| Workspace row (workspace menu) | 32px, `md` 8 | 20px avatar, `xs` 4 |

## Navigation

One history stack, one rule for Back, one place the lists live.

- **URLs are real paths; TanStack Router owns the history; route strings are the internal
  API.** A view is `/{workspace}/chats/{id}`, `/{workspace}/settings/appearance` and so on
  (the table is in docs/routing.md), the same on the web and in Electron, so a reload, a
  link and the browser's own buttons all work. The Chats filters live in the URL search and
  combine: `?status=todo&status=done&label=research&flagged=1`. Code navigates with route
  strings (`navigate(routes.view.settings('appearance'))`), never with URLs.
- **Not found.** A URL that matches no view, an unknown workspace and a missing chat, skill
  or source are never silently replaced with Chats: they show the full-screen
  `NotFoundPage` (Empty states and 404; behavior table in docs/routing.md).
- **History** is the router's (every view change pushes an entry; a redirect replaces
  one). Back and Forward mean history back and forward everywhere:
  on Electron the two icon buttons in the sidebar header and their keys
  (⌘[ / ⌘] and ⌘← / ⌘→), on the web the browser's own buttons. The web app
  draws none.
- **Back** is a different thing: the floating navigation's first button, shown
  ONLY on a view with a parent, where it goes to the parent view by the route
  hierarchy (`useParentView`): a chat goes to the Chats index (under the filter it was
  opened with); a task or a library item goes to its index under the same filters, tab and folder; a routine to Routines under its type; a project to its section.
  A skill or a source goes to its grid in Settings, under the same filter; an agent to the Agents gallery.
  The Chats, Tasks, Projects, Routines and Library indexes and the Skills and Sources grids have no
  parent, so no Back. Settings' own pages have no Back either: its sidebar lists them, and
  Back to app leaves. Sub-navigation is the index page (Settings: its sidebar), so Back is the same at every width. There is no back button and no breadcrumb in the title row: the
  title is alone. Pages never pass handlers: `PageHeader` reads the route.
- **Compact (below 768px)**: the sidebar sheet's menu button is fixed at the
  page's top-left on the axis (on the chat it leads the compact row); Back,
  Previous and Next are the ghost buttons at the end of the title row's actions. Back goes to the parent view like everywhere else.
- **Previous / Next** step through the list the page belongs to, in the order its
  index shows it, and are disabled at the ends: the context exposes `listNav` (`hasPrev`,
  `hasNext`, `goPrev`, `goNext`). Chats: the Chats index's displayed order
  (filtered and grouped by status there, Archived left out unless it is the filter), published
  to `sessionListOrderAtom` while the index is open and kept when a chat opens (after a
  reload, until the index has been open, a chat has none). A skill or a source: its grid's
  order under the same filter (`lib/skill-source-lists.ts`, read by the grid and `listNav`).
  A routine: the Routines index's order under the same type (`getVisibleRoutines`).
  Settings' own pages step through its sidebar instead, and the other lists have none yet
  (Back only). A page with neither a parent nor
  a list shows no navigation. They show as the floating navigation. No keys are
  bound yet (none exist), so no `Kbd` shows.
  Quick actions in the Superhuman manner (next chat, next task, go back) are the
  next layer on this API.
- Existing navigation APIs: `navigate(route, { replace? })`,
  `navigateToSession`, `navigateToSource`, `goBack` / `goForward`,
  `canGoBack` / `canGoForward`, `listNav`, `useNavigationState()`,
  `useParentView()`. There is one open route (`currentRouteAtom`); several
  panels side by side are gone, and so are open in a new panel, new chat in a
  panel and focus next / previous panel.

### Pins and recents

The sidebar's one dynamic group (`SidebarPinsRecents`, put in `SidebarContent`
after the pages) is a **Pins** group and a **Recent** group: any chat, and later
any project, task, routine, library or settings page, in one list, with no
sub-navigation sidebar. Each group has the usual 20px title (12px muted), 4px over
the standard sidebar rows: the item's icon in the 14px slot (a chat's bare status
icon, the same as a Tasks row's; other types a 14px Lucide icon by type), the open item filled like an open page. An empty group draws nothing, and the whole group draws nothing when both are
empty.

**The row** is the chat row of Otto v1's sidebar ("one line at normal weight, the whole
title running under the right slot instead of truncating"), a standard 28px row:

- **Title**: one line, normal weight, never an ellipsis. It runs the full row width and
  fades out under the right slot with a mask (`mask-image`, 16px = 8 x 2 fade, ending at
  the slot's left edge), not a painted gradient, so it blends with the rest, hover,
  selected and open fills in light and dark. It is `text-muted-foreground`, and
  `text-foreground` when the chat is unread or waiting on the user (no weight change).
  A short title is untouched: the fade only shows where the text reaches the slot.
- **Right slot** (`SidebarMenuSlot`): a 20px lane 4px from the row's top, right and
  bottom, holding **one thing at a time**, swapped by opacity (100ms) so the title and
  the row height never move. At rest: the chat's status if one matters, else the time
  since its last message. Status, most urgent first: waiting on you (a permission or
  credential request pending: 8px amber dot, `--info`), failed (last message an error:
  14px `TriangleAlert`, `destructive`), working (14px `Spinner`), unread (6px `primary`
  dot). Time: 12px muted tabular, short, refreshed each minute (`now`, `5m`, `2h`,
  `3d`, `2w`, `5mo`). With neither, the slot is empty. On row hover, keyboard focus
  (`:focus-visible` inside) or while a menu of the row is open (always on touch): only
  the actions, 20px ghost icon buttons (`SidebarMenuSlotAction`, `xs` 4 corners, 14px
  icons, hover `foreground/10`, open `/10`, inset focus ring) 2px apart: **Pin / Unpin**
  and **Archive / Unarchive**, each one real action (never a ⋯: the rest of the session
  menu is the right-click menu, as on the Chats page rows).
  Pin and Archive carry a tooltip with their label; they have no shortcut, so no
  `Kbd`. A row that is not a chat has only Pin, and its context menu is Pin or Unpin.
- **Key**: the ⌘1–⌘9 / Option+1–9 jump hint of the first nine rows replaces the slot's
  content only while the reveal key is held (a `Kbd`, 20px, in the same 4px lane), never
  on hover.
- The right-click menu (a long press on touch) is the session menu. A row whose menu is open is
  filled like the current one.

- **Item**: `{ type, id, title, route }`, stored with `pinnedAt` or `visitedAt`.
  `type` is `chat`, `project`, `task`, `routine`, `library`, `settings` or a later
  one; the key is `type:id`. A chat shows its live title and status, looked up by
  id in the sessions store at render time (the stored title is the fallback); a chat
  that no longer exists is not shown and is dropped from storage once the sessions
  are loaded. Its route is always the canonical `allSessions/session/<id>`, whatever
  filter it was opened from.
- **Pins** keeps the order the user set (new pins go last) and is reordered by
  dragging a row. **Recent** is most recent first, deduped, at most 20, and never
  repeats a pinned item (unpinning brings it back to its place). Pin and Unpin are
  in a row's Pin button and its context menu, and in the chat's menu (the header's
  More actions menu and the compact drawer). No snooze.
- **Recording** (`useRecordRecent`, once, in the shell): a visit to a chat is
  recorded when its route opens and the chat has something in it (an empty new chat
  is not). Other types are recorded by their own pages with the same call; nothing
  else records.
- **Storage**: two small lists per workspace in local storage
  (`otto-pinned-items:<workspaceId>`, `otto-recent-items:<workspaceId>`), not synced.
- **Jump keys**: the first nine items across both groups, in the order shown
  (pinned first), open with **⌘1–⌘9** in the desktop app (Ctrl+1–9 on Windows and
  Linux) and **Option/Alt+1–9** in the browser, where ⌘/Ctrl+digit belongs to the
  browser's tabs (`nav.jumpTo1` … `nav.jumpTo9`, matched by physical key so
  Option's special characters do not matter). They work from the chat input too; a
  number with no item is not handled, so the key does what it always did; they pause
  under a dialog, sheet or menu. A row's number is a `Kbd` in its slot, shown only
  while the reveal key is held (see the row above). The shortcuts page lists them as one row (modifier and 1–9).

The standard keys, one binding per action: **⌘K** (Ctrl+K) opens and closes the
command palette (`app.commandPalette`; it was ⌘F, which the browser and every
editor keep for find in the page),
⌘N a new chat, ⌘, Settings, ⌘[ and ⌘] back and forward, ⌘/ the shortcuts. ⌘1–⌘3
no longer focus the sidebar, navigator and chat zones (Tab still cycles them).

## Shell primitives

All in `design/ui` (`// Otto:` comments mark what differs from stock shadcn) and
shown together in the playground under Shell (resize the window: the sidebar and
the frame follow it; variants show both page types and the sidecar as canvas and
as a card).

| Primitive | API | Spec |
| --- | --- | --- |
| `SidebarProvider` / `Sidebar` | | one width, 256px on every page (also the sheet below 768px), 48px as icons; a row with `aria-disabled` is a placeholder (no pointer, readable); no toggle, cookie or shortcut; absolute inside the shell; 8px container padding is the gutter; no border or ring |
| `SidebarHeader`, `SidebarContent`, `SidebarFooter` | | header a 28px row 20px from the top (its padding from `--axis-y`) and 20px above the first group (8px icons only), the mark's center on the axis (y 34); footer at least 20px under the last group, its row 20px from the bottom; content does not scroll, its groups do, and spaces them 20px apart (8px and a hairline icons only); see Sidebar under Layout |
| `SidebarGroup`, `SidebarGroupLabel` | | no padding of its own; a 20px title, 12px medium muted, 4px above its first row |
| `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` | `isActive`, `tooltip` (text, or `{ children }` for a label and `Kbd`; shown only icons only) | 28px row, `sm` 6, 8px padding, 14px icon and 8px gap (no slot); rest `text-muted-foreground`; hover `foreground/5`; active, current and open (`aria-expanded` on a menu trigger) `foreground/10`, flat (no ring, shadow or weight change); inset focus ring; icons only: 28px square centered (10 each side), label and trailing icons hidden, plain tooltips show |
| `SidebarMenuAction` | | 20px, `xs` 4, 4px inside the 28px row; shown on row hover or focus (always on touch); hover `foreground/10`, which stacks on the row's fill |
| `SidebarMenuKbd` | | a row's shortcut: the standard `Kbd` over the row's end, 4px from top, right and bottom, muted, shown only while the reveal key is held (`data-reveal-shortcuts` on the sidebar), never on hover or focus; hidden icons only (the tooltip carries it then) |
| `SidebarMenuSlot`, `SidebarMenuSlotAction` | | the row's right slot: a 20px lane 4px from the row's top, right and bottom, one cell for stacked layers (status or time, actions, key) that swap by opacity; clicks pass through except on a visible layer; `SlotAction` is the 20px in-line ghost button (the look of `SidebarMenuAction`). The row fades its title under the lane with a mask, see Pins and recents |
| `SidebarTrigger` | | the sheet's menu button below 768px: 28px ghost in the chat's compact row; elsewhere 32px `outline`, fixed over the column's top-left on the axis |
| `PageFrame` | `aside` | the main region on the frame: the 768px column (`@container/panel`) and its title slot, the chat's header slot, the leading slot (the fixed menu button), left and right gutters; the top axis `--axis-y`; see Layout |
| `PageHeaderRow` | `leading` (the menu button only), `title`, `actions`, `density` (`roomy` \| `compact`) | the title row: 32px; `roomy` the first block of the column, 64px down from 768px (centered on the axis below), `PageTitle` 21px medium, inset 16px; `compact` (the open chat only) 80px in the header slot (24 + 32 + 24), 16.5px title on the column's content edge (24px from 768px, the transcript's and composer's left); 28px controls; no back button, no crumbs; tokens in `FRAME_TOKENS` |
| `PageScroll` | | scroll region with edge fade, no scrollbar |
| `PageColumn`, `PageSection`, `PageCard` | `fill`; `title`, `description`, `action`, `danger` | every page but the open chat (the column's first child is the title slot): 24px sides from 768px, 40px gaps, 40px at the end; `fill` for a centerpiece page (fills the height, no scroll of its own); see Page anatomy |
| `PageCenterpiece` | `className` | the one big card of a long-form page; column width, fills the height |
| `ListCard`, `ListGroup`, `ListRow`, `ListRowSkeleton` | `className`; `icon`, `label`, `count`, `tint`, `defaultOpen`, `action`; `media`, `title`, `marks`, `meta`, `end`, `menu` (right-click, never a ⋯), `menuProps`, `active`, `muted` | Otto v1's table in `ListCard` (the Settings card, `PageCard`, 8px in, the one padding of a list page), no hairlines: 36px rounded tinted bands (chevron first), 44px rounded rows, both 8px in; a `ListRow` outside a group (Notifications, Home's cards) is the same rounded row with its media first; `size="sm"` is the 32px row for a list inside a popover (the composer's Notifications list); the loading row; see Data patterns |
| `FilterMenu`, `FilterBar`, `NoResults` | `fields` (`key`, `label`, `icon`, `options` or on/off), `values` (`string[]` per field), `onChange`; `isLabel`, `isAnyOfLabel`, `removeLabel` | the header's ghost Filter (checkable values, several per field) and the 28px chips of the active filters; nothing matches: the stock `Empty` centered in the free space; see Filters |
| `Count` | | a count right after its label, softer (`muted-foreground/70`, tabular) |
| `Gallery`, `GalleryItem`, `GalleryItemSkeleton` | `columns`; `title`, `icon`, `media`, `cover`, `label`, `badge`, `ratio`, `menu` (right-click, never a ⋯), `current`, `disabled`, `muted`, `render`; `ratio` | tiles with the title under them; see Components, Galleries |
| `PropertySection`, `PropertyRow` | `title`, `count`, `action` (the create "+", 24px, at the row's end, beside the fold trigger; the section is drawn with it even with no rows), `defaultOpen`; `icon`, `label` (screen readers only beside a value), `value`, `placeholder`, `kbd`, `actions`, `readOnly` | the sidecar's Details blocks (v1's rows: icon + value); see Components, Property list |
| `Sidecar`, `SidecarToggle` | `open`, `onOpenChange`, `title`, `closeLabel`; the toggle's `label` | floats right of the column on the frame, plain; a card only when it overlays; the toggle is the floating navigation mirrored; see Layout; closed by default |
| `FloatingNav`, `FloatingNavButtons` | `back`, `previous`, `next`: `{ label, onClick, disabled, tooltip }` | see Layout; the nav needs a 72px left gutter, sits 20px from the column, Back level with the title row (on the top axis on the open chat), the buttons are its narrow form for the title row's actions |

In the renderer: `PageHeader` (the header with the route's Back and the list
navigation wired into the floating navigation), `AppSidebar` (with `SettingsBackRow` and
`SettingsSidebarContent` swapped in under Settings), `SettingsPage`, `useParentView`, `useSidecar` (and `SidecarHost`, the
`aside` of the shell's frame).

### Home wallpaper

Home (only Home and its Notifications list, decided by the owner) shows a photo under the
whole window, the sidebar included; every other page is the plain frame.

- **Photo.** Clouds in light, the night sky in dark (`assets/wallpaper/`, 1920px
  AVIF, about 140 KB and 57 KB; `scripts/compress-wallpaper.ts`; credits in
  `NOTICE`). Dithered and slowly animated by BB's shader (an 8x8 Bayer pattern,
  four brightness steps, the photo's own colors, 2px cells, half resolution
  capped at 1920 x 1080, 30 fps). Paused while the tab is hidden; one still
  frame under reduced motion; the plain photo without WebGL2.
- **Mount.** `HomeWallpaper` (`components/wallpaper/`), mounted by the shell on Home only, first in
  the sidebar wrapper. Leaving Home removes the canvas and its WebGL
  context; it fades in over 240ms once the photo is decoded.
- **One overlay** over the photo, white in light and black in dark, of three
  layers with a strength each (globals.css): `--wallpaper-overlay` uniform
  (light 0.15, dark 0.2), `--wallpaper-fade` BB's vertical fade, none at the top
  to full at the bottom (0.8, 0.85), and `--wallpaper-scrim`, a soft ellipse from
  the top-left corner behind the sidebar and the title row (0.85 both), its
  radii `--wallpaper-scrim-size` (`70rem 250%`; `28rem 40%` below 768px, where
  there is no sidebar). The scrim falls off on a smoothstep, so it has no edge.
- **The sidebar has no surface** on the wallpaper: no fill, tint, blur or edge,
  only its text, icons and row fills over the photo. Muted text is one step
  stronger there (`--muted-foreground` 0.42 light, 0.82 dark). The phone's sidebar
  sheet floats over the page, so it is glass.
- **Surfaces turn to glass** (`data-wallpaper` on `<html>`): cards (Home's four
  `ListCard`s among them) and the composer keep their layer color translucent (card 70% white in
  light, 0.19 at 65% in dark) over `blur(24px)`, which smooths the dither under
  their text; their edge is `foreground` 10% (light) or white 14% (dark) instead
  of the solid grey ring. State fills stay `foreground` alphas.

## Elevation & Depth

Depth comes from translucency and hairlines, not heavy shadows.
There are no `shadow-minimal` or `shadow-tinted` utilities: a card is `card-surface`
(also for a small floating control over content, such as a copy or expand button), a
chip or badge inside a message is a flat `bg-muted` (or `bg-destructive/10`,
`bg-success/10` when tinted) with no ring or shadow, and an error or warning notice
is a flat 10% tinted fill.

- **Frame**: the darkest layer, flat: the sidebar and the main region are the
  same color, nothing wraps the page. **Surfaces** (`PageCard`,
  `PageCenterpiece`, `Card`, comments, question cards, the
  empty-state tile): card background and ONE shared edge, the `card-surface`
  class in `globals.css`: a 1px **border** inside the card's own box
  (`--card-ring`, a solid color: `oklch(0.87 0 0)` in light, `oklch(0.281 0 0)`
  in dark) and the soft outer shadow (`--card-shadow`, `shadow-xs`; the sidecar
  overlay sets `shadow-md`), with `background-clip:
  padding-box`. Never a `box-shadow` ring: it is drawn outside the box, and a
  scroller whose edge meets the card's (the page column fills the scroller, and
  `overflow-y: auto` clips x too) cuts it off at the sides and corners. The
  color is solid because the outer shadow is painted under a translucent border
  and would tint each side differently. Only the shadow may be clipped. Rows
  inside split by `--card-divider` (10% light, white 12% dark). Change the edge
  there, never per component. Siblings on the
  frame, never one inside another. The sidecar is the exception
  that proves it: flat on the frame when it floats beside the column, a card with `shadow-md` only
  when it overlays content. The composer is the other: it keeps v1's full
  composer edge exactly (Components, Composer), a 1px `foreground` 10% ring
  with `shadow-xs` and no border; it sits in its own slot, outside every
  scroller, so nothing clips the ring.
- **Scrolling** areas fade at the edge where more content waits (shadcn
  `scroll-fade-*`): at the top edge once the page has scrolled (never at scroll 0, so the title is whole) and off the bottom, the floating chat
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
- **The composer bar** floats on the composer's one surface (the card color,
  the 1px `foreground` 10% ring, `shadow-xs`; Components, Composer) in the
  frame's composer slot, a layer above the scrolling page, never inside it:
  content scrolls on under it, fading over its last 80px, and a page ends
  24px above the bar (see Components, Composer, Clearance). Only the bar takes
  clicks; no overlay, so the page stays usable.

## Shapes

Radius tokens: `xs` 4 · `sm` 6 · `md` 8 · `lg` 10 · `xl` 12 · `2xl` 20 · `full`.
**Rule: inner radius = outer radius − the gap between them.** Never repeat the
container's radius inside it. `xl` is 12 because 32px controls sit 4px inside
cards and have an 8px radius.

| Container | Inside | Gap | Inner radius |
| --- | --- | --- | --- |
| Card, centerpiece, composer (`xl` 12) | 32px buttons, rows | 4px | `md` 8 |
| Sidebar row, 28px (`sm` 6) | 20px row action, key | 4px | `xs` 4 |
| Menu, combobox, popover, hover card (`lg` 10) | Items, search field | 4px | `sm` 6 |
| Command palette (`xl` 12) | Rows | 4px | `md` 8 |
| Tooltip (`sm` 6) | Key | 4px | `xs` 4 |

- Buttons are never fully round: 32px `md` 8, 28px and 24px `sm` 6, except
  where a 20px button sits 4px inside a 28px row (a sidebar row action or
  key): `xs` 4, a soft corner (6 - 4 = 2 would read sharp).
- **Nested radius rule** (inner = outer - inset) holds for controls in a bar or
  card (the table above). There is no line wrapper and so no nested wrapper
  corner any more (the 29px `--wrap-radius`, `--wrap-inner-radius`,
  `--composer-radius` and `--radius-2xl` are gone with it); the composer is `xl`
  12 everywhere. The list card's bands and rows keep v1's `md` 8 at 8px in (not
  concentric on purpose). Bubbles and attachments are not concentric on purpose.
- Keys are `xs` 4: a soft corner, short of a pill. Elements only a few pixels
  inside their container (attachment thumbnails and remove button) use `xs`.
- A tooltip is `sm` because it holds a label, not nested items.
- Gallery tiles, covers, attachments and media in the file viewer are `md` 8.
- Avatars are rounded squares at about a quarter of their side: 20px `xs`,
  28px `sm`, 32px `md`, 40px `lg`. Badges stay pills.
- Bars and inputs are never fully round: the floating chat keeps the composer's `xl`.

## Components

**Buttons.** Ghost for nearly everything. `outline` is the raised look (a
card-colored button with the card's hairline, flat), `secondary` a quiet fill,
`default` (primary) only for a surface's main action. Two heights: 32px
(`default`, `icon`, `md` 8) and 28px (`compact`, `icon-compact`, `sm` 6); 24px
(`xs`) only for row actions. There is no 36px button and no other size. Padding follows the content and is
set once, in the `Button` component, never per instance:

| Size | Height | Text only | Icon beside text (icon side / text side) | Icon only | Gap | Icon |
| --- | --- | --- | --- | --- | --- | --- |
| `default` | 32px | 12px | 10px / 12px | `icon` 32px square | 8px | 14px |
| `compact` | 28px | 10px | 8px / 10px | `icon-compact` 28px square | 6px | 14px |
| `xs` | 24px | 8px | 6px / 8px | `icon-xs` 24px square | 4px | 12px |

**Create actions.** Every create action of a page, a section, a tab or a group is
ONE thing: `CreateButton` (`components/ui/create-button.tsx`), a ghost "+" (`Plus`)
icon button, 28px (`icon-compact`; 24px `icon-xs` in a group band and in a
sidecar section), whose `aria-label` and tooltip (below it) are the same label,
"New {thing}" ("New task", "New project", "New link", "New time entry"), or
"Add …" / "Invite member" where "New" is wrong ("Add skill", "Add member",
"Add from library", "Add to library"); a key goes in the tooltip as a `Kbd` after
the label (New chat, ⌘N). A create that opens a menu or a picker (the Library's
"Add to library", Add member, Add from library, Add skill) is the same button as
the trigger (`<DropdownMenuTrigger render={<CreateButton … />} />`), the menu
rows being the nouns. It sits at the end of its row: the page header's actions,
a `PageSection`'s `action` (the end of the title row), a `PropertySection`'s
`action` (the sidecar's section row, 24px), the project tabs' end, a group
band. Never a labeled "+ New …" button and never a "New …" row ending a list.
Exceptions: the empty state's single primary labeled button (the page's only
create affordance there: its title row and actions are hidden), the submit of a
dialog ("Create", "Invite", "Send"), the comment's Send, the first-run and
onboarding steps (a flow, not a page action), and the rows of a menu or palette
("New folder", "New workspace", "Add new label"), which stay items.

The golden check: 32px height x 0.382 (1 / phi squared) = 12.2, so the text
padding is 12px; the icon side steps down by 2px (a 14px glyph carries about 1px
of its own padding) so icon and label balance optically. A leading `svg` is
detected structurally, as is a trailing one that follows an element; CSS cannot
see text nodes, so a trailing icon that follows bare text (a chevron after a
label, `ArrowUpRight` after "Open") or a wrapped icon (an avatar stack) carries
`data-icon="inline-end"` / `"inline-start"` on the icon or wrapper. Tabs and
`ToolbarChip` are buttons and share this (tabs take `size="compact"` inside a card, dialog or popover); toggles use the same padding (a lone
bare icon is a square, marked icons beside text as for buttons), badges the
`xs` row, a text addon in a button group and text inputs / select triggers the
`default` text padding (12px; at 28px 10px, the select's chevron side 10 / 8px).
Menu items keep the menu rule (8px). One
state language for every interactive element (buttons, tabs, toggles, sidebar
and list rows, chips, grid cards, radio options, select triggers):

| State | Ghost (button, tab, toggle, nav row, list row, chip) | Outline | Secondary | Primary |
| --- | --- | --- | --- | --- |
| rest | `text-muted-foreground` (content rows `text-foreground`), no fill | `bg-card` + 1px `--card-ring` border | `bg-foreground/10 text-foreground` | `bg-primary` |
| hover | `bg-foreground/5 text-foreground` | card + 5% | `bg-foreground/15` | `bg-primary/80` |
| pressed (`:active`) | `bg-foreground/10` | card + 10% | `bg-foreground/20` | `bg-primary/70` |
| selected / current (`aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, `data-active`, `data-state=on`) | `bg-foreground/10 text-foreground` | card + 10% | not a selected state | never selected |
| open (`aria-expanded`: a menu or popover is open) | same as selected | card + 10% | `bg-foreground/15` | `/80` |
| focus-visible | `ring-2 ring-inset ring-ring`, everywhere | same | same | same |
| disabled | `opacity-50`, no pointer events | same | same | same |

Six rules:

1. State fills are alphas of `foreground` (5% hover, 10% pressed, open and
   selected), never a layer token (`muted`, `secondary`, `sidebar-accent`), so
   they read the same on the frame, on a card and in dark. A row action nested
   in a row fills with `foreground/10`, which stacks on the row's fill.
2. Open (a menu or popover on it) and pressed look like selected: one fill.
   Tooltip triggers carry `data-popup-open` while their tooltip shows, so
   "open" is `aria-expanded`, never `data-popup-open`.
3. A ring means keyboard focus and nothing else: no ring, shadow, raised pill
   or weight change (`font-medium`) marks hover, open or selected, and a row
   never changes width.
4. A fill says where you are (selected, current); a check icon says what is
   chosen in a menu (no fill on the checked item). Badges are static; anything
   you can click is a chip (a compact ghost button).
5. Debounce. Any search field filters through the shared debounce
   (`DEBOUNCE_MS` = 800, `@otto/shared/utils/debounce`; `useDebouncedValue`
   in the renderer); typing itself is never delayed. Autosave waits the same
   800ms (below).
6. Loading. A loading button is disabled, shows a spinner, and keeps its
   label: `<Button loading>` (`aria-busy`, the `Spinner` as the leading icon in
   place of any leading icon, so the width never changes); never swap the
   label for a pending string ("Saving…") or the label for a bare spinner, and
   never hand-roll `disabled` plus `Spinner`. Not for `render` (asChild) buttons.

**Icons and avatars.** Lucide icons at **14px** everywhere (the old Remix names below map to their Lucide twins). Fixed icons: project
`RiBox3Line`, repeat `RiLoopRightLine`, agent `RiRobot3Line`, time
`RiTimeLine`, row remove `RiCloseLine`, add `RiAddLine`, files
`RiFolder3Line`. **Avatars are at least 20px** (`ActorAvatar`): people show
initials, agents their avatar (`AgentAvatar`: a generated shape on a tint, or
an uploaded image; see Agents), nobody a person outline. Lists mixing avatars and
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

**Badges.** Pills sized like tooltips: 24px tall, 8px on both sides (6px beside
an icon, like an `xs` button), 12px text, 14px icon with a 4px gap so it reads as one unit. Used for metadata on
list rows (the project). Static: no hover, press or focus state.

**Focus.** Text fields (`Input`) show no ring or border change; the caret shows
focus. Everything else that takes focus (buttons, tabs, toggles, rows, select
triggers, checkbox, radio, switch, cards) shows the one keyboard-only ring:
2px, inset, `--ring`. Invalid fields (`aria-invalid`; `Input`, `InputGroup`,
`Textarea`) take a `destructive` border and a `destructive/10` fill (`/50` and
`/20` in dark), the failed sign-in look. Select triggers and native
selects are solid fields (`bg-input/50`) that step to `/70` on hover and `/100`
while open.

**Switch.** On is emerald (`emerald-500`, the one place a control is green; the
page's blue stays for primary buttons and links), off is `bg-input`; the thumb is
the page color (white in dark). One color for every switch, set in the
`Switch` component, never per instance.

**Tooltip vs hover card.** A tooltip is one label, optionally with its key
(`Kbd`), 24px tall. The one exception to "a key lives in a tooltip": a sidebar
row whose label is visible shows its `Kbd` on the row (only while ⌘ / Option is held, never on hover) and has no
tooltip (see Sidebar); the tooltip with the `Kbd` is for icons only. Anything richer (metadata, notes) is a `HoverCard` at body
size. Blocks of data inside it are split by a content-width divider (spans the
text, not the card) with 8px above and below.

**Menus.** `DropdownMenu` for short option sets: a label row with the menu's
hotkey, then options with number-key shortcuts shown as keys; the selected
option shows a check instead of its key. Menu rows (DropdownMenu, ContextMenu,
Select, Combobox, Command) are 28px with 6px corners inside the menu's 4px
padding; the highlighted row (hover or arrow keys) is `foreground/10`, and a
checked item shows only the check icon, no fill. Destructive items are red text
and highlight in `destructive/20`. **Pickers**: every choice among things
(a project, people and agents, library items; anything that can grow past
about seven) is the one `Picker` (`design/ui` `picker.tsx`, shadcn's Combobox
pattern on Base UI; no per-page copies): any trigger opens it, topped by
`ComboboxSearch` (like the command palette, a search icon on the item icon
column and a transparent 36px input over a full-width bottom border, "Search
projects"), filtered as you type on the label, ↑↓ move, Enter picks, Escape
closes, the current value checked, the item's 14px icon or 20px avatar then its
label; nothing left says "No {things} found" ("No projects found", "No people
found"), or why there is nothing to pick ("Everyone is already in this
project"). One value closes it on a pick, several (assignees) keep it open.
Short fixed sets (a task's three statuses) stay a `DropdownMenu` with number
keys. **Dates**: the one `DatePicker` (`design/ui` `date-picker.tsx`): a
`Popover` with shadcn's `Calendar` (react-day-picker; 28px days with `sm`
corners, the month and its arrows on one line, weekdays muted 12px in the UI
language's locale, today `primary` text, the chosen day the primary fill,
hover and the keyboard's day `foreground/10`), opened on the chosen day or
today with it focused (arrows a day or a week, Page Up / Down a month, Enter
picks and closes, Escape closes), and a footer split by a faint line: Clear
(`Kbd` ⌫) and Today (`Kbd` T), both keys live while it is open. Never the
native `<input type="date">`. "/" and "@" suggestion lists use the same 28px rows.
The caret-anchored lists (slash, mention, label) and the cmdk pickers
(permission mode, status, working directory) keep their own key handling and
share one copy of the menu look, `menu-styles.ts` (dark translucent surface,
`lg` radius, 4px padding; 28px `sm` rows; highlight `foreground/10`): the
highlighted row is the only fill, and the chosen one shows a check icon, never
a fill, in every menu. A row that needs a second line (a description) goes on
the same line, muted and truncating, after the label (the model picker's
model and thinking rows: name, then description; menus cap at `max-w-sm`). Settings rows that open something
(`SettingsRow` with `onClick`) hover `foreground/5`, press and open
`foreground/10`, and show the keyboard ring inset; a settings segmented control
is a row of 28px ghost buttons, the selected one `aria-checked`. Fields in
settings use `bg-input/50`, with no ring and no fill change on focus.
Page shortcuts pause while a modal dialog or sheet is open, including when its
buttons have focus; the modal keeps its own keyboard controls.

**Details** (inside the sidecar). Collapsible sections with stock
spacing and no dividers. Muted section titles with an optional count, hidden
when there is nothing (no "0"). Counts everywhere sit right after their label,
softer than it (`Count`), the label's icon-to-label gap away. Property rows open
their menu; each has a hotkey. A list's create is its section's "+" (never a
row). Row actions appear on
hover (always on touch), and hovering one keeps its row highlighted. Repeat
stores an iCalendar rule: presets plus Custom, which asks an agent.

**Property list** (`PropertySection`, `PropertyRow`, `design/ui`
`property-list.tsx`): the Details blocks of every sidecar (task, project,
routine, library item), Otto v1's right column, on the page background, never
in a card. Use it for an item's properties (Status, Assignees, Due date,
Project), its short lists (resources, chats, time entries, each with the
section's create "+") and its read-only facts (Folder, Created by, Created,
Size, Type). Not for page content: lists on a page are `ListGroup`.

- **Section**: a 24px title row, 13px muted (regular), on the rows' icon line
  (8px in), then its `Count` (not drawn for 0) and a 14px chevron (right
  folded, down open; shown on hover, focus or while folded, always on touch).
  The whole title row folds the section (Enter or Space), hover turns the text
  foreground, keyboard focus draws the inset ring. Rows start 4px under it, edge
  to edge; sections stack 24px apart; no dividers. A section with no rows is not
  drawn.
- **Row** anatomy (v1's: icon + value), left to right: the 16px icon slot 8px in
  (a 14px glyph centered, an avatar shrinks to 16px), 8px, the value (foreground,
  truncated; the `placeholder`, muted, when empty, e.g. "No due date"), then the
  row's hotkey as a 20px `Kbd` at the end. The `label` is not drawn beside a
  value (the icon and the value say it; screen readers read it); a row with only
  a label is a muted full-width row. A row with only a value is a list item.
- **Row states** (the ghost ones): rest no fill; hover `foreground/5`; pressed
  and open (`aria-expanded`, its menu or popover is open) `foreground/10`;
  focus-visible `ring-2 ring-inset ring-ring`; disabled 50%, no pointer. The
  `Kbd` shows on hover, focus or open, never on touch. `readOnly` is plain text:
  no hover, focus, fill or `Kbd`. As a button (the default) it is the trigger of
  its menu or popover (`render={<PropertyRow … />}`); the caller binds the key.
- **Row actions** (`actions`: an `icon-xs` ghost Button, such as Remove) sit 6px
  inside the row's end, drawn at 20px with `xs` 4 corners and a `foreground/10`
  hover that stacks on the row's; shown on hover or focus (always on touch);
  hovering one keeps the row highlighted. The row reserves 32px for one action.

| Part | Size | Radius | Type / color |
| --- | --- | --- | --- |
| Section title row | 24px tall, 8px in | `sm` 6 (focus ring) | 13px, `muted-foreground`; hover `foreground` |
| Section gap / title to rows / row gap | 24px / 4px / 0 | | |
| Row | 32px, as wide as the sidecar (296px), 8px padding | `md` 8 | 13px, `foreground` |
| Icon slot | 16px, 14px glyph | | `muted-foreground` |
| Value | the rest, truncated | | `foreground`; placeholder `muted-foreground` |
| Key | `Kbd`, 20px, at the row's end | `xs` 4 | key token |
| Row action | 20px, 4px from the end | `xs` 4 | hover `foreground/10` |

**Composer** (`Composer`, `ComposerInput`, `ComposerRow`, `ComposerMainButton`
in `design/ui`; the spec and work packages in docs/composer.md). ONE composer,
the chat input (`FreeFormInput`, its `/` and `@` menus, files, Send and Stop
kept, on v1's look) with the floating bar as one of its modes, on every page,
mounted once by the shell (`ComposerProvider` around `PageFrame`;
`ShellComposer` only hosts the instance in the frame's composer slot), so its
text field never remounts on navigation: opening a chat, the new chat or
Home grows the same instance into the full look, leaving shrinks it, the text
and files kept. Exactly one composer shows on any page.
Three looks of one structure (slots in fixed places: `panel`, `attachments`,
`leading` +, the text, `context`, `tools`, `attention`, `main`).

**Surface** (one set of classes, `SURFACE` in `DS/composer.tsx`, the same in
every look): Otto v1's full composer exactly (`v1:apps/web/src/components/composer.tsx`,
its `InputGroup`): `xl` 12 corners, `bg-card`, a 1px `ring-foreground/10`
(no border), `shadow-xs`, controls 4px in. Checked against v1 in computed
styles (12px radius, 0px border, the `foreground` 10% 1px ring and the
`0 1px 2px` 5% shadow, light and dark; the full look 72px tall with one line,
the text 12px in and 12px down, + 4px from the edge). The looks change only
the size and what is inside, never the edge or the padding; v1's floating
glass for the bar is gone.

- **Compact** (every page by default): the 40px bar, 448px (28rem). One row:
  + (32px ghost), the text (44px in, one line, no wrap; the placeholder ends
  in an ellipsis), the attention slot (Notifications, below), the main button.
  Centered on the column's content, 16px above the window's bottom (8px above
  the body's end); below 768px the column's width (20px from each side).
- **Expanded** (grows in place from compact): as wide as the column's
  content (720px), its bottom edge where the bar's was; the text 12px in and
  down (v1's `p-3 pb-0`), one line up to 240px, touching the action row: +,
  the page's entity chip (`EntityChip`), tools … Notifications, main, 8px apart (v1's
  row gap).
- **Full** (the chat, the new chat, Home): the expanded anatomy, in the
  layout: the frame measures the slot (the composer and its gap below) and
  sets `--composer-clearance` to its height + `--composer-gap` (24), so a page's content ends 24px
  above it while it grows (on Home it is centered instead, see Place). Never the Notifications button. A
  pending permission or credential request takes its place until answered;
  the chat's follow-ups sit as chips above the text.

**Place** (the frame's composer slot, `DS/page-frame.tsx`): ONE place for
every look, so compact, expanded and full share the bottom gap and the side
edges and no page shifts it. The sides are the column's content edges (24px
inside the 768px track from 768px wide, the frame's 20px gutter below), the
bottom 8px above the body's end (16px above the window's), on every page, the
open chat included (it has no wrapper to sit inside any more). The slot's
height (composer + bottom gap) is `--composer-lift`. Measured (1440×900): the
compact bar is 448×40 at x 624, 16px above the window, on Tasks, Chats,
Routines, a skill and Settings alike; the open chat's full
composer is 720 wide on the column's content edges (x 488 to 1208: the transcript's
text and the compact title's left), 16px above the window. Phones (390×844): the bar and the full
composer 342 wide at x 24, 19px above the window, the same on every page, on
the list card's edges.

**Centered** (Home only; the slot's `data-placement`, `bottom` or `centered`).
A page that renders `PageComposerAnchor` (`DS/page-frame.tsx`, one per page)
asks for the composer in its own flow instead of at the bottom: the SAME
instance stays in the slot (never remounted: text, files and the morph kept)
and the frame translates the slot onto the anchor, following it as the page
scrolls; the anchor takes the composer's measured height
(`--composer-anchor-height`), so what is under it makes room as it grows.
While centered nothing is at the bottom: `--composer-clearance` and
`--composer-lift` are 0 (the toasts keep their own place). Changing placement
(sending from Home opens the chat; going back) glides the slot on the morph's
320ms curve, none with reduced motion. Measured (1440×900): the greeting ends
at y 196, the full composer 720×72 at x 488, y 216 (20px under it), the cards
from y 328 (40px under it, the column's block gap) on the same edges; after a
send the chat's composer is at y 812. Phones (390×844): the composer 342 wide
at x 24, y 288, above the cards (y 422), which stack in one column.

**Notifications** (W5; `components/composer/notifications-button.tsx`, `use-attention.ts`).
What needs you, from data that exists: the workspace's chats waiting on you (a
pending permission or credential request), its chats with news (`hasUnread`,
newest first), then your unread notifications (Home's Notifications rows:
mentions, assignments). The Notifications button (32px ghost `Bell`, the 8px
`bg-destructive` dot, `aria-label` and tooltip "Notifications, N need you", no key in
the tooltip) shows in the attention slot only while that count is above 0 and
nothing is written or attached (then Send has the slot alone); never in full
mode, never while dictating. It does not open a page: it opens the
**Notifications list** (`panel`) above the text in the same surface, which grows to
the column's content width and the list's height on the same 320ms morph
(bottom edge pinned); the input stays usable under it. The list is
Home's own rows in their compact size (`ListRow size="sm"`: 32px, `md` 8
corners, 8px in, the same slots and ghost fills): a chat reads its
bare status icon, its title, an `info` dot (waiting) or the primary unread dot,
its time; a notification is the Notifications row (`pages/home/notification-row.tsx`:
avatar, sentence, excerpt, dot, time). At most 320px (40% of a short
viewport), then it scrolls; 4px in. Picking a row opens the chat, task or
project (a notification is marked read) and closes the list; Escape (taken
first, before anything else), the button again or a click outside close it;
it also closes on a page change, or when nothing is left. The Home key
(`nav.home`, ⌘I; Alt+I in the browser) always opens Home (the shell's
action, it does not toggle the list); its full list is
`/home/notifications`. Phones: the list spans the bar's width
and scrolls, at most 40% of the VISIBLE viewport (`--webui-viewport-height`,
which the keyboard shrinks; `dvh` does not see it).

**Phones and the keyboard** (W7). On a phone the keyboard never covers the
bar, in every look (compact, expanded, full) and the Notifications list. The web host
already sizes its root to the visible viewport (`apps/webui/src/viewport.ts`:
`visualViewport` height and offset, divided by the root's 1.2 zoom), so the
frame, and the composer slot that sits at its end in the layout, rise with the
keyboard; the bar needs no code of its own and nothing jumps (one rAF, like
every viewport change). Two details sound the rest: while the keyboard is up
(`getKeyboardHeight`: the visible viewport lost 120px or more of the layout
one, and is not pinch-zoomed) the root drops its bottom safe-area padding
(`--webui-keyboard-open`), since the keyboard covers the home indicator; with
it down the bar keeps `env(safe-area-inset-bottom)` under it. The caret-anchored
menus (`/`, `@`) place themselves in layout pixels divided by the root's zoom
and stay inside the visible width (`placeMenuAbove`, `lib/input-viewport.ts`):
on a phone the `@` list is 280px wide (336 zoomed), its left edge pulled in to
keep 8px from the right. No `interactive-widget` meta (Safari ignores it) and no
`env(keyboard-inset-height)` (it needs the VirtualKeyboard API opt-in).

**States.** compact idle → (focus, ⌘J) compact focused → (the text overflows
the line, a line break from Shift+Enter or a paste, files, `expand()`)
expanded → (Escape, or blur while empty, or `collapse()`) compact idle;
focused → (Escape, blur) idle. Escape also blurs. The draft is kept either
way. A full page never collapses. A new page starts collapsed. Width AND height
move together over 320ms on `cubic-bezier(0.32,0.72,0,1)` (the height follows
the measured content, so the grow from the bar, a new line or the rail all
glide), bottom edge pinned, none with reduced motion. Dictation does not
expand the bar.

**Shortcuts.** Never shown at rest. Only while ⌘ (Ctrl off the Mac) or
Option/Alt is held (`useModifierHeld`; released on key up, window blur or a
hidden tab) the bar shows exactly ONE `Kbd`, the composer's own key (focus,
⌘J / Ctrl+J), in the attention slot: in the Notifications button's place, or there
when the button is not showing (also while typing). No second key anywhere in
the bar, none in full mode. An exception to the tooltip rule: the Notifications
button's tooltip is its label only, because the composer's hints appear only
while the modifier is held. The main button's tooltips keep the label, then
the `Kbd`.

**Main button.** One 32px primary icon button, its tooltip the label and its
key, one action in v1's order: Sending (`loading`) › Stop (Square, Esc, while
the page is `busy`) › Transcribing (`loading`) › Done (Check, ↵, while
listening) › Send (ArrowUp, ↵ or ⌘↵ per the send key setting; disabled until
the files are read) › Dictate (Mic, while empty; disabled, "Dictation isn't
available", where the browser cannot record).

**Files** (the rail, R10). + (also `/` Add files), a drop on the composer
(its ring turns `ring-ring` while dragging) or a paste add files; a paste of
over 100 lines becomes a text file. Each is read at once into the attachment
the chat already stores at send time. The rail is `AttachmentGroup` (one row,
sideways scroll, the edge fade) above the text, 4px in: in compact and expanded 28px `xs`
chips (20px thumbnail, the name cut in the middle, 20px remove), in the full
card `sm` chips with the kind and size ("PNG · 120 KB"; "Adding" while read).
A failed read is red with Retry. Files stay with the composer across pages
until sent or removed; adding one expands the bar. While a staged image meets
a text-only custom model, the chat's image warning shows above the rail.

**Commands.** No pickers in the toolbar: what they did is a command. `/` opens
the command menu: Mode (Explore, Ask, Execute, Guarded when on; the current
one checked), Status (the workspace's), Working directory (Choose folder…,
then the recent ones) and Compact context in a chat; Add files everywhere.
`@` mentions people, agents, tasks and projects (below), skills, sources (turned on
for the chat when sent) and the working directory's files. The menus open above
the composer, out of its surface (a portal), and keep the caret in the text.

**Mentions** (`@`, the menus' look). 28px rows, 280px wide, from the caret, the
`@` at the start or after a space or an opening bracket, then letters, digits,
`-_/.` and spaces (a space right after `@` is no mention). With nothing typed:
a heading per kind (In this chat, People, Agents, Tasks, Projects, Skills, Sources) with up to 3 rows
each: in a chat, its members other than you first ("In this chat": agents, then people; left out of People and
Agents), people by name (the workspace's `user:` members, you included; the muted email after the name), agents
(their 14px avatar, the default first; "No agents yet" under a loaded empty kind), tasks and projects the most
recently updated first (tasks to do, doing or done; active projects). A kind
that has loaded with nothing in it says so under its heading in muted text:
"No tasks yet", "No projects yet". Typed: one list of what matches (a word's
start before the middle of a word, then the newest update, then the name; at
most 30), the headings gone and each row ending in its kind in muted 12px
("Task", "Project", "Person", "Skill"). ↑↓ move (wrapping), Enter or Tab picks,
Escape closes; with no row for what is typed the menu says "No results" and
Enter belongs to the input again. Picking puts the bare token (`task:<id>`,
`project:<id>`, `user:<id>`, `agent:<id>`) and a space in place of `@query`. The editor
draws the token as a tag, the same as `EntityChip` (primary on its soft tint,
`xs` corners, 22px tall, 12px type icon, 13px medium; a person reads "@Name"
with no icon); it is one unit for the caret and Backspace, and its title
follows its list (a load or a rename redraws it). A sent message draws it with
`EntityText` in the transcript (an agent's tag shows its 14px avatar, the editor's the `Bot` icon). Mentioning an
agent is a reference, like a task: it never switches the chat's agent.

**With** (the new chat's picker, `components/composer/agent-picker.tsx`).
An empty chat has a 28px chip (`ToolbarChip`) first in the composer's tools,
before the model picker: the agent's (or the picked person's) 16px avatar, the
title (truncated at 160px) and a chevron; its menu has two labeled groups,
Agents (the workspace's agents) then People (the workspace's people, never you),
each row an avatar and a title, a check on the current one; tooltip "Chat with".
Picking a person opens your direct message with them when there is one (the chat
whose `dmKey` holds them); else the person stays picked (the model picker goes,
the placeholder reads "Message {name}") and the first send creates the DM
(`dmWith` to `sessions:create`, which returns the pair's DM if it appeared
meanwhile), sends there and opens it. An empty DM or group has no With. The default is the workspace's default agent,
else the last pick (localStorage `otto-new-chat-agent:<workspace>`), which every
new chat starts with (New chat, a send from another page). The chat's agent cannot
change once it exists, so picking another makes an empty chat with that agent
(`agentId` to `sessions:create`; same status, label, project, mode and folder),
opens it and deletes the empty one. Gone once a message is sent: the chat shows
its people in the header (the 20px `ChatPeople` group before the title, the names
in a tooltip).

**A chat's people** (`ChatPeople`, `components/people/chat-people.tsx`): a chat's
avatar is a group of its members, the agents first (`AgentAvatar`), then the
people (`ActorAvatar`): its `members` (`user:<id>` and `agent:<id>`, the creator
first; read with `useChatMembers`) **without the viewer, always** (the viewer
never sees themselves, not for a moment: nobody shows until the viewer's actor is
known). A chat without `members` shows its primary agent alone. The same 20px `AvatarGroup`
as the tasks (2px overlap, 1px ring), at most three avatars, then a
`AvatarGroupCount` "+N" (the same 20px box, 10px text); one tooltip names everyone
Used **only in the open chat's header**: every chat row (the sidebar's Pins and
Recent, the Chats rows, the palette, Home's Chats card, the composer's Notifications list) leads with the chat's
**bare status icon** (`ChatStatusIcon`: the 14px glyph in the status color, as
`TaskStatusIcon` is for a task; an emoji or a custom image icon at the same size),
never an avatar, a tile, a frame or a tooltip with the agent's name; the running
spinner, the unread dot and the like stay the row's marks. Server side: `chats_members` (the creator, the people and agents
added, every agent mentioned). **Titles per viewer:** a chat with no stored title and no primary agent (a DM or a
group) is titled by the other people in it, as the viewer sees them ("Grace", "Ada and Grace"; never the viewer):
`getSessionTitle(chat, useWorkspaceMembers())`; without the members argument it falls back to the first message.

**A chat's members** (`ChatMembersDialog`, `components/people/chat-members-dialog.tsx`):
Members (Lucide `Users`) is the first item of the open chat's header menu (and a row
of the phone's More drawer); it opens a stock `Dialog` titled "Members": one 32px
row per member, the 20px avatar, the name, a muted "You" or "Agent" after it. The
chat's creator (its first member) has a 24px ghost `X` on every other row but the chat's own agent's (tooltip
"Remove {name}"; "Ada removed") and two outline 28px pickers in the footer, "Add
people" (`UserPlus`: workspace people not in yet, never you) and "Add agent"
(`Bot`: workspace agents not in yet), each the shared searchable `Picker` ("Search people" / "Search agents"; "Ada added");
a picker with nobody left is disabled. Anyone else has "Leave chat" (the
destructive 28px button with `LogOut`, no confirmation; "You left the chat"),
which goes back to the index the chat was opened from, as Delete does. Changes
apply at once; the server pushes the changed chat back, so the list and the header
follow; errors toast "Something went wrong. Try again.".

**Empty.** The text counts as empty once its last character is gone: after
select-all and delete the browser leaves one stray line break, which is read as
empty, so the placeholder shows and the bar can fold.

**Context.** A page says what it is about in one line,
`useComposerContext({ key, entity?, placeholder?, mode?, onSend?, busy?,
onStop?, tools?, … })`; the last page mounted wins (the chat's adds its
session, chips, request, commands and working directory). Every page registers: Chats,
Tasks, Projects, Library, Routines (indexes `page:<name>`), a task, project
and library item (`<type>:<id>` with its entity token), a routine
(`routine:<id>`, no token: routines have none), Settings, Skills and Sources
(plain), Home (`page:home`, `mode: 'full'`, centered), its Notifications list (`page:notifications`), the chat and the new chat (`chat:<id>`,
`mode: 'full'`). The 404 has no shell. Placeholders: "Ask your agents about
this task / project / document / file / routine / page", "Ask your agents
anything" (Chats, Home, Settings, an empty chat), "Reply to {agent}" (a chat,
its agent's name from state, the default agent's only as the fallback), "Message {names}" (a people chat, a chat
with more than one person, or a person picked under With: the other members, agents and people, never you, as one
phrase in the app's language, "Ada, Grace and Otto"). A people chat (no primary agent and no agent among its
members) has no model picker and no image notice, a removed connection never blocks it, and sending only posts the
message: no "working" state unless the text mentions an agent (`startsAgentRun`). `useComposer()` gives `prefill`, `focus`, `expand`,
`collapse`, `take` to anything in the shell.

**Send.** Enter sends as the chat input does (`sendMessageKey`; IME respected;
Shift+Enter adds a line). A page's own `onSend` (the chat, W2) wins; else the
default: a new chat (the existing `onCreateSession`), its first message the
page's entity token then the text (`task:<id> …`), sent with the existing
`onSendMessage`, and the chat opens at once. The draft clears once the chat
exists; a failure to make it toasts "Could not start the chat" and keeps the
draft. Drafts live in the browser only (localStorage, per workspace and
context key, `otto-composer-draft:<ws>:<key>`); the text follows you to a page
with no draft of its own. A user message draws its typed references
(`task:<id>`) as tags (`EntityText`).

**Clearance.** While the bar shows, the frame sets `--composer-clearance`
(72px: 8 under the bar, 40, `--composer-gap` 24 over it; with the full
composer the slot's measured height + 24; 32 is the alternative, one token in
`FRAME_TOKENS`). A page (blocks or centerpiece) then ends 24px above the bar
and its bottom fade grows to 80px so content softens toward the bar. In the
chat the transcript's bottom padding is `--composer-lift` + `--composer-gap`,
so the last row is 24px over the bar. At a page's end nothing is under the bar. Layers: the bar is `z-10` on
the frame, outside the masked scroller (the blur needs it), under the
overlaid sidecar (`z-20`), the sheet, popovers and dialogs; with the floating
sidecar open it shifts with the column and stays on its center line, never under the panel.

**Seams left open** (docs/composer.md (h)): prefill from page actions (W6).

**Tags** (`EntityChip`, `components/entities/`). Everywhere a typed reference
shows in text (comments now): the type's 14px icon (task `CircleCheck`, project
`Folder`, library `Library`, comment `MessageSquare`; an agent its 14px `AgentAvatar`, no icon) and its live title in
primary on a soft primary tint (10%, 15% dark), `xs` corners, 4px side padding,
medium 13px; a person reads "@Name" with no icon. What is stored is the bare
token `<type>:<id>` (`ENTITY_TOKEN` in `@otto/shared/entities`, the same regex
the server finds mentions with), never a label, so a rename shows everywhere.
A chip with a page (task, project, library item) is a button that opens it
(hover `primary/15`, `/20` dark, the inset focus ring); a person and a comment
are plain. While its list loads a chip reads its type ("Task"); once loaded
without it, a muted "Unavailable" on `foreground/5`. `EntityText` draws markdown
(the app's renderer) with every token outside code as a chip; the composer's
editor draws the tokens it inserts the same way (Composer, Mentions). Chips read the
shared lists only; the surface that draws them loads them once
(`useEntityData`). Tag text on its tint is 3.5:1 in light (4.4:1 dark), a known
tradeoff of the sky tone. A chat's title is plain text (a
header, a row, the palette, the window title draw no chips): the title made from
its first message drops the tokens (`sanitizeForTitle`), so a chat started from a
task reads "What is left here?", not "task:<id> What is left here?".

**Dictation** (v1's, `transcription:create`). The mic is the main button
while the composer is empty, in every look. While listening the composer row
(the compact bar: in place of the text) shows × (Cancel, Esc), the level as 4px
bars 2px apart, the elapsed time (m:ss, tabular numbers, against Done) and Done (↵).
The waveform fills the row between × and the time (in the compact, expanded and
full looks alike; the field and its placeholder are hidden, the row is 32px
and nothing around it moves, and a blur does not collapse the bar). The bar
count comes from the measured width (`barCount`, a ResizeObserver). The bars
start flat (a row of 4px dots) and rise only with the live mic level; the
speech range (up to ~6 kHz, `barScale`) spans the width, mirrored from the
center. With reduced motion the level steps four times a second and nothing
glides. Done stops the recording; the row reads "Transcribing…" and the main
button is `loading` (its label unchanged) while the server transcribes it, then
the text is typed in at the cursor (a space before it after a word). A failure
is a toast, no retry action ("Unable to transcribe", "No speech detected",
"Connect OpenRouter to dictate", "Allow microphone access to dictate", "The
recording is too long to transcribe") and the recording is dropped; Cancel
drops it too. Electron: the main window's session grants `media` only to the
app's own pages and only for audio (never camera or screen), asking macOS first
(`askForMediaAccess`); the build has `NSMicrophoneUsageDescription` and the
`audio-input` entitlement. A packaged macOS build can only be checked signed.

*Note (Composer as built).* The floating chat below and its Morph are v1's
design, kept for reference: the compact bar is now the shell's `Composer` on
every page with no exclusion, and a send from it opens a new chat as a page
instead of growing into a window (docs/composer.md, open question 3). What
still applies from it: the bar's size, the Notifications icon (W5, now a list in the
composer's own surface) and prefill from page actions (W6). The bar no longer
wears the glass: every look has v1's full composer surface.

**Floating chat** (`FloatingChat`). On every page but Chats (and in the file
viewer): one row at the bottom, kept one line tall so it never covers the
page, floating 16px above the bottom: the compact composer as a 40px, 450px
bar (the 728px column ÷ φ), "Ask {agent} about this task / page" (the picked agent's name): +, the text,
Chats (a red dot while any need you) as a ghost button before the main
button, shown only while the bar is empty. Bar and window wear the command
palette's surface: dark, translucent (popover at 70%), blurred. Attachments
in the bar and the window are 28px chips: a 20px thumbnail, the name cut in
the middle, and remove (in the embedded composer, 4px corners and a 2px
thumbnail corner, to nest). Sending starts a chat with the picked agent in the page's
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
rows like the sidebar's, with no composer; a row opens that chat), New chat (who it's with: the default agent
unless picked), Minimize, Open as a page and Close. Minimized, the bar reads
"Reply to {agent}" and shows the chat's status and title, which reopens it; the
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

**Activity** (`ActivityFeed`, `components/comments/activity-feed.tsx`, data in
docs/activity-notifications.md: comments and events are `comments` rows told
apart by `type`). On a task (and a project) under the description, flat inside
its centerpiece, no cards (Otto v1's timeline): the section title "Activity"
(heading step, medium), 12px above one chronological feed, oldest first, items
16px apart, along one 1px `border` hairline under the markers (it runs from
each marker to the next and stops at the last; markers are ringed 4px in the
surface color, `--activity-bg`, the card's by default). The newest 50 show;
"{n} earlier" (28px ghost, `ChevronUp`, above the feed; the count is the
server's `earlier`) loads the 50 before. Blocks sit 16px apart; consecutive
events run together, their lines 8px apart (`layoutActivity`,
`activity-feed-model.ts`). **Events** are quiet single lines: the actor's 20px
`ActorAvatar` on the hairline, then one muted 13px sentence 40px in with the
name and the values in the text color: "Maria created the task", "changed the
status from ○ Todo to ⊙ In progress" (each status with its 14px
`TaskStatusIcon`), "renamed the task from … to …", "set / changed the due
date (from Oct 1, 2026) to Oct 21, 2026", "removed the due date", "moved the
task from Billing to Hiring", "assigned / unassigned" the people each with a
16px avatar, "added / removed the link …", "logged 1h 30m"; then " · " and the
compact time (12px, tabular, kept with its dot on one line; the full date on
hover). Event lines use the person's name, never "You" (the sentences are
third person in every locale). Events cannot be edited or deleted and never
notify. **Comments**: each the author's 28px avatar (an agent its
`AgentAvatar`) on the hairline, 12px, then the name in the transcript's rules
(Chats > One chat: the author's palette color, "You" in the text color for
your own, an agent's "Agent" tag), the compact time ("now", "5m", 12px muted
tabular) and "Edited" (12px muted) when changed after it was sent, on one 20px
line, the markdown 4px under it (`EntityText`, the outer paragraph margins
trimmed so the text starts on the line). Your own comment has a right-click
menu (a long press on touch, the menu key when focused; never a ⋯): Edit E and
Delete ⌫ (red). Edit swaps the content for the textarea with Cancel (28px
ghost) and Save (28px primary); a comment edit is submitted, never autosaved;
⌘/Ctrl+Enter saves, Escape cancels, a `conflict` toasts "Changed elsewhere,
reloaded" and keeps the draft open.
Delete asks first (Alert dialog, "Delete comment?"), then toasts "Comment
deleted". Nothing yet: the muted line "No activity yet". Loading: two 40px
skeleton rows. **The comment box** ends the section, 8px under the feed: the
stock `Textarea` ("Leave a comment…", the input well, one line that grows to
240px; read-only while sending) and under it Attach on the left (28px ghost
icon, `Paperclip`, tooltip "Attach file"; the picked files go to the Library
and their `library:<id>` tokens into the text, drawn as chips once sent;
spinner while uploading) and Send on the right (28px primary, `loading` while it sends, disabled while
empty; its tooltip shows the label and ⌘↵ / Ctrl+↵ as a `Kbd`). A sent comment
shows at once (the hook reloads) and for everyone else through the live push;
a failure toasts and keeps the text. **Mentions**: typing `@` (at the start or
after a space) opens the people list (the menus' look, `menu-styles.ts`, as wide
as the box up to 288px, under it or above it when there is no room): 28px rows
of the 20px avatar, the name and the muted email, the people of the workspace
but you (agents are not mentioned: they get no notifications), matched on a word
start of the name or email; ↑↓ move, Enter or Tab picks, Escape closes it.
Picking puts the person's token `user:<id>` and a space in place of `@query`:
the box shows the raw token (the leanest that works), the sent comment the
"@Name" chip. Replies and reactions are not built.

**Home** (`HomePage`, `pages/home/`, `/{ws}/home`; `/{ws}/inbox`, the old
Inbox, redirects here; the sidebar's mark and Home row, `nav.home`): where a
day starts, on the photo wallpaper (Home wallpaper). No title row: the head is
the greeting, centered, 128px down (88px on a phone, under the menu button):
the time of day with your first name, `text-xl` (26.75px) medium muted ("Good afternoon,
Ana": morning from 5:00, afternoon from 12:00, evening from 18:00 and through
the night; the first word of your member name, never an email; without a name
just "Good afternoon"), then "What should your agents work on?" the same
size in `foreground` (`home.*`, every locale). 20px under it the shell's ONE composer,
full and centered (Components, Composer, Centered): sending starts a chat as
anywhere and the composer glides down into it. 40px under the composer four
cards in a 2 x 2 grid (one column below the panel's `xl`, 12px apart), each a
`ListCard` with a 36px title row (14px muted icon, title, `Count`, a compact
ghost View all to the full page) and a FIXED height (320px; 280px on a phone)
whose list scrolls inside it under the edge fade, so the cards never move the
layout; empty, the card keeps its height and centers one muted line. Rows are
the lists' own 44px `ListRow`s with their right-click menus (never a ⋯):
- **Tasks**: your open tasks (to do or in progress) and your agents', the
  soonest due first (none last), then the most recently updated
  (`selectMyTasks`); the status icon, the title, the project as an outline
  badge, the due date.
- **Chats**: the ones waiting on you, then unread, then the rest, newest
  message first, archived left out (`rankChats`, the composer's list keeps
  the first two kinds).
- **Notifications**: your unread ones, the Notifications list's rows.
- **Routines today**: a timeline of today in your timezone
  (`getRoutinesToday`): each routine's latest run since midnight that ran or
  is running (any trigger; a skipped one did not run) with its status icon,
  and each active schedule's next run from now to midnight (the cron read in
  its own timezone), earliest first, the time at the end.
The rules are pure functions in `home-rules.ts`, tested on the day boundary
and timezones.

**Notifications** (`NotificationsPage`, `pages/home/`, `/{ws}/home/notifications`,
Home's Notifications card's View all; Back returns to Home): your notifications
in the workspace, newest first, a blocks page titled "Notifications" with one flat list
in the `ListCard` (the grouped list's 44px rounded `ListRow`s outside a group,
8px in, the icon on the 16px line; no band, no hairlines; glass on the wallpaper): the sender's 20px `ActorAvatar` in the icon column, one line,
"Maria mentioned you in Fix login" / "Maria assigned you Ship v1" (the title
looked up live, the server's while the lists load, "Unavailable" when gone),
after a mention the comment's first line muted 8px after it (tokens as names,
markdown marks dropped), the 6px primary unread dot, the compact time in the
end column; read rows at 80%. A row opens what it is about (a mention: the task
or project its comment is on) and marks it read; its right-click menu (a long press on touch) has Mark as read /
Mark as unread U and Clear (no confirmation: it removes the notification, not
content). The title row: Mark all as read (28px ghost icon button, `CheckCheck`,
tooltip; disabled with nothing unread; an icon so the title keeps its room on a
phone) and Filter (one on/off field, Unread, in `?unread=1`, its chip under the
title while on). Loading: three `ListRowSkeleton`s in the `ListCard`. Nothing at all: only the
stock `Empty` ("No notifications yet", no button; no title row or actions); Unread with none:
`NoResults`. New notifications arrive live (the `notifications` push), in the
list and the sidebar's count.

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
  message; on hover, keyboard focus or an open menu only Pin and
  Archive. Hovering a title shows a card: the title, what it is, then a divider,
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

- **Messages** follow one pattern for everyone, people and agents, like
  Slack, all on the left (`ChatDisplay`, `chat-message.tsx`, the layout rules
  in `chat-transcript.ts`): a group opens with the author's 28px avatar
  (`MessageAvatar`: a person's `ActorAvatar` initials, an agent's
  `AgentAvatar`), then the name, an agent's "Agent" tag (10px on muted, Slack's
  APP) and the time ("3:42 PM", 12px) on one 20px line (`MessageHeader`), then
  the messages. Consecutive messages by one author less than five minutes
  apart join the group; a day divider, the "New messages" line or a system row
  ends it. A row inside a group keeps the 28px gutter, where hovering shows its
  time ("3:42", 10px, not on touch). Your own messages are the same, never
  right-aligned, never a bubble: your avatar, but the name is "You" (`members.you`,
  never your own name) in the plain text color (`authorNameClass`), while other
  people keep their name in their palette color.
- **A person's message** is plain text (`UserMessage`: markdown, line breaks
  kept, `EntityText` chips), its attachments above it (image thumbnails,
  document chips on muted), queued ones led by the Clock "Queued" chip.
- **An agent's turn** keeps Craft's turn card under its header, unchanged: the
  steps line (count, live preview, the folded tool steps), thinking, plans,
  intermediate text, the response with Copy, Markdown and Branch. With several
  agents in a chat each turn is its own agent's (a row by another agent starts
  a new turn and header). Rows from before multiplayer have no author: a
  person's message is the creator's, an agent's turn the chat's agent's.
- **System rows** (errors with Retry and details, info, warnings, auth
  requests) sit in the text column without a header, styled as before.
- **Names** carry an assigned color each, people and agents alike: six hues
  tuned per theme (`messageAuthorColors` in design/ui `message.tsx`, never the
  primary blue), picked by the actor's stable FNV-1a hash (`actorColorIndex`),
  so an author has one color in every chat and on every device. Two authors
  may share a hue; the avatar and name still tell them apart.
- **Mentions** are `EntityChip` tags; one that mentions you is filled in
  primary (white text), like Slack's highlight, in chats and comments.
- **Rhythm**: a group opens 16px below the one before (`pt-4`), rows inside it
  4px apart (`pt-1`), system rows 8px; day and unread dividers sit 16px below
  the row above.
- **Day dividers**: the separator `Marker` (Today, Yesterday, then the weekday
  and date, with the year when not this year), its 12px label soft like the
  lines, with a 1px highlight below; one above the first shown message.
- **New messages**: the `Marker` `unread` variant (12px medium, label and lines
  in the destructive red) above the first message someone else wrote after
  your read marker as the chat opened; it stays while the chat is open (opening
  marks it read). None when nothing newer is from someone else.
- **Live state**: each running agent turn shows, under its own header, the
  working line: a spinner on the steps line's column, "{name} is working…"
  (the agent's name from state), then playful lines every 10s with the name
  line every third, and the elapsed time. Before the turn's first row it opens
  the chat's agent's header with that line (no header in a people chat). No
  typing indicator for people.
- **Files** in messages are attachment chips that open the file viewer, which
  steps through everything shared in the chat.
- **Questions** from agents: a compact card (stock small `Card` at 12px): the
  question, then the choices as one bordered list of 40px rows split by
  hairlines (number keys pick), then Send on the right. Answered, it keeps the
  question and the picked row.
- **Scroll to end**: a 28px outline button with its label, on the card color
  with `shadow-md`, 8px above the composer, shown once you scroll up.
- **History**: a chat opens on its newest 50 messages (the last 20 turns
  shown), at its end; scrolling to the top shows 20 more turns, then loads the 50
  messages before them from the server, in place. A muted centered line
  "Scroll up for earlier messages (N more)" sits above the first turn while
  there are more. Only rows within 1500px of the viewport render
  (`WindowedRow`): one farther away keeps its measured height as an empty box,
  so a long chat's DOM stays flat (1500 messages paged 8 times: about 1.5k
  nodes, 9.4k without) and the scroll never moves. In-chat search renders every
  row while it is on.
- **Panel**: Project (a link for general chats and sub-threads, else a
  picker), Members (people, then agents; Add member) and Files shared in the
  chat, hidden until something is shared. A project's panel lists its chats.

**Routines** (automations; this was the "Schedules" design): built as the
Routines index and the Routine page (Page anatomy). Not built yet from that
design: picking the agent and the chat a run posts to, Repeat presets, an
Activity timeline and the next run. Routines are deleted (asked first), not
archived.

**Settings** (from the profile menu), as lean as the MVP allows: a left
panel like Chats', Account (Profile, Notifications, AI, Connections,
Agents) then Workspace (General, Members). The theme stays in the profile
menu; usage and activity wait for a Reports page. Each section is a page
titled with its name: optional h2 sections (Activity's size), each a 12px
card of rows split by hairlines. One row pattern: what it is and a line on
it on the left, one control on the right; rows listing things (agents,
members, connections) lead with their avatar or icon. Controls nested in a
row are 28px with 6px corners: a switch, a choice (an outline `compact`
button opening a radio menu, as Appearance in the profile menu), a text
field, or a `compact` button. Everything saves as you go, no Save button: a
change waits 800ms for the next (`useAutosave`, see Autosave), blur or leaving
saves at once, and a value flipped back sends nothing. Every save shows the
"Saved" toast, one at a time: saves close together refresh it.
Deleting sits last under "Danger zone" and asks first. Adding an agent or a
connection asks an agent; a member is invited from Settings › Members (below).

**Members** (Settings › Members, `members-settings-page.tsx`; rules in
`members-rules.ts`). Two sections in the settings anatomy, no wrapper. **Members**:
one row per person, owners first, then by name: the 32px `ActorAvatar` in the
row's icon tile, the name (medium; a muted "You" after your own) over the email
(muted), then the role and a 28px ghost ⋯. Owners change any role in a 28px
`Select` (96px wide so the column lines up; Owner, Member); everyone else sees an
outline `Badge`. The ⋯ holds Remove on someone else's row (owners only) and
Leave workspace on your own; rows with neither keep an empty 28px slot. Remove
and Leave ask first (`AlertDialog`, the destructive tile with `UserMinus` or
`LogOut`; "Remove member?", "Leave workspace?"); leaving opens another workspace
(or `/` when there is none). The last owner cannot leave, be removed or become a
member: the action toasts "A workspace needs at least one owner" without asking,
and the server's `conflict` says the same. **Invitations** (owners only): "Invite
member" (the create "+", 28px) ends the section's title row; rows are the email
over "Expires in 6 days" (whole days, rounded up, at least 1) with a `Mail` tile
and a ⋯ of Copy link and Revoke (red); none reads "No invitations yet" in the
card. Invite member is a dialog: an email field and Create link; then the same
dialog shows the link in a read-only field with Copy, under the note that the
link is a secret (whoever has it can join as that email); no mail is sent. Role
changes, Revoke and Remove apply at once with the shared toast ("Saved",
"Invitation revoked", "Ada removed"); Copy says "Link copied". Errors toast by
code (`forbidden`, `not_found`, `conflict`); in the dialogs they stay open and
say it in place.

**AI** (Settings › AI, `pages/settings/ai-settings-page.tsx`; connections speak the
Pi provider model, docs/pi-only-plan.md B4). Sections in the settings anatomy:
**Defaults** (the person's default connection, a select over every connection
they see, saved at once as `userDefaultConnectionSlug`, and the thinking level),
**Connections**, Workspace overrides and the decision model.
- **One list** of the connections the person sees, no "Your / Workspace" split:
  their own (`user:`) first, then the workspace's, then the server's, each by
  name. A row is a `list` `SettingsRow`: the provider's logo in the icon tile, the
  name with an outline "Default" badge on the person's default, and the line
  "Kind · Scope" ("Claude subscription · Personal", "OpenRouter · Workspace",
  "Custom endpoint · localhost:11434 · Personal"). A problem leads that line
  ("Claude Code not found", "Not authenticated"), never a badge, so a phone row
  keeps the name. Empty: one row "No connections yet". The section's "+" is the
  create button, "New connection".
- **Row actions**: a 28px ghost ⋯ (Set as default, Sign in again for ChatGPT and
  Copilot, Change API key, Test connection, then a red Delete asked first with
  the stock destructive dialog, "Delete {name}?") and a 28px ghost chevron that
  opens the editor (turns 90deg). A shared connection (workspace, server) has
  Set as default and Test for everyone; its editor, Change API key, Sign in again
  and Delete are for owners. **Test connection** takes seconds: the ⋯ is `loading`
  (spinner, same width) meanwhile, then the result leads the row's line for 8 s
  ("{name} works", or a short message mapped from the failure: never the
  provider's or the subprocess's raw output, which stays in the server log).
- **Editor** (rows under the connection's row, split by hairlines), everything
  autosaved with the "Saved" toast (`useAutosave`): Name (a 200px input, an
  emptied name springs back), for a custom endpoint the Base URL (saved only
  while it is an http(s) address), Model (the connection's default, a settings
  select), Mid-stream sends (Steer immediately / Queue until ready); a Claude
  subscription starts with its status row (below). **Change API key** is a form
  dialog (TanStack Form): one password field, tested against the provider, then
  it replaces the stored key; the old key is never shown.
- **Adding** (`OnboardingWizard`, the same flow as the first run, full-screen
  over Settings with the 32px close and Esc): `StepFormLayout` steps, a choice
  card then a form. The choices, in order: **Claude subscription** ("Uses your
  own Claude Code sign-in on this machine"), **Anthropic API key**, **ChatGPT
  (Plus/Pro)**, **OpenRouter / other providers** (a provider select and its
  key) and **Custom endpoint** (name, base URL, "Compatible with" OpenAI or
  Anthropic API, an optional key for a local server, models separated by commas
  with the first as the default). Key forms are TanStack Forms, validated on blur
  and on submit; "Connect" is a `loading` button that keeps its label; the key is
  tested first and a refusal shows under the fields. A key form has an "Available
  to" select (Just you, Everyone in this workspace) for workspace owners only;
  everyone else's connection is personal. Copilot is never offered as new (only
  "Sign in again" for an imported one).
- **Claude subscription step**: no secret, no token field, never asks for a
  token. A card with a status row (a green check and "Claude Code found" with its
  version, or a warning and "Claude Code not found") and an outline `compact`
  "Check again" (`loading`); the server runs `claude --version` (the
  `claudeCode:getStatus` channel, any member) where `claude` is `OTTO_CLAUDE_PATH`
  or on PATH. A "Personal" row ("Only you can use it") and a muted note: it runs
  on the person's own Claude account, so Anthropic's terms apply and Anthropic
  bills the usage. When not found a second note says how to install and sign
  in, and "Connect" stays disabled. A Claude subscription is personal only (the
  server refuses any other scope); ChatGPT is personal too (its sign-in is staged
  under the person's own scope).
- **First run** (`first-run-setup.tsx`) shows the same choice step with a muted
  "Skip for now"; on Windows, Git Bash is asked for only when a Claude
  subscription is chosen and it is missing.

**Agents** (Settings › Agents, `pages/agents/`; docs/final-plan.md 2.7; built
A2). The settings sidebar's Workspace group ends Agents (`Bot`), Skills, Sources.
- **Gallery** (`AgentsPage`, `/{ws}/settings/agents`): the Skills grid's anatomy.
  The title row is "Agents" and the create "+" ("New agent") alone, no Filter
  and no Search (a workspace has a handful; YAGNI); "+" prefills the composer
  with "Create an agent named " and an agent creates it. `Gallery columns={4}`
  of 4:5 tiles in the server's order (the default, the oldest, first): the
  avatar in the tile (32px), under it two centered caption lines, the model
  (the provider's name when the model is the connection's default) and "3
  skills · 2 sources" (`[]` counts all), and the title under the tile; the
  default agent's tile carries an outline "Default" `Badge` 8px inside its
  top-start corner (`GalleryItem badge`). A tile only opens the agent. Loading
  is four `GalleryItemSkeleton`s; none at all is the stock empty page ("No
  agents yet", "New agent"; rare in practice: the server seeds one).
- **Avatar** (`AgentAvatar`, `components/people/agent-avatar.tsx`): no mascots.
  Empty `avatar` is generated from the id with the actors' FNV hash: one of six
  filled Lucide shapes (circle, square, triangle, diamond, hexagon, star) at 70%
  foreground on one of `ActorAvatar`'s four status tints, so it is the same on
  every device; `library:<id>` is an image uploaded to the library's root,
  drawn over the generated one (which shows while it loads or if it fails).
- **An agent** (`AgentPage`, `/{ws}/settings/agents/{id}`): one roomy column, no
  tabs, the floating navigation like a skill's (Back to the gallery, Previous /
  Next in its order). The title row is the name, the outline "Default" badge
  on the default agent, and More actions: Copy link (C), then Delete (⌫) apart,
  asked first ("Delete agent?"), back to the gallery after; Delete is absent
  for the last agent and for anyone who may not edit it. Sections, each a
  `PageSection` over a card: **Profile** (Name, a 200px input in its row, at
  most 80, an emptied name springs back on blur; Avatar, the 32px avatar in the
  row's tile with "A shape made from this agent." or "An image from your
  library.", an outline "Upload image" (images only, at most 5 MB, `loading`
  while it uploads) and a ghost "Use generated" while an image is set);
  **Instructions** (the card is the field: a borderless textarea 16px in,
  growing with its text, at most 20,000; the section's line says they come
  after the workspace's); **Model** (three settings select rows, Provider (the
  providers of your own connections, the agent's own listed too when you have
  none of it; changing it resets the model), Model ("Default model", the
  connection's, then the provider's models) and Thinking (Off to Max), and a
  muted note row "Runs on each person's own {provider} connection.", plus "You
  have none yet." when you have none); **Skills** and **Sources** (checklists,
  "Can use 3 of 8 skills." or "Can use every skill.": "All skills" first, then
  each by name with its icon, the whole row toggles; `[]` is all, so "All" on
  cannot be turned off and the last allowed row cannot be unchecked; none at
  all is a "No skills yet" row); **Computer** (one row "Screen", "See this
  agent's computer live.", with a ghost "Open" button: it asks the server for a
  one-time link and opens it in the browser; any member may; an error, such as
  no computers on this server, is a toast). No Description field (dropped by the
  owner) and no Routines section yet.
- **Saving**: the whole page is one autosaved draft (`useAutosave` with
  `ms: 600`, BB's wait, the one exception to 800): typing, picks and checks all
  save 600 ms after the last change, a field's blur at once, with one "Agent
  saved" toast; each save sends only what changed with `expectedUpdatedAt`, a
  conflict reloads. No Save or Cancel. `pages/agents/agent-fields.ts` is the one
  place that maps the UI to the agent's columns (draft, patch, subtitle,
  provider and model choices, the `[]` = all lists; skills and sources are kept
  by slug until they are rows).
- **Who changes it**: its creator and the workspace's owners (the server guards
  it too); everyone else sees the page read-only, with "Only its creator and the
  workspace's owners can change it." as the lead line.
- Not built: the composer's "With" picker and the agent's avatar in the chat
  header and the chat list.

**Empty states and 404.** `EmptyPage` is only for when a place has nothing at
all (no tasks, not "no matches"). It replaces the whole page, title and
actions included, with the stock `Empty` centered both ways: a 32px muted tile
holding a 16px icon, a heading-size title, one benefit-led sentence of
description (the header is capped at 320px, so it wraps) and one 32px primary button ("New task", "New project", "New routine",
"Add to library"…).
Every main section starts this way, with the floating chat there as on any
page: the button starts the sentence in it ("Add a task to ", "Every "),
never a form; a person's own action (Upload file) sits beside it. Missing pages and records use `NotFoundPage`
(see Not found below).

**Not found.** A URL with no page (an unknown path, workspace, chat, skill or
source) shows only the stock `Empty` centered both ways on the plain page
background: no sidebar, header, floating navigation or title row, and no shell
around it. A `FileQuestion` icon in the 32px tile, "Page not found", "The page
you are looking for does not exist or has moved." and one 32px primary "Go home"
button, which replaces the URL with `/` (the active workspace's Chats). No "Go
back": the browser's or Electron's own Back works. The URL stays as typed.

**No results.** When filters match nothing, the page, its header and the
filter bar stay; the list area shows the same `Empty` shape: the filter icon
tile, "No results", "Try changing or clearing your filters.", and an outline "Clear filters".

**Filters** (`FilterMenu`, `FilterBar`, `NoResults`; one shared set). The
header's Filter button (a 28px ghost icon button, pressed while any filter is
on) opens a menu with a submenu per property (Chats: Status, Labels, then
Flagged and Archived as on/off items; Tasks: project, assignee, status, then
Archived; Documents: created by, project, label, visibility; Files: type,
project, label, made by). A submenu lists the options with their icons and
counts as checkable items: several can be on (the check is what is on, picking
it again turns it off), and adding one never drops the others. Fields AND
together, the values of one field OR together. Filters live in the URL and
are never saved. While any is set, a filter bar sits under the title: one
28px chip per field (`sm` 6, the outline button's card fill and hairline,
segments split by hairlines): the property (icon and name, muted), "is" (or
"is any of" with several values, muted), the values (their icons, then the
labels joined by commas), which open the property's checkable values to add
or remove one, and a 28px × that removes the whole property. Chips are 6px
apart and wrap.

**Command palette** (`CommandPaletteProvider`, `components/command-palette/`).
One palette for the whole app: ⌘K / Ctrl+K anywhere (it toggles; it never opens
over another dialog or menu), the sidebar's Search row, or a page header's Search
(`CommandPaletteButton`) with the page's category already selected
(`useCommandPalette().open(category?)`).
- **Anatomy.** A `CommandDialog`: 720px wide (on a phone the width minus 16px
  each side), 15% from the top, `xl` 12 corners, the floating surface's dark
  glass (`bg-popover/70`, blur, `ring-foreground/10`, `shadow-md`) in both
  themes over the dialogs' plain 50% black overlay. Top to bottom: a borderless
  48px search field (placeholder "Search", the 14px search icon on the rows' icon
  line) over a full-width `foreground/10` divider; the category tabs (the shared
  `Tabs` `size="compact"`: 28px ghost triggers 4px apart, the open one `foreground/10`, 8px above
  and below, text 16px in); the list (at most `min(400px, 60dvh)`, `scroll-fade-y`,
  no scrollbar): 36px rows, `md` 8 corners in the list's 4px padding, 16px content
  inset, a 14px icon (a bare glyph, never a tile, avatar
  or background; a skill's or source's own emoji or image at 14px, else `Shapes` or
  `DatabaseZap`; one slot, so all share size, left offset and gap; a chat shows its
  bare status icon), 8px, the title in `text-sm`, and at the end a chat's
  12px muted time, a task's project or a library item's folder (muted, at most
  40% of the row, truncated), an action's `Kbd` or the check of what is on; group headings
  (12px medium muted, 16px in) only in All; a 48px footer with the keys as `Kbd`
  (↑↓ Navigate, ↵ Open, Tab Category, Esc Close), hidden on phones.
- **States.** The highlighted row (arrow keys or pointer) is `foreground/10`, no
  ring. A search that finds nothing anywhere shows the compact empty state (the
  32px icon tile with a search icon, "No results for “query”", no period) and no
  tabs; one category with no match shows the same state under the tabs. An
  empty category gets no tab (nor does anything but All when no other has
  entries). Results follow the query after the shared 800 ms debounce
  (`DEBOUNCE_MS`), with skeleton rows while waiting: stock `Skeleton`s
  drawn like the real rows (a 28px heading line in All, three 36px icon and title
  rows, 16px in, `xs` radius); the tabs keep the state of the last results, and
  ↑↓ do nothing while waiting. Enter while waiting only skips the wait (it shows
  the results and picks nothing), so a row is never picked from results that were
  not on screen. An empty query shows Pinned and Recent at once.
- **Server search.** From two characters, the settled query also goes to
  `search:run` (one RPC: the caller's own chats' messages through `messages_fts`,
  tasks and projects by title and description, library items by title, comments
  by text, at most 25 of each). What it finds in the Chats, Tasks, Projects and
  Library categories is merged into the stores' rows: a row the title does not
  explain is kept after the title matches and shows the text around the match as
  a muted snippet after its title (the title takes at most half the row, the
  snippet the rest, truncated, entity tokens dropped; the time or project stays at the end);
  a comment counts for its task or project. The rows wait (skeletons) for the
  answer as for the debounce; a failed search leaves the local rows. This is how
  the Chats page searches content: its header Search opens the palette on Chats.
  The page has no search box of its own (`searchActive` stays off).
- **Categories and data** (matched on the debounced query; nothing is fetched
  for the palette itself, it reads the stores the pages use, `useTasks`,
  `useProjects`, `useLibrary`, which load on open when the page was not visited):
  **All**, then **Chats** (the workspace's chats from the sessions store: its status
  icon, title, relative time; archived last; opens the chat), **Tasks** (every
  task that is not archived, in the Tasks page's order: its `TaskStatusIcon`, the
  title, and its project's title as 12px muted text at the row's end; opens
  `/tasks/<id>`; archived tasks are left out everywhere, they are found on the
  page's Archived filter), **Projects** (active projects with the Folder icon;
  archived ones are left out; opens `/projects/<id>`), **Library** (every item,
  folders included: the type icon, as on the tiles, Folder, Document or File, the
  title without `.md`, and the folder path ("Brand / Assets") as muted text at the
  end, none in the root; a folder opens `/library?folder=<id>`, anything else
  `/library/<id>`), **Pages** (the
  sidebar's pages with its icons: Home, Tasks, Projects, Chats, Routines, Library;
  Routines are a page only: the palette has no Routines category yet), **Settings** (every page of `SETTINGS_NAV_GROUPS`
  with the settings sidebar's icons; Shortcuts shows ⌘/), **Skills** and
  **Sources** (the shell's loaded skills and sources with their own icon, bare (no avatar); opens
  their page), **Actions** (New chat ⌘N, Open settings ⌘,, Light, Dark and System
  theme with a check on the current one, Go back and Go forward while there is
  history, Log out on the web, Quit in the desktop app). The tabs run All, Chats,
  Tasks, Projects, Library, Pages, Settings, Skills, Sources, Actions. All lists
  each group's first 5 in that order under its heading (a task, project or
  library item that Pinned or Recent show is left out of its group); with an empty field it opens with
  **Pinned** and **Recent** (the sidebar's store, 5 recents), and its Chats group
  leaves out the chats they show. A tab lists its category in full.
- **Matching** (`palette-model.ts`, pure and unit-tested): case and accents
  ignored; a name that starts with the query first, then one with a word that
  does, then one containing it, then all the query's words in any order, then
  the initials ("ks" finds Keyboard shortcuts); equal matches keep their order
  (chats newest first).
- **Keys.** Focus stays in the field (the tabs take no focus), so typing always
  searches. ↑↓ move, Home / End jump, Enter picks and closes, Tab / Shift+Tab
  switch the category (wrapping), Esc closes, ⌘K closes. While it is open every
  other shortcut is paused. Closing returns focus where it was; a pick runs once
  the dialog has closed, through `navigate(routes.view.*)` or the action
  registry, so an action that moves focus (New chat) keeps it.

**Task list.** Groups by status in lifecycle order (`ListGroup` bands, see
Tasks index). Each row: its status icon (under the header's), the title, then
the assignees' avatar group (one tooltip lists them; there is no owner, the
creator shows on the task page), with the project badge and due date on the
right. Avatars in a group overlap 4px (20px ones 2px) behind a 1px ring, so the
initials of the one underneath stay whole.

**Detail pages** (`DetailView`). Tasks, projects and documents share one shape:
the top bar, then the page (optional cover, title, people row, body), the
right panel and the floating chat.

- **Task:** see Task page (Page anatomy): the title in place, "Created by", the
  description (markdown editor with `/` blocks), then Activity. Panel:
  Properties, Links, Time.
- **Project:** see Project page (Page anatomy): 32px tabs with muted counts
  (Overview, Tasks, Documents, Files) in `?tab=`; Overview is the description,
  Links and Members; Tasks is the task list without the project badge;
  Documents and Files are galleries. Panel: Properties (Status, Created) and
  its Chats.
- **Document:** cover when it has an image, the author as plain text (set by
  the server), the content in the editor. Panel: Project (or none) and
  Visibility (Only me / Workspace).

**Dithered images** (`Dither`, `Cover`). Covers and previews are drawn once in
the image's own colors with an 8×8 ordered dither in four steps, never
animated. Each dot is a whole number of device pixels (3 on 2x screens, 2 on
1x), so dots stay square and even at any size. `Cover` is a 4:1 banner above a
page title.

**Galleries** (`Gallery`, `GalleryItem`, `GalleryItemSkeleton`; built in
`design/ui` `gallery.tsx`). Not cards: a tile with its icon and
title under it; the ring darkens on hover. Projects are 16:9 covers;
documents are 4:5 pages showing their image or opening text fading out;
files are 4:5 showing their picture or their type ("PDF"). An image file's tile
shows its picture (`cover`: `object-cover`, filling the tile under the ring, read
through the library's read channel only once the tile is near the viewport, a
`Skeleton` until it shows; if it cannot be read the type tile stays). Until covers
and excerpts exist, a tile shows its type glyph centered in the
32px `icon-tile` and, for files and folders, a caption under it ("PDF", "12
items").

- **Grid**: `columns` 3 or 4; 12px between columns, 20px between rows. Columns
  follow the page column's width (`@container/panel`): 3 is
  one, two from 400px, three from 640px; 4 is two, three from 400px, four from
  640px (container queries read the 768px track; in the 720px content: 232px
  and 171px tiles).
- **Tile**: `ratio` `16:9`, `4:5` (default) or `1:1`; `bg-card` (one layer step
  over the frame: on the frame `muted` would vanish in light), `md` 8 corners,
  no shadow; its hairline an inset 1px `foreground/10` ring drawn over the
  content (a pseudo-element, so a scroller never clips it and a cover would not
  hide it). Inside, centered: the glyph in the 32px `md` `bg-muted` tile (16px),
  the optional caption 8px under it (12px medium, muted); an optional static
  `badge` (an outline `Badge`, the default agent's "Default") 8px inside the
  tile's top-start corner.
- **Title**, 8px under the tile: the 14px muted icon, 8px, the title (13px
  medium, foreground, one line, truncated), a 20px row.
- **The item** (tile and title) is one link or button (`render`). `menu` is its
  `ContextMenuContent` (the item's menu list): right-click, a long press on touch,
  the menu key by keyboard. **A tile never has a ⋯ button or a hover icon.**
  **A tile whose item has a page with its own More actions has no menu** (Skills
  and Sources, the owner's call): the tile opens the page and the actions live
  there, once. The Library's and Projects' tiles keep their menus for now.
- **States**: rest ring `/10`; hover, a menu open and
  `current` (the open item) ring `/20`, no fill and no lift (the tile never
  changes size); focus-visible a 2px inset `--ring` on the tile; `disabled`
  (pending or unavailable) 60%, no pointer, no focus; `muted` (archived) the
  title in `muted-foreground`, the tile unchanged and still a link; loading
  `GalleryItemSkeleton`, the same box: the tile as a `Skeleton` at the tile's `md`
  corners (it is tile-sized, so the skeleton's `xs` would read sharp) and a 14px
  title line at `xs`.

| Part | Size | Radius | Color |
| --- | --- | --- | --- |
| Tile | column width x ratio | `md` 8 | `bg-card`, ring `foreground/10`, hover / open / current `/20`, focus `ring-2` `--ring` |
| Icon tile | 32px, 16px glyph | `md` 8 | `bg-muted`, `muted-foreground` |
| Caption | 12px medium, 8px under the icon tile | | `muted-foreground` |
| Title row | 20px, 8px under the tile; 14px icon, 8px gap | | 13px medium `foreground`, icon `muted-foreground` |
| Gaps | 12px columns, 20px rows | | |

**File viewer** (`Lightbox`). Full screen on the page background, in two
full-height columns. The file: its 40px top bar (type icon, title, "Image ·
Oct 3"; Ask about this file, Open task, Download), then the file centered
with `md` corners and the ring, 48px from the sides where the previous and
next arrows sit 9px in (← → too, except inside a player). On wide screens a
280px details panel with its own top bar (Details, then Close in the
corner, like the panel toggle): one Properties list in plain words
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
Rename R, Move M, Copy link C, Pin P, Mark as done E, Archive A, Delete ⌫ (Backspace
or Delete); options with number keys pick by them too. Delete is always the
destructive variant: red text and icon, a red-tinted highlight.

**Alert dialog** (`AlertDialog`, stock shadcn, small; `useConfirm()`). The one
place an action asks first: Delete, always. shadcn's destructive example as
is: the bin on a red-tinted tile, then copy as plain as a toast's: a short
question naming what it is, not which ("Delete file?", "Delete account?"),
and one line ("This can't be undone."); Cancel and the action, red when it
destroys. The work runs inside it: the action is `loading` (keeps its label) while both buttons wait, then the dialog
closes and the toast says it is done ("“Fix plan” deleted"); a failure stays
open and says "Something went wrong. Try again.". A plain darker overlay, no
blur, like the dialog's.

**Forms** (TanStack Form, shadcn's pattern: <https://ui.shadcn.com/docs/forms/tanstack-form>).
One pattern for every form we build; copy `components/ui/rename-dialog.tsx`.

- **What is a form.** A dialog or screen with fields and an explicit Cancel / Submit
  (New project, New task, New time entry, Invite member, Rename; a link is added through the composer). Autosaved fields (the task
  title, a document, a setting that saves as you go) are never forms: they stay
  `useAutosave` (see Autosave). The comment composer and the chat input are send boxes,
  not forms.
- **Shape.** `useForm({ defaultValues, validators: { onBlur: schema, onSubmit: schema },
  onSubmit })` with a `zod` schema (zod is installed; never a second validator), one
  `<form.Field name>` per field whose render prop sets `isInvalid =
  field.state.meta.isTouched && !field.state.meta.isValid` (a blur validates the whole
  schema, so the gate keeps a field you have not visited quiet), then `<Field data-invalid={isInvalid}>`, `FieldLabel`, the
  control with `aria-invalid={isInvalid}`, `onBlur={field.handleBlur}` and
  `onChange={(e) => field.handleChange(...)}`, and `{isInvalid && <FieldError
  errors={field.state.meta.errors} />}`. The `<form>` is `noValidate` (our messages, never
  the browser's bubbles), its `onSubmit` is `submitForm(event, form)` (`@/lib/form`:
  prevent default, submit, focus the first `aria-invalid` field when refused), and
  Enter submits natively. A dialog's form is mounted only while open, so the fields
  start from `defaultValues` each time; the dialog's form lives in its own component.
- **Validation.** Schema messages are i18n strings (`common.required`, `common.tooLong`
  with `{{max}}`, or the field's own); limits are imported from the domain's `limits.ts`
  (`@otto/shared/projects/limits`, `@otto/shared/tasks/limits`), never retyped, and a
  limit is enforced by the schema, not `maxLength` (typing past it shows the message;
  a dialog's `Textarea` has `max-h-48` so a long value scrolls). Validation runs on blur
  and on submit, never on change (no `onChange` validator): typing never shows or
  triggers an error, an error already shown stays until the next blur or submit, and
  nothing shows on open. Fields
  that depend on another (a link's kind) add their issues in `superRefine`, only for
  what is shown, so a hidden field never blocks submit.
- **Submit.** `form.Subscribe` selects `isSubmitting` for the footer: Cancel and the primary
  button are disabled and the primary is `<Button loading>` (spinner, the label
  unchanged: Buttons, rule 6) while `onSubmit` runs. The primary
  is not disabled for an invalid form (a field not yet blurred has a hidden error that would
  disable it with no visible reason): submitting shows the errors and focuses the first
  invalid field. The dialog closes and the toast says it is done from `onSubmit`, as
  before; a failure keeps it open with what was typed.
- **Server errors.** A failure that names a field goes on it: `formApi.setErrorMap({
  onSubmit: { fields: { email: { message } } } })` with the message mapped from
  `error.code` (Invite member: `invalid`, `conflict`); it clears when the value
  changes. A failure about the whole action stays the toast it was (Create task:
  `tasks.errorUnknown`).
- **Fields.** 32px `Input`, `NativeSelect` and `Textarea` take the invalid state of
  Focus (red border and fill, no ring); the label of an invalid `Field` turns
  destructive and `FieldError` is `text-sm` destructive 12px below the control. A
  placeholder-only field (Rename, Invite member) has `aria-label` instead of a
  `FieldLabel`.

**Toasts** (stock shadcn `Toaster` and the one `toast` in
`@workspace/ui/components/sonner`; never import from `sonner` itself, so the
rule below holds everywhere: `success`, `error`, `info`, `warning`, plus
Sonner's own `loading` and `dismiss`). One plain row and nothing else: the
status icon in its color (a green check for done), a short sentence-case
message ("Link copied", "“Fix plan” deleted"; always one sentence with no period,
which the `toast` wrapper enforces), and Close at the end. On the
menus' surface in both themes with a card's 12px corners: Close is the 28px
ghost button 6px in (nested), the message 12px in and wrapping, so the toast
is as tall as its message (40px for one line); bottom right, lifted over the
composer: the page frame publishes the slot's height (0 with no bar) as
`--composer-lift` on the root and the `Toaster`'s bottom offset adds it (24px,
16px on phones), so a toast never covers the bar.
Copy link, Archive and Delete say they are done with one.
A list that fails to load stops showing skeletons, keeps what it had and toasts "Couldn't load. Try again" (one at a time).
No stylesheet restyles `[data-sonner-toast]` or hides its icon: the component's classes are the only look.

**Autosave.** What you edit in place has no Save button: task and project
fields, documents, settings. A change shows at once and saves 800ms after the
last one, on blur at once, and on leaving (an unmounted field never drops a
change); saves go one at a time and a value flipped back sends nothing. Every
save shows one toast, "Saved", with a single id so the next save replaces it
instead of stacking. A failure shows the error in the same toast and keeps the
draft with a retry. A save that finds the record changed elsewhere
(`expectedUpdatedAt`, error `conflict`) says "Changed elsewhere, reloaded",
drops the draft and refetches. A refetch or live update never overwrites a
draft with unsaved changes. All of it is `useAutosave`.

**Library** (built: `pages/library/`). Everything saved is a file: uploads,
task and chat attachments, and agents' outputs, canvases included (never
"artifact"); a document is a markdown file. ONE page, title "Library", like a
drive:

- **Tabs** All / Files / Documents (32px `Tabs`, `?tab=`), their labels on the
  title's 16px line; folders come first in every tab, then files, then
  documents, newest first, in a 4-column `Gallery` of 4:5 tiles (`LibraryTile`,
  reused by a project's Documents and Files tabs): a folder its folder glyph, a
  file its file glyph and its extension as the caption ("PDF"), a document the
  document glyph and its title without `.md`. No item counts or thumbnails yet.
- **Folders** (`?folder=`) nest at most eight levels. Inside one, a muted
  breadcrumb row (Library › Reports › Q3, 13px, 16px in) sits under the tabs,
  each step a link and the open folder in foreground; the title row stays
  "Library" (no crumbs in the title). A folder that is gone sends the page back
  to the root.
- **Title row**: Filter ("Created by": You, Agents; one at a time, in
  `?createdBy=`, chips in the `FilterBar`), Search (`CommandPaletteButton`: the
  palette on Library) and "+" (a 28px ghost icon button):
  Upload file (several, through a hidden file input; 50 MB each, a toast per
  failure, pending uploads as dimmed tiles), New document and New folder (a
  small dialog with Title and Create; a new document opens at once). All land
  in the open folder.
- **Tile menu** (right-click, a long press on touch): Open, Rename R, Move M (a dialog
  with the folder tree as 28px rows, the current folder preselected, places the
  item cannot go disabled), Copy link C (the item's app URL), then Delete ⌫
  apart (the Alert dialog; a folder only when empty, else the toast "Only an
  empty folder can be deleted"). Delete is real: no archive.
- **Empty**: nothing in the Library at all is the stock empty page (table
  below; no title row or actions) whose "Add to library" opens the "+" menu; an empty folder or tab is
  the inline `Empty` "No files yet" / "No documents yet" with one line and no
  action; a filter that keeps nothing is `NoResults`. Loading is eight
  `GalleryItemSkeleton`s.
- **An item** (`/library/{id}`, Back returns to the same tab and folder) is the
  title row over a `PageCenterpiece` and the "Details" sidecar (closed by
  default, toggled by the floating sidecar toggle): one Properties
  section of read-only rows, Folder (its path), Created by (avatar and name),
  Created, Size, Type. A **file** previews read-only: images, video and audio in
  the browser's players, PDFs in its viewer, HTML in a sandboxed frame with no
  scripts or network, markdown and text through the markdown renderer (text as
  a code block); over 8 MiB or a type with none, "No preview" and a primary
  Download. Its title row: Download, More (Rename, Move, Copy link,
  Delete). A **document** is edited in place, no Save button (Autosave): its
  title is the title row itself (an input in the title's type, Enter or blur
  saves) and its body the markdown editor (tables kept) in the centerpiece;
  opening one saves nothing (the editor reports only markdown that differs
  from what it serialized on open, so no "Saved" toast appears until an edit);
  More holds Download, Move, Copy link, Delete. Every save carries the
  `updatedAt` it last saw; a conflict says "Changed elsewhere, reloaded" and
  reloads the document. An id that does not exist is the not-found page; a
  folder's id opens the folder.

**Live data states.** Server reads use the shared skeleton (three full-width 40px rows, no
extra padding so they align with the page title; a list in a `ListCard` shows three
`ListRowSkeleton`s in it instead) and inline error with Retry; unavailable controls explain the missing capability and never
show success. The authentication boundary uses the stock Field/Input/Button
composition. Workspace switching clears prior workspace data and opens Home.
Account forms use a centered 336px column, 24px side padding and 64px vertical
padding, with the shared page-title typography and no logo. Labels stay above
their inputs; the primary submission spans the column and secondary account
actions center beneath it. Sign-in methods reflect configured backend support.
The browser sign-in page is the React route `/login` (`apps/webui/src/login-page.tsx`),
at the router's root like the not-found page: theme, i18n and the toaster around
it, never the app shell and never a WebSocket. Electron has no sign-in (the route is
not found there). It has no card: a left-aligned 336px (21rem) column with 24px side
padding, centered on the page layer (`--background`). Its header is the one every
first-run screen shares (**Sign-in header**): the colored app icon (never the mark)
as a 40px tile with `9px` corners (22.37% of the side, the iOS icon radius, not an
avatar radius) and a `foreground/10` hairline (`OttoAppIcon`). Below it, 20px apart,
the title in the heading token (`text-base`, weight 500, never the title size), then
4px below a muted `text-sm` line, all left-aligned. The form starts 20px lower and is
placeholder-only (no label; `aria-label` keeps the name): 32px `Input`s 8px apart;
password fields are an `InputGroup` with a nested 28px `icon-compact` ghost eye
button 2px in that shows or hides the value. Then one `text-xs` line 8px below the
fields, the full-width 32px primary button 12px below, and, for an invitation, a
full-width ghost button 8px under it. Enter submits, the first empty field takes
focus, the button is `loading` (disabled, spinner, "Sign in" unchanged) while the
request runs. A failure marks the fields it is about with the invalid state above and
puts the message in that `text-xs` line in `destructive`; while creating a password
the same line, muted, says it needs at least 12 characters. Messages are human per
error code (wrong email or password, account exists, owner email only, invitation needed
or used up, too many attempts, server unreachable). It is the TanStack form of **Forms**
(`noValidate`, each field validated on blur and on submit, never while typing; the first
invalid field takes focus; the button is `loading`, its label unchanged), and the
one `text-xs` line shows the first error in the order the fields are shown, so an empty
submit marks every field and says "This field is required." once. A field marked by the
server clears when its value changes. One page, three modes:

- **Sign in** ("Sign in", "Pick up where you and your agents left off."): email,
  password.
- **Create the owner account** (only while the server has no user, `GET /api/setup`):
  name, email, password (no token: the first sign-up wins, or only `OTTO_OWNER_EMAIL`
  may make it). Subtitle: "Create the first account to own this {{product}} server,
  then invite your team."
- **Join your team** (`?invite=<id>&email=<email>`, the owner's invitation link):
  the email shown read-only, name, password; "Sign in instead" switches to sign-in
  for that email ("Sign in to accept your invitation.") and back. Either way the
  invitation is accepted before continuing.

Success is a full page load of `?next=` (a same-origin path, never `//` or the
login page, else `/`), so the app starts with the session cookie.

**First-run setup** (`FirstRunSetup`, `components/first-run/`) renders at the app
root instead of the shell, like the sign-in and not-found pages (no sidebar), and only
to someone who can act on it (`getFirstRunStep`). Two steps at most, no step
indicator, no welcome or "all set" screen:

- **Name your workspace** ("One place for your projects, tasks and files, shared
  with the people you invite."): only when the person belongs to no workspace (a
  fresh server's first owner). One placeholder-only 32px `Input`, filled with
  "{first name}'s workspace", then the full-width primary "Create workspace" 12px
  below; a TanStack form (empty is "This field is required." under the field), a
  failure toasts. It calls `server:createWorkspace` (a folder under the server's
  workspaces directory; the creator becomes its owner, with the mirror row). On the
  web the app then reloads, so the socket connects with the new workspace.
- **Connect an AI provider** ("Your agents run on it. Sign in with a subscription,
  or use an API key or a local model."): only for an owner of the workspace while no
  connection is usable and nobody skipped. It is the connection wizard Settings → AI
  uses (provider list, sign-in, API key, local model; Git Bash first on Windows),
  plus "Skip for now", which sets `setupDeferred` for the whole server. A saved and
  tested connection opens the app at once.

An invited member always has the workspace they joined and is not its owner, so
they never see either step.

**Onboarding and workspace screens** (`StepFormLayout`: first-run setup, connection setup,
Select Workspace, add workspace) use the same header and the plain page layer:
`bg-background` with `text-foreground`, no card, gradient, dither or other
ambient backdrop, in light and dark. The block is a left-aligned column of the
step's own width (28rem), centered in the window, header aligned with the
content's left edge: icon tile, 20px, title, 4px, muted description, 32px, the
content (a `SettingsCard` or form), then actions. Full-width buttons under the
content stack main action first; a secondary action such as "Skip for now" stays
a full-width muted ghost button directly under the card (`mt-2`). The splash is not that tile: it shows the
mark debossed, pressed into the page and lit from the top left (never colored),
40px wide, centered on the page layer. The glyph is the recess floor: the
foreground mixed into the page, 35% in light and 28% in dark (about 2.3:1 and
2.4:1 against the page), so it is the foreground's family but sunk, never the
full foreground and never a ghost. The wall casts a shadow inside the top-left
edges (offset 1.4px down and right, 0.8px blur; black at 45% in light, 75% in
dark), the bottom-right inner walls catch a rim (0.7px up and left, 0.35px blur;
white at 90% in light, 35% in dark), and in dark a lip of light sits just outside
the bottom-right edges (0.5px, 0.25px blur, white at 14%; none in light, where it
would vanish on white). It is one SVG filter on `Logo` (`DebossedLogo` in
`splash-screen.tsx`), copied into the pre-load loader of both `index.html` files
with the same values, so loader and splash are pixel-identical: an inline script
in both `<head>`s applies the saved theme class (`otto-theme`, else the OS
scheme) before first paint, the loader fades the mark in (300ms ease-out) and
the splash continues that fade on the same clock if it mounts mid-fade, then
fades the mark out with a 1.04 scale (no scale with reduced motion). Error and success lines under the content are `text-xs`,
flush with the content's left edge (no extra padding), like the sign-in error.
A control that opens something outside the app ends with ArrowUpRight (trailing,
14px); never ExternalLink, never leading. In a menu item it sits at the right edge
(`ml-auto`).
The profile menu names the signed-in person and lists their accessible workspaces.
When direct setup or creation is necessary before an Agent can run, a compact
stock dialog may capture the backend's required fields. Ask remains available;
direct controls use the same tokens and do not simulate an Agent response.
Native selects use the shared 32px control, or 28px when nested, with the
corresponding 8px/6px corners. Task search and Notifications name one Project explicitly;
search requests five matches per group and uses whole words. Directory pickers
continue through bounded pages instead of treating the first hundred as complete.

## Do's and Don'ts

### Native runtime migration proof

The opt-in Mastra slices reuse the existing named-agent chat, composer,
streaming reply, tool cards, approval prompt and reconnect history. They
introduce no alternate chat layout. Library documents and tasks in existing
projects are the first work actions. Explore refuses changes, Ask and Guarded
ask for each write, and Execute allows it. Approvals apply only to the shown
call in that chat, not a permanent grant. Unsupported attachments and connected
sources fail visibly; shell and filesystem tools remain disabled. Pi remains
the default until work tools and controls are verified. API-key-only is the MVP direction;
subscription setup is removed when the default runtime cuts over, without
silently converting or deleting existing accounts. Document views continue to
support direct editing. Public sharing of chats, documents and other work
artifacts is deferred and will require explicit visibility, never inherited
workspace or agent access.

Native skills use the selected agent's existing workspace allowlist and load
instruction bodies on demand. They expose no host files, scripts or reference
folders as work capabilities. Explore omits mutation tools from the model as
well as refusing mutation execution.

Skills with metadata unsupported by the native runtime are excluded individually
with a warning naming the skill. They do not prevent an unrelated chat or change
stored names and content.

- Do change shared looks in the `packages/ui` component with an `// Otto:`
  comment; don't override colors or type on one instance.
- Do use only the spacing scale, the two insets, 32px bar controls and 28px
  rows and nested controls; don't invent values to make one screen fit.
- Do start cards on the column's edge and inset the title and section titles 16px
  to line up with the cards' content; don't wrap a
  surface in a surface or make anything wider than the column.
- Do save ordinary settings as they change (Autosave), with the one "Saved" toast.
  An agent's page autosaves too, as one draft ("Agent saved", see Agents); Skill
  content preserves fenced drafts until Save. Library documents autosave (Library).
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
  prompts; don't call a file a resource or a routine a schedule.
- Do check a visible change in the browser and measure it; don't ship from a
  screenshot guess.
- Don't nest tasks or comments, add subtitles to data-heavy pages, or use
  ellipses in placeholders.
- Don't put a more or three-dots (⋯) button on an item of a grid or a table or
  list (gallery tiles, `ListRow`s, sidebar rows, palette rows); give the item a
  context menu instead (`menu` on `GalleryItem` and `ListRow`: right-click, a
  long press on touch, the menu key), the same list and `Kbd` keys, and keep
  the actions reachable from the item's own page and keyboard shortcuts. The
  page header's More actions menu stays: that is a page, not an item. A hover
  icon on a row is allowed only as a real icon for one action (Pin, Archive).

### Live mention discovery

Composer mentions (Composer, Mentions) read the lists the app already keeps loaded: workspace people, tasks, projects, skills, sources and the working directory's files, at most three rows per kind until something is typed; a kind with nothing says "No tasks yet" or "No projects yet". There is no per-keystroke request for people, tasks or projects.

Command search omits empty result groups and the redundant Task scope label. Its placeholder is “Search”; an entered query with no matches shows a compact empty state (icon tile and “No results for “query””, no period) after loading completes. Search uses the shared 800 ms debounce and stock Skeletons for a category heading and three icon/title rows, matching result spacing while waiting.

### Accounts and workspace access

Authentication uses the real account service for sign-in, registration and password reset, with acknowledged results and request errors. Registration does not grant installation or workspace authority. A person without workspace access can accept a known invitation ID. Workspace selection loads additional server pages and clears the previous workspace cache before navigation. The profile menu omits workspace selection when there is only one workspace and no further page.

### Fenced configuration and content

Schedule configuration uses explicit Save/Cancel for one atomic change protected by the opening edit token; an agent's model, skills and sources autosave (Agents). Skill content and supporting Files have separate acknowledged fences. Failed or stale edits retain input. Unsupported decorative fields and fabricated activity are removed; Schedule timing shows the saved cron/timezone without guessing a next-run date.

### Real workflow controls

Task details show the server lifecycle Todo/In progress/Done, mixed assignees, occurrence links and human-owned manual time in whole minutes. Unsupported priority, review status, comments and decorative metadata have no mutable controls. Files and Documents retain folder/label organization and real creator identities. Avatar names come from the workspace directory; An `agent:<id>` actor is named by its agent's title and drawn with its own `AgentAvatar` (`useWorkspaceMembers().nameOf`, `ActorAvatar`), each agent distinct; only the legacy `agent:default` and an id that is no longer an agent show the default agent's name and the robot glyph. Identity color is a stable display value derived from its ID, not saved configuration. Desktop tabs start with the current route and load the real item title.

Chats show metadata update time separately from message activity. New Chats require explicit participants and scope; a configured Agent/account controls actual Run admission. Pending sends preserve the draft and uploaded File identities until acknowledgement. Failed creation with unknown outcome directs the person to inspect Chats before creating again. Pin/done/snooze/thread controls without persistence are unavailable. Settings show current server data, acknowledged autosave for profile fields, and explicit unavailable states for unsupported preferences or account/workspace changes. Connections and Codex accounts use their real setup and authorization flows, with exact scoped grants and provider-confirmed authentication.

### Files and public frozen selections

File uploads show pending, cancellation and retry of the same File/request identity; there is no simulated progress. Download uses the verified server route. Previews stay within 8 MiB, and HTML runs in a credential-free sandbox. Folder breadcrumbs and mixed lists keep Files, Documents and Folders grouped, with server sorting within kind. Sharing requires a preview of the explicit frozen selection before publishing; the anonymous share page shows only acknowledged frozen content and optional selected bytes, with revoked/unavailable and retry states. It sits outside authenticated workspace navigation.

Notifications continue their four independent server attention cursors with one More attention items control. An exhausted group keeps its final cursor while other groups continue; counts describe loaded entries.

The File share byte-selection control uses the shared Checkbox primitive, with its stock compact size and focus behavior, beside the descriptive label.

Below 768px the whole sidebar (areas, the open area's section, footer) is the shared Sheet, opened by the page's menu button (fixed at its top-left); choosing a route closes it.

Private pages remain behind the session-loading state until the previous authenticated session's requests and cache have been cleared. Current Project authority resolves independently of the displayed member page; incomplete pickers never decide who can edit.

Mention chips preserve the exact selected display label, including brackets and backslashes, through editing, sending and notification delivery.

Unknown creation outcomes disable another submission in the current form and direct the person to check saved records. A definite client refusal preserves the draft for correction. Relation writes and document content share one pending fence so an acknowledgement cannot overwrite a newly typed draft. Denied reads hide cached private content; transient read failures retain fenced drafts with Retry.

**Empty-state rules (binding for every page).**

1. Nothing exists and nothing is filtered: the header-free `EmptyPage`, with the floating chat kept. The pattern is the same everywhere (below): title "No {plural}", description one benefit-led sentence, never a vague "<Things> you add show up here." Exactly one 32px primary button, the "+ New <thing>" that prefills the floating bar (never a form); a person's own action (Upload file) sits beside it as a quiet outline button. Never a second primary button. Notifications have no button ("No notifications yet"; Home's empty cards keep their place with one muted line each); Projects is the one page whose button opens its form, because nothing exists yet to ask about.
2. Something is filtered and nothing matches: the page, header and active filter bar stay and the list area shows `NoResults` ("No results", "Try changing or clearing your filters.", Clear filters). A search with no matches says "No results" too; a `Picker` says "No {things} found" (the owner's call, see Menus).
3. There is no permanent toolbar. A page header holds the Filter menu (real properties and archive state), a Search icon that opens the command palette on that page's category, and "+"; never a page's own search box. Active filters show as chips in the filter bar; no search box, sort picker, order or page-size control is drawn on a page. Settings lists show only their own property filters.
4. Inline empties (a folder, a project tab, chat messages, delivery history, settings rows) use the same `Empty` shape or a `Row`: title "No {plural} yet" (a table row or `Row` may be just that, "No labels yet"), one description line ending in a period, no action.
5. Command palette: an entered search with no results shows a compact tile and "No results for “query”" with no period, and its category tabs are hidden when no category has results. Skeletons are stock and use the small radius.
6. Tasks list every project's tasks (filter by Project to narrow them), so an empty page never asks for one; with no project at all, the empty state's button is New project. Chats: `/chats` opens the first chat, or the empty page with its New chat button (which opens /chats/new) when there is none.
7. The composer bar's Notifications button (its `attention` slot, W5) shows only while something needs you (a chat waiting on you or with news, an unread notification) and nothing is written or attached; with nothing, there is no button at all (the owner's call, over open question 7).
8. The Chats sidebar is hidden entirely while there are no chats; /chats/new fills the screen until the first one exists.
9. Chat attachments have no visibility control or explanation: whoever is in the chat reads what is attached, and loses it on leaving. The File stays private in the library.

A data page with no data hides its title row and its actions (Filter, "+", Search): the empty state is the page and its button is the add action (below 768px only the sidebar's menu button stays, `PageHeader` without a `title`). A filtered or searched empty result keeps them, so the filters can be cleared. Loading keeps the title row; only a loaded, empty list hides it.

**Empty-state pattern (every empty state, built or not).**

- **Header width.** `EmptyHeader` (the icon tile, title and description) is capped at 320px (`max-w-xs`, as in Otto v1) in the `design/ui` primitive, centered, so a description wraps to two or three short lines and never runs across the page. No instance widens it or sets its own cap.
- **Title.** "No {plural noun} yet": sentence case, no "found", no "here", no period ("No projects yet", "No routines yet", "No chats yet", "No files yet"). When filters or a search match nothing, always "No results".
- **Description.** One sentence of at most 14 words that ends in a period and leads with the benefit (what the person gets), not the feature or how it works. Second person and friendly ("you", "your"), plain words: no "prompt", "session", "workspace", "API", file paths or config names, and no list of features. Agents are "your agents" or "an agent", never a name; the product is `{{product}}`.
- **Action.** At most one primary 32px button, verb-first and benefit-neutral ("New project", "New routine", "Add to library", "New chat"); "No results" has an outline "Clear filters" instead.

| State | Title | Description | Button |
| --- | --- | --- | --- |
| Tasks | No tasks yet | Keep track of what needs doing, and hand the work to your agents. | New task |
| Projects | No projects yet | Keep everything for one goal in one place, with everyone working on it. | New project |
| Routines | No routines yet | Hand off recurring work and get the result in a chat, right on time. | New routine |
| Library | No files yet | Everything you and your agents make, kept in one place and organized your way. | Add to library |
| Chats | No chats yet | Pick up any conversation exactly where you left off. | New chat |
| Filtered | No results | Try changing or clearing your filters. | Clear filters |
| Skills | No skills yet | Teach your agents your way of working once and reuse it anywhere. | Add skill |
| Sources | No sources yet | Let your agents work with the tools and data you already use. | Add source |
| Agents | No agents yet | Give each kind of work an agent with its own instructions and tools. | New agent |
| Archived chats | No archived chats yet | Chats you archive stay here, out of your way. | |
| Notifications | No notifications yet | Never miss a mention or a task handed to you. | |
| Activity (inline) | No activity yet | | |
10. A new chat has two pickers, With and Project. It is always participants-only; the project's own chat is the one open to everyone in the project.

## Craft shell

The app now runs on Otto (see `UPSTREAM.md`); these are the Otto rules
that carry over, applied where Craft draws the same thing.

- **Layers and the sidebar**: see Layout. The sidebar's lists (Chats, Settings)
  keep these row rules: 28px rows with 6px corners, a 14px icon and an 8px gap, the open
  row filled; one line per row, no descriptions, no dividers.
- **Settings pages.** Sections are an h2 (`text-base`, medium) with an optional
  one-line description, then a 12px card with a hairline border whose rows are
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
