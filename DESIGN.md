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
  frame: "oklch(0.985 0 0)"
  frame-dark: "oklch(0.11 0 0)"
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
  page-card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.xl}"
  top-bar:
    height: 40px
    padding: 4px
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
  section-sidebar:
    backgroundColor: "{colors.frame}"
    width: 280px
  right-panel:
    width: 280px
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
| key | `text-[0.6875rem]` | 11px / 16px | Keys (`Kbd`) and the questionnaire's number keys |
| caption | `text-xs` | 12px / 16px | Badges, tooltips, times, day dividers, small metadata |
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
- Copy: sentence case everywhere, prompts and prefills included, never all
  lowercase; no ellipses in placeholders; main calls to action read "New …";
  agents are never labeled "(agent)".

## Layout

Spacing is a 4px grid on a golden scale: 4 · 8 · 12 · 20 · 32 · 52.

- **Layers.** The frame (`bg-sidebar`) is the lowest and darkest layer; the
  rail and any section sidebar sit on it. The page is a card on the frame:
  `SidebarInset` 8px from the top, right and bottom, `xl` 12 corners, the
  hairline ring and `shadow-xs`. Lower is darker.
- **Insets.** Controls sit **4px** inside their bar or card, so their corners
  nest (32px control `md` 8 + 4 = card `xl` 12). Content text sits 12–20px in.
- **Controls are 32px**: bar buttons, the rail and tabs. Task list and
  command palette rows are 36px. Sidebar rows (the left panels and the right
  one, 2px apart, their group titles too), dropdown, combobox and suggestion
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
- **Rail** (`AppRail`): 48px wide, 8px around 32px buttons, no labels.
  Inbox (home), Search (the command palette), Tasks, Projects, Chats,
  Schedules, Documents, Files.
- **Left and right panels.** The rail stays alone on the frame. Inside the
  card, a left panel (`SectionSidebar`) holds a section's own navigation
  (Chats) and the right panel holds details; both are 280px, in the card's
  color, divided from the page by a hairline, with a 40px header level with
  the page's top bar and the title 16px in. Left navigates, right details.
- **Top bar** (`Topbar`): 40px, 32px controls 4px from every edge, no
  hairline. Breadcrumb on the left; page actions on the right, ending with
  the panel toggle.
- **Right panel toggle** stays in the window's top right corner: in the
  page's top bar while the panel is closed, in the panel's own top bar
  ("Details" and the toggle) once open. The panel opens and closes at once,
  with no slide.
- **Desktop app.** The desktop app adds a 40px title strip above the shell
  (traffic lights, back and forward, one tab per open page); `?desktop`
  previews it in a browser. The web app has none.
- **Widths follow φ**: the page column is 728px; the floating chat bar
  is 728 ÷ φ = 450px;
  sidebars and the right panel are 450 ÷ φ = 280px.
- **One left line.** The page title, headings, editor text, grid tiles and
  their labels, and the text inside page-level surfaces all start on the
  page column's edge. Surfaces reach out by their own inset instead of
  pushing their text in, as Capy's settings do: cards (settings, comments,
  runs, a code block) 16px, list group bars 9px (their border and 8px
  padding), Home's rows 9px. A composer embedded in a timeline sits 4px in
  from the cards' edge, as in the floating chat, so its text is on the line
  too. The header is at least 32px tall, so a title stays put with or
  without buttons.
- **Page** (`Page`): a centered column, `default` (max 3xl) for reading and
  settings, `wide` (max 5xl) for lists. 20px between header and content;
  20px side padding, 52px top and bottom on desktop. An optional `cover` sits
  above the title; an optional `floating` bar (the floating chat) replaces the bottom
  padding and rests 16px above the bottom.
- **Galleries** (`Gallery`): 3 columns for projects, 4 for documents and
  files; 12px between columns, 20px between rows so a title stays with its
  tile.
- **Right panel**: a full-height stock `Sidebar` inside the page card, beside
  the top bar and page, 280px.

## Elevation & Depth

Depth comes from translucency and hairlines, not heavy shadows.

- **Frame**: the darkest layer, flat. **Page card**: the background color on
  the frame, hairline ring and `shadow-xs`.
- **Cards** (comments, composer, question cards): card background, a
  `ring-foreground/10` hairline and `shadow-xs`.
- **Scrolling** areas fade at the edge where more content waits (shadcn
  `scroll-fade-*`): under the top bar and off the bottom, the floating chat
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
| Page card, composer, card (`xl` 12) | 32px buttons, rows | 4px | `md` 8 |
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

**Icons and avatars.** Remix icons at **14px** everywhere. Fixed icons: project
`RiBox3Line`, repeat `RiLoopRightLine`, agent `RiRobot3Line`, time
`RiTimeLine`, row remove `RiCloseLine`, add `RiAddLine`, files
`RiFolder3Line`. **Avatars are at least 20px** (`ActorAvatar`): people show
initials, agents their pixel mascot in their name color, nobody a person
outline. Lists mixing avatars and
icons give icons a 20px slot so labels align.

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

**Right panel.** A stock shadcn sidebar: collapsible `SidebarGroup` sections
with stock spacing and no dividers, under its own 40px top bar ("Details",
its title on the section titles' line, and the panel toggle). Muted section
titles with an optional count, hidden when there is nothing (no "0").
Counts everywhere sit right after their label, softer than it
(`Count`), the label's icon-to-label gap away. Property rows open their menu; each
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
`@` opens a grouped palette (people, agents, tasks, projects, files). Otto is
not in it: Otto is reached through the floating chat, not tagged.

**Tags** (`MentionChip`). Everywhere (composer, messages, comments): the type
icon and label in primary on a soft primary tint (10%, 15% dark) with `xs`
corners, stored as `@[label](type:id)`.

**Dictation.** While listening the composer row shows ×, the level as 4px
bars 2px apart, the elapsed time and Done. The bars start flat (a row of 4px
dots) and rise only with the mic level; the speech range (up to ~6 kHz) spans
the width, mirrored from the center.

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
  composer, on its text edge. Sending creates the chat.
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
message ("Link copied", "“Fix plan” deleted"), and Close at the end. On the
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

**Live data states.** Server reads use the shared skeleton/loading and inline
error with Retry; unavailable controls explain the missing capability and never
show success. The authentication boundary uses the stock Field/Input/Button
composition. Workspace switching clears prior workspace data and opens Inbox.
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
- Do start text on the page column's edge and let surfaces reach out by
  their own inset; don't push a card's text in past the title's line.
- Do save settings as they change, with the one "Settings saved" toast;
  don't add Save buttons.
- Do nest radii (inner = outer − gap); don't reuse a container's radius inside
  it.
- Do keep primary for the main action and tags; don't use it for navigation,
  selection or decoration.
- Do keep icons 14px and avatars at least 20px; don't mix icon sizes in a row.
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
