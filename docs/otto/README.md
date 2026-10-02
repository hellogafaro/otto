# Otto

Otto is a fresh application repository for a workspace combining flat project
tasks, shared conversations, flexible documents/skills, saved artifacts, and
native subscription coding agents. This directory is the canonical home for
its product plan, research, and visual design. The former Buzz checkout is
preserved outside this repository; see [the backup record](../setup-backup.md).

## Canonical documents

These six files are the authoritative, current content — read them in this
order:

1. [`plan.md`](plan.md) — the product plan: primitives, data model, scope,
   and the first usable version. Start here.
2. [`code-principles.md`](code-principles.md) — implementation guidance for
   the future app (naming, types, structure, checks).
3. [`brand-guidelines.md`](brand-guidelines.md) — visual language: color
   tokens, type, spacing, the selected compositional shell, and Run/Task
   status semantics. Links to the design-system sheet below.
4. [`stack-options.md`](stack-options.md) — selected libraries, earlier
   alternatives, and the open credential-storage/compute-provider choices.
5. [`foundation-research.md`](foundation-research.md) — bridge/reuse
   research and the DBOS-versus-pg-boss comparison behind the plan.
6. [`references.md`](references.md) — researched projects and source pins
   for implementation questions; a lookup guide, not a dependency list.

## Research notes (not part of the six canonical docs)

- [`platform-research.md`](platform-research.md) — **foundation decision
  resolved**: build a fresh Otto app on the selected Bun/Hono/React/
  PostgreSQL stack, no fork, no backend-language switch absent a measured
  bottleneck (see its "Foundation decision" section). The market scan of
  existing self-hosted/"agent teammate" platforms that informed it stays
  below that decision as dated supporting evidence.
- [`realtime-research.md`](realtime-research.md) — **still pending**:
  compares Electric, Zero, Supabase Realtime, PowerSync, native Postgres
  LISTEN/NOTIFY (with Otto's planned WebSocket), and briefly Instant/
  GraphQL, against Otto's server-authoritative plan. A recommendation
  awaiting human selection, not a change to [the plan](plan.md) or
  [the stack options](stack-options.md).

## Design system

[`design-system/`](design-system/) holds the primary visual deliverable —
one composed portrait sheet, not an interactive mockup:

- [`otto-design-system.svg`](design-system/otto-design-system.svg) — editable
  source.
- [`otto-design-system.png`](design-system/otto-design-system.png) — full
  2× render.
- [`otto-design-system-chat.png`](design-system/otto-design-system-chat.png)
  — smaller rendering for inline/chat display.
- [`otto-design-system.pdf`](design-system/otto-design-system.pdf) —
  print-ready, single page at true size.
- [`build_sheet.py`](design-system/build_sheet.py) — the generator; reads
  [`tokens.css`](design-system/tokens.css) directly, so every swatch, hex
  label, and contrast ratio on the sheet traces back to that one file. Run
  `python3 build_sheet.py` from this folder after editing `tokens.css` to
  regenerate the SVG, then re-render the PNG/PDF (see
  [`design-system/RENDERING.md`](design-system/RENDERING.md) for the exact
  procedure and the independent review record).
- [`fonts/`](design-system/fonts/) — the two self-hosted OFL webfonts used
  in the sheet (Inter, JetBrains Mono), with their license files.
- [`RENDERING.md`](design-system/RENDERING.md) — the exact render procedure,
  the contrast-ratio computation behind the guide's §3, and the independent
  review record.

An earlier interactive HTML board and application mockup were rejected as
"another HTML dashboard" during review and are **not** included here — they
exist only in the originating BB thread's storage, not as active
documentation in this repository.

## Foundation canvases

[`canvases/`](canvases/) holds exported, documentary HTML visualizations of
the plan, research, stack, and principles documents above — presentation
copies for browsing, not a second source of truth. If a canvas and its
source Markdown ever disagree, the Markdown file wins.

- [`otto-plan.html`](canvases/otto-plan.html)
- [`otto-foundation.html`](canvases/otto-foundation.html)
- [`otto-stack.html`](canvases/otto-stack.html)
- [`otto-principles.html`](canvases/otto-principles.html)

[`canvases/source/`](canvases/source/) keeps the Python scripts that built
these exports, for historical reference. They read from this machine's
original BB thread-storage paths and a local BB app install, so they are
**not portable or meant to be rerun from this repository** — treat them as a
record of how the canvases were produced, not a build tool.

## What's canonical vs. exported

| Kind | Where | Source of truth? |
| --- | --- | --- |
| Product plan, principles, guidelines, research, references | the six `.md` files above | Yes — edit these |
| Design tokens | [`design-system/tokens.css`](design-system/tokens.css) | Yes — edit this, then regenerate the sheet |
| Design-system sheet (SVG/PNG/PDF) | `design-system/` | Generated from `tokens.css` — don't hand-edit the PNG/PDF |
| Foundation canvases (HTML) | `canvases/` | Exported snapshots of the Markdown — don't hand-edit, regenerate from source if ever needed |
| Canvas builder scripts | `canvases/source/` | Historical record only, not rerunnable here |
