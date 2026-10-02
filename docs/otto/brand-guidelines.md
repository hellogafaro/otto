# Otto brand guidelines

Draft, for human review. Visual language only — Otto's records, IDs, and
permissions stay exactly as defined in [the plan](plan.md) and
[the code principles](code-principles.md). The layout sketch in §6
makes the tokens concrete; full UI composition is still a separate
deliverable.

The design-system sheet (the primary visual deliverable) lives alongside
this guide at [`design-system/`](design-system/) — see
[Artifacts](#artifacts).

---

## 1. Intent, personality, tone

Otto is a workspace where a person and a subscription coding agent do the
same kind of work side by side: pick up a task, talk it through, run it,
look at what came back, decide if it's done. The visual language should feel
like a calm, well-run toolshop, not a cockpit or a chat toy.

- **Quiet, not decorated.** Flat surfaces, hairline dividers, restrained
  color. Nothing competes with the task, the conversation, or the artifact.
- **Precise, not clever.** Plain labels ("Doing", "Waiting", "Failed"), no
  invented jargon, no exclamation-point microcopy.
- **Human-in-charge.** An agent's activity is visibly an agent's activity. A
  Run finishing is not the same visual event as a Task being marked Done —
  the interface must never blur that line (see [§7](#7-run-and-task-status-semantics)).
- **Unhurried density.** Compact enough to show real work (a task list, a
  thread, an artifact) without scrolling constantly; spacious enough that
  status and ownership are never a guessing game.

### Observations → Otto's choice

Inspiration only — no wordmark, logo, icon set, or exact pixel value is reused.

| Observed | Otto's choice | Why |
| --- | --- | --- |
| Agent activity collapsed under the result it produced, a pinned rounded composer. | Run activity renders as a collapsed strip under its triggering message, expandable; composer stays rounded. | Run activity as a property of the triggering message — no new panel type. |
| Quiet icon+label nav, a mostly blank canvas, a lightweight skippable setup checklist, restrained accent reserved for one or two live links. | Generous whitespace on empty states; a short, skippable setup-checklist pattern reused for first Connection/first Environment; accent used sparingly. | Matches "quiet, not decorated" — the accent stays meaningful instead of being everywhere. |
| A soft pale-blue atmospheric gradient behind a centered welcome composer. | One optional soft radial tint, permitted **only** on welcome/empty states — never on working views with real data. | Decorative seasoning for "nothing here yet," not a texture for dense working screens where it would cost legibility. |
| Compact icon-only global rail (dark, minimal chrome). | A fixed 56px icon-only global rail: section icons, accessible names, tooltip on hover **and** keyboard focus, visible `aria-current`. | Maximizes canvas width and keeps top-level navigation a single, always-available strip rather than a labeled column competing with page content. |
| A floating paper-card document with its own pill toolbar, set into open space rather than docked full-height (Sana). | Every chrome panel — contextual nav, details, composer — is a bounded floating card with its own border, radius, and shadow, anchored to a corner or edge rather than stretched full-height. | Matches "open canvas with floating cards," and lets a long document or artifact expand into the full canvas instead of being squeezed into a sidebar. |
| Linear's quiet light composition, compact controls, and property pills on issues/messages. | Compact form controls, a `prop-pill` component for task/channel metadata (`#sign-in-bug`, `Priority: High`), restrained message typography. | "Linear-inspired" here means the component treatment and density, built with our own shadcn implementation and Otto branding — not its product or visuals. |
| Intercom/Linear's icon rail next to a second, contextual navigation layer. | The rail stays global and icon-only; the second layer is a **small floating card**, not a second full-height divided column, and its contents are specific to the current screen (filters/projects on My work, conversation list + participants on Conversation) rather than a duplicate of the rail's own menu. | Keeps exactly one global menu. A second column repeating the same five destinations would be redundant chrome, not navigation. |

---

## 2. Wordmark

A plain-type wordmark is a useful starting point — no separate logo project
needed yet. "Otto" sets in the UI's own sans-serif, normal weight, sentence
case, no forced icon mark alongside it.

- Clear space: the cap-height of the "O" on all sides.
- Never stretched, outlined, recolored per-surface, or condensed.
- In product chrome (sidebar header): `text-sm`, weight 500, `--foreground`
  — identity, not a call to action, so it never takes the accent color.
- Always set in the current theme's `--foreground`, never a fixed hex, so it
  stays legible across light/dark and all three accent directions.

---

## 3. Color tokens

Single source of truth: [`design-system/tokens.css`](design-system/tokens.css).
The values below are quoted from that file, not redefined — if the two ever
disagree, the CSS file is authoritative and this table is stale.

All names map 1:1 to shadcn/ui's Tailwind v4 CSS-first token convention
(`--background`/`--foreground` pairs consumed as `bg-background`,
`text-foreground`, etc. via `@theme inline` in `apps/web`'s global stylesheet
once the app exists). `--success*`, `--warning*`, `--neutral-run*` are Otto
additions beyond the shadcn default set, needed for Run/Task status (§7);
everything else is a direct shadcn slot.

### Neutral + surface (shared by all three accent directions)

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | `#fafafa` | `#0e0f11` |
| `--foreground` | `#18181b` | `#ececee` |
| `--card` / `--popover` | `#ffffff` | `#18191b` |
| `--card-foreground` / `--popover-foreground` | `#18181b` | `#ececee` |
| `--secondary` / `--muted` | `#f4f4f5` | `#1f2023` |
| `--secondary-foreground` | `#18181b` | `#ececee` |
| `--muted-foreground` | `#71717a` | `#9b9ba1` |
| `--border` / `--input` | `#e4e4e7` | `#2a2b2e` |

### Status (shared across directions — status must never collide with accent)

| Role | Light solid / on-solid | Light muted bg / on-muted | Dark solid / on-solid | Dark muted bg / on-muted |
| --- | --- | --- | --- | --- |
| Success | `#15803d` / `#ffffff` | `#f0fdf4` / `#166534` | `#4ade80` / `#052e12` | `#0f2a1a` / `#86efac` |
| Warning | `#b45309` / `#ffffff` | `#fffbeb` / `#92400e` | `#fbbf24` / `#451a03` | `#2b2008` / `#fcd34d` |
| Destructive | `#dc2626` / `#ffffff` | `#fef2f2` / `#991b1b` | `#f87171` / `#450a0a` | `#2c1313` / `#fca5a5` |
| Neutral-run (queued / stopped) | `#52525b` / `#ffffff` | `#f4f4f5` / `#3f3f46` | `#a1a1aa` / `#18181b` | `#27272a` / `#d4d4d8` |

### Accent — three directions (proposals; pick one as default)

| Direction | Light `--primary` / `--primary-foreground` | Dark `--primary` / `--primary-foreground` | Character |
| --- | --- | --- | --- |
| **A — Quiet neutral, blue accent (recommended)** | `#2451d6` / `#ffffff` | `#7da2f5` / `#0b152e` | One clear, familiar "this is interactive" signal; closest to the reference screenshots' restrained blue link color, without copying their exact blue. |
| B — Mostly monochrome | `#27272a` / `#ffffff` (light) · `#e4e4e7` / `#18181b` (dark) | — | Accent carried by weight, fill, and underline rather than hue; the calmest option, but primary buttons and focus states rely entirely on value contrast, so review carefully with real content before choosing it. |
| C — Restrained teal | `#0f766e` / `#ffffff` | `#5eead4` / `#042f2b` | Same quiet structure, a cooler/greener accent that reads less "default SaaS blue." |

`--ring` (focus outline) equals `--primary` in every direction, so focus is
always the accent color regardless of which direction is chosen.

The design-system sheet presents **Direction A (blue) only**, as one
coherent proposal rather than a three-way toggle — still not a
human-approved brand choice, just the clearest single thing to react to. B
and C remain below, and in `board.html`, for comparison if blue is rejected.

### Measured contrast (WCAG 2.1 ratios, computed from the exact hex pairs above)

| Pair | Ratio | AA normal text (≥4.5) |
| --- | --- | --- |
| Body text on background, light | 16.97 | pass |
| Body text on background, dark | 16.25 | pass |
| Muted foreground on background, light | 4.63 | pass |
| Muted foreground on background, dark | 6.94 | pass |
| Direction A: primary-foreground on primary, light | 6.52 | pass |
| Direction A: primary-foreground on primary, dark | 7.20 | pass |
| Direction A: primary as link text on background, light | 6.24 | pass |
| Direction B: primary-foreground on primary, light/dark | 14.89 / 13.96 | pass |
| Direction C: primary-foreground on primary, light/dark | 5.47 / 9.81 | pass |
| Success solid on-solid, light/dark | 5.02 / 8.57 | pass |
| Success muted on-muted, light/dark | 6.81 / 10.95 | pass |
| Warning solid on-solid, light/dark | 5.02 / 8.97 | pass |
| Warning muted on-muted, light/dark | 6.84 / 11.09 | pass |
| Destructive solid on-solid, light/dark | 4.83 / 5.84 | pass |
| Destructive muted on-muted, light/dark | 7.60 / 9.15 | pass |
| Neutral-run solid on-solid, light/dark | 7.73 / 6.91 | pass |
| Neutral-run muted on-muted, light/dark | 9.50 / 10.08 | pass |

**Two border tokens, not one, because they do different jobs:**

| Token | Light / dark hex | vs `--background` | vs `--card` | Job |
| --- | --- | --- | --- | --- |
| `--border` | `#e4e4e7` / `#2a2b2e` | 1.22 / 1.35 | — | Decorative layout seam only: card edges, panel dividers, table rows. Never the only cue that something is a control. |
| `--border-control` | `#8f8f96` / `#6b6b73` | 3.08 / 3.63 | 3.21 / 3.33 | Essential control boundary — every input, textarea, select, checkbox, and secondary-button outline uses this, meeting WCAG 1.4.11's 3:1 on its own, independent of any label. |
| `--ring` (focus) | = `--primary` | 5.24–15.11 across all 3 directions × 2 modes, vs. both `--background` and `--card` | ≥3:1 non-text minimum | Focus indicator, always present on keyboard focus, never substituted by a border-color change alone. Lowest point is Direction C, light, vs. background (5.24) — still clears AA text contrast, well above the 3:1 non-text floor. |

`board.html` and `preview.html` use `--border-control` on every input/textarea
and the secondary button outline; selected list rows add a 2px `--primary`
border *and* a faint background tint, so selection isn't conveyed by hue
alone. `--border` stays reserved for card/panel/row dividers where the
content itself (text, icon) already identifies the element.

---

## 4. Type

```
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
             Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono",
             Menlo, Consolas, monospace;
```

Inter and JetBrains Mono (both OFL-licensed, self-hostable, no network
dependency at runtime) are the proposed concrete choices — drawn as real
specimens in the design-system sheet, not a guess from the reference
screenshots' pixels. The listed fallbacks keep the stack safe before the
webfont is wired into the app.

| Token | Size / line-height · weight | Use |
| --- | --- | --- |
| `text-xs` | 0.75rem / 1rem · 400 | Caption: timestamps, counts, meta |
| `text-sm` | 0.875rem / 1.25rem · 500 | Interface: labels, buttons, nav |
| `text-base` | 1rem / 1.5rem · 400 | Body: message and document content |
| `text-lg` | 1.25rem / 1.75rem · 600 | Title: task/panel titles |
| `text-heading` | 2rem / 2.5rem · 500 | Heading: section intros (rare in-app) |
| `text-display` | 3.5rem / 4rem · 500 | Display: marketing/sheet use only, not app chrome |
| `font-mono` | 0.8125rem / 1.25rem · 400 | Run IDs, diffs, code |

Weights: 400 for body/caption, 500 for interface text and headings, 600 only
for `text-lg` titles — the ceiling for app chrome. `text-display` is the one
exception, used for this sheet's own editorial heading, never inside the
product.

---

## 5. Spacing, radius, border, elevation, icon, motion

- **Spacing:** standard Tailwind 4px scale. Sidebar padding 16px; main
  content gutter 24px desktop / 16px mobile; card/panel padding 16–20px;
  composer internal padding 12–16px.
- **Radius:** `--radius: 0.625rem` (10px) base, with `sm`/`md`/`lg`/`xl`
  derived by `calc()` offsets (shadcn's own pattern) — see tokens.css.
  Controls (buttons, inputs, badges) use `md`/`lg`; the composer and large
  surfaces use `xl`; avatars and status dots use `full`.
- **Border:** 1px hairline. `--border` for decorative seams (cards, panels,
  rows); `--border-control` for every input/select/checkbox/secondary-button
  boundary, which is the one that must stay legible on its own. See §3 for
  the measured contrast behind that split.
- **Elevation:** two tiers, used deliberately. **Floating chrome** — the
  contextual nav card, the optional details card, the composer — sits above
  the open canvas and always carries `--shadow-sm` plus a border; shadow is
  load-bearing here, since nothing else tells the eye these are floating
  above the canvas rather than part of it. **Canvas content** — task rows,
  message groups, state cards — stays flatter: border only at rest,
  `--shadow-xs` on hover as the only new affordance, never shadow by
  default. Popovers/menus use `--shadow-xs`; modals use `--shadow-sm`.
- **Icon:** lucide-react (shadcn's default icon set — no new dependency).
  16px inline with text, 18–20px in nav/toolbar rails, stroke-width 1.75.
- **Motion:** `--duration-fast: 120ms` (hover/press), `--duration-base:
  180ms` (panel reveal/collapse), `--duration-slow: 260ms` (page-level
  transition), `--ease-out`. Under `prefers-reduced-motion: reduce`, disable
  transform/slide/scale transitions entirely and fall back to an instant or
  opacity-only state change — verified interactively in §8.

---

## 6. Shell composition, density, responsive rules

The human has selected this compositional shell. It is a sketch for the
separate UI-composition deliverable — every surface below is an existing
primitive's view, not a new domain object.

**Anatomy, desktop ≥1024px:**

1. **Global rail** — fixed, 56px, icon-only, full height, left edge. Section
   destinations (My work, Conversations, Documents, Agents, Library),
   settings and the current human's avatar pinned to the bottom. This is the
   *only* full-height, always-visible chrome; everything else floats.
2. **Contextual card** — floating, anchored top-left over the canvas
   (~212px wide, collapsible to a 48px icon-width tab), `--shadow-sm` +
   border. Its contents are specific to the current screen, never a second
   copy of the rail's menu: task filters/projects on My work, the
   conversation list and participants on Conversation, a page outline where
   that's the useful content.
3. **Open canvas** — the rest of the viewport, `--background`, holding
   floating content cards (task rows, message groups, state cards) with
   generous gaps instead of continuous row dividers. Conversation/Task-detail
   text caps at a ~600–640px readable column.
4. **Details card** *(optional, Conversation/Document views)* — floating,
   anchored top-right (~300px wide), same shadow/border treatment,
   collapsible to a small chip. Holds Artifact/Document/Run tabs. Never a
   full-height third column — a long artifact or document expands into the
   full canvas instead of being squeezed into this card.
5. **Composer** — floating, anchored bottom-center, bounded width, rounded,
   `--shadow-sm`. The canvas reserves bottom padding (~110px) so the last
   message or task row is never hidden behind it.

**Tablet 768–1023px:** same anatomy; the contextual and details cards narrow
before converting to on-demand sheets below 768px.

**Mobile <768px:** one content region, per the settled product direction.
The global rail becomes a bottom tab bar (same destinations, horizontal).
The contextual card collapses to a compact top pill (current section name);
its fuller content (filters, conversation list) opens on demand rather than
floating permanently. The details card is hidden by default and opens on
demand — it must never be a fixed element a user cannot dismiss, and it must
never overlap the composer or make an input inaccessible. The composer stays
floating bottom-center, raised above the tab bar.

**Floating cards are a visual/compositional choice, not draggable windows or
a layout manager** — they have no save-position state, cannot be dragged,
and are never a new domain object. They are always anchored, bounded, and
(where listed above) collapsible.

- **Persistence:** draft text, active filters, selected tab, scroll position,
  and each floating card's collapsed/expanded state are preserved across
  navigation — a usability requirement from the proposed direction, not yet
  implemented anywhere.
- **Keyboard/focus:** every interactive element reachable by Tab in a
  sensible order; visible focus ring (`--ring`) on every focusable control,
  including inside Tiptap documents, the composer, and rail icons. Rail
  icons expose an accessible name (`aria-label`) and a visible tooltip on
  **both** hover and keyboard focus — hover alone must never be the only way
  to discover what an icon means. No focus trap without an explicit close
  affordance.

---

## 7. Run and Task status semantics

This is the most load-bearing part of the system — the plan is explicit that
**an agent can propose completion; only an authorized human marks a Task
Done**, and that Run states (queued/running/waiting/finished/failed/
interrupted) are signals, not Task stages. The visual system must keep that
distinction legible at a glance, not just correct in the data model.

| Signal | Token | Visual treatment | Note |
| --- | --- | --- | --- |
| Run: queued | `--neutral-run` | Muted gray dot, "Queued" label | Not yet claiming any outcome |
| Run: running | `--primary` (accent) | Accent dot, subtle pulse (disabled under reduced motion) | The *only* status that borrows the accent color, because "in progress" is inherently the active/interactive state |
| Run: waiting | `--warning` | Amber dot, "Waiting for input/approval" | Needs a human action to continue — distinct hue from both accent and failure |
| Run: finished | `--success` | Green dot, "Finished" | **Never** auto-renders as "Done" anywhere near the Task's own status control |
| Run: failed | `--destructive` | Red dot, "Failed" | |
| Run: interrupted / stopped | `--neutral-run` | Gray dot with a stop glyph, "Stopped" | Deliberately **not** red — a human-initiated stop is not a failure, and reusing destructive red there would misrepresent intent |
| Task: To do / Doing / Done | separate control, own palette | Done uses `--success` **only after explicit human confirmation**, rendered as a checkbox/toggle the human controls, never auto-set by a Run event | A completed Run shows as activity *inside* the Task or Conversation; it must sit visually apart from the Task's own status control so "the agent finished" and "the human marked this done" can never be mistaken for the same action |

Ownership legibility: every Task shows its human owner and its
human-or-agent assignee as two distinct, always-visible identity chips (not
one merged "assigned to" field) — an agent assignee gets a small agent
glyph next to its name so it's never confused with a human teammate at a
glance. On compact rows (a list, not the full task-detail layout with
explicit "Human owner"/"Assignee" text labels), each avatar also carries a
small visible role badge ("O"/"A") — an aria-label/title attribute alone
does not help a sighted user tell two identical human avatars apart when the
owner and assignee are the same person.

---

## 8. Component states and shadcn/Tailwind v4 mapping

All components are standard shadcn primitives with Otto's tokens — no new
component library, matching the fixed stack.

| Component | shadcn base | States verified in the preview artifact |
| --- | --- | --- |
| Button | `button` | default, hover, active/pressed, focus-visible ring, disabled, loading (spinner, no layout shift) |
| Input / Textarea (composer) | `input`, `textarea` | default, focus, filled, disabled, error (destructive border + helper text, not color alone) |
| Badge (status) | `badge` | one variant per §7 status token — never free-form colors |
| Avatar (human/agent identity) | `avatar` | human avatar (photo/initials), agent avatar (glyph + accent-neutral ring) are visually distinct shapes, not just different images |
| Tabs (details panel: Worklog / Artifact / Document) | `tabs` | default, active, keyboard arrow navigation, focus-visible |
| Card (task row, artifact tile) | `card` | default, hover (`--shadow-xs` + `--border-control`), selected (2px `--primary` border + tint, not color alone) |
| Floating chrome card (contextual nav, details, composer) | `card` + custom anchoring | expanded, collapsed/minimized (chip), focus-visible on its toggle; always `--shadow-sm` |
| Rail icon button | custom, shadcn `button` ghost variant | default, hover, `aria-current` (current section), focus-visible with visible tooltip, accessible name required |
| Property pill (`#channel`, `Priority: High`) | `badge` (outline variant) | static metadata display only — not a status signal, never reuses §7 status colors |
| Dialog (confirmations) | `dialog` | open, focus trap with Escape-to-close, reduced-motion fallback |

---

## Artifacts

**Primary deliverable — the design-system sheet**, at
[`design-system/`](design-system/) alongside this guide:

- [`otto-design-system.svg`](design-system/otto-design-system.svg) — the
  editable source: one composed portrait artboard (1440 × 3570, six
  sections — Color, Typography, Space and shape, Actions, Inputs and
  status, Product patterns), built by a small Python generator
  ([`build_sheet.py`](design-system/build_sheet.py)) that parses
  [`tokens.css`](design-system/tokens.css) directly, so every value traces
  back to the token source instead of being redrawn by eye.
- [`otto-design-system.png`](design-system/otto-design-system.png) —
  rendered export, 2880 × 7140 (2×).
- [`otto-design-system.pdf`](design-system/otto-design-system.pdf) —
  single-page PDF at the artboard's true size (15 × 37.19 in), print-ready.
- [`fonts/`](design-system/fonts/) — the two self-hosted OFL webfonts
  actually used in the sheet (Inter, JetBrains Mono) plus their license
  files.

This sheet is the delivered visual system. An earlier interactive HTML
board/application mockup was rejected as "another HTML dashboard" and is
**not** carried into this repository — it remains, if needed for historical
reference, only in the originating BB thread's storage, not as active
documentation here.

See [`design-system/RENDERING.md`](design-system/RENDERING.md) for the
render procedure, the measured-contrast computation behind §3, and the
independent review record.
