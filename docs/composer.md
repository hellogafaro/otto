# Composer

Status: research and design, 6 Oct 2026. W1 to W5 built (below); W6 done in part (EditPopover removed); W7 not started. It turns the owner's brief into a spec and a set of work packages. Evidence is given as `file:line`. Paths: `R` = `apps/electron/src/renderer`, `DS` = `design/ui/src/components`, `v1:` = a path in tag `otto-v1-archive` (read it with `git show otto-v1-archive:<path>`).

The v1 screenshots were taken from `v1:docs/evidence/` and copied to `/tmp/composer-shots/`:

- `v1-ui-task-desktop.png`, `v1-ui-document-desktop.png` and `v1-ui-tasks-desktop-dark.png` show the compact bar on a detail page and on a list.
- `v1-ui-tasks-mobile-light.png` shows the bar at phone width.
- `v1-ui-chat-desktop.png` shows the full composer on an older chat page.
- `v1-ui-inbox-desktop-dark.png` shows the Inbox empty state with no bar.

No screenshot shows the attachment rail or dictation. Those specs come from the v1 code. The screenshots date from 4 Oct (`5cbcddb`) and the final composer code from 5 Oct (`c87e1cd`), so where they differ, the code wins.

## (a) The brief as requirements

| # | Requirement |
| --- | --- |
| R1 | **One** composer component everywhere. It has two modes: **compact** (the v1 floating bar) and **full**. |
| R2 | The composer is on **every page, with no exclusion**. In v1 it was left out on Chats and Inbox; now it is shown there too. |
| R3 | Full by default on the new-chat start screen ("home"), on the open chat (reply) and, per the second sentence, on the Inbox. Compact everywhere else. |
| R4 | Compact is "dynamic": it grows when the user needs more room (see the state machine). |
| R5 | Only compact mode has the **Inbox icon**, which shows chats and items that need the user. Full mode never has it. |
| R6 | The composer knows the **page context**. On a chat it replies to that chat; on a task it acts on that task. Each page tells the composer what it is about. |
| R7 | **Craft's floating AI chat is removed**. Creation and update actions **prefill** the composer instead of opening their own mini agent. |
| R8 | This phase delivers the UI, not the whole backend. Send goes through what exists today; new agent abilities are deferred. |
| R9 | The look is v1's: refactor the current Craft input (`R/components/app-shell/input/free-form-input.tsx`) to match it. |
| R10 | The **attachment rail** comes back: a horizontal row of chips with a fade on its right edge. |
| R11 | The **transcription domain** comes back, with v1's dictation UI and animations (waveform, timer, Cancel / Done) in the full composer. |

## (b) Ambiguities and recommendations

| Ambiguity | Recommendation |
| --- | --- |
| **Which pages are full by default.** One sentence says two ("chat and home"); another says three ("homepage, inbox, chat page"). There is no Home page today: `/` and `/{ws}` redirect to Chats (`R/router/route-tree.ts:43-44,65-67`). New chat is not a page either: the `action/new-session` route creates an empty session and opens the chat page (`R/components/app-shell/app-shell.tsx:493`). | Make **three** pages full: the empty new chat (this is "home"), the open chat, and the **Inbox**. In v1 the Inbox *was* home ("/", `v1:DESIGN.md:624`). An Inbox icon on the Inbox page would also point at the page you are already on, so full mode fits there. Treat an empty chat as "home" and show "start" copy on it. Whether `/` should open the Inbox is open question 2. |
| **What "dynamic" means.** v1's compact bar stayed one line: its text scrolled sideways, pasted lines were joined, and there was no Shift+Enter (`v1:apps/web/src/components/composer.tsx:196-216`). | Compact stays one line while it is short. It **expands** in place into the full layout when the text wraps, on Shift+Enter, when files are added, or when dictation starts. It **collapses** on Esc, or on blur when empty. The draft is kept either way. |
| **Where a compact send goes.** v1 started a chat about the item, with the first message led by a link to it, then grew the bar into a floating chat window (`v1:.../floating-chat.tsx:225-243`). | Use **no floating window** (it is not in the brief). A send from compact creates a new chat whose first line is the page's entity token (`task:<id>`), using the existing new-session path, then opens that chat. There the composer is full. The agent tools that "do updates around the task" are deferred. |
| **"Same animations in the big one".** In v1 dictation existed in **both** modes, as the main button of the one `Composer`. | Put dictation in both modes, because it is one component. The full composer shows the waveform across its whole action row. |
| **What "the floating AI chat from Craft" is.** There is no floating chat in the code today. `DESIGN.md:1640-1676` only specifies one, and `DS/sonner.tsx:15` has a stale comment. | The brief means **`EditPopover`** (`R/components/ui/edit-popover.tsx`, about 1,100 lines). In its Inline mode it runs a hidden mini-agent session in a popover through a compact `ChatDisplay` (`:1-8`, `hidden: true` at `:971`). It is opened from 19 files through 21 `getEditConfig` keys (`:124-542`). This is what gets removed (W6). |
| **Which Craft controls stay** in full mode (permission mode, sources, working directory, `#` labels, context %, thinking). | The full composer keeps **model (with thinking) and permission mode** as 28px pickers in the `tools` slot. Sources, working directory, the `#` label menu and the context chip leave the composer (open question 4). |

## (c) v1 anatomy

These figures are measured from `v1:apps/web/src/components/{composer,floating-chat}.tsx`, `v1:apps/web/src/components/page.tsx` and `v1:packages/ui/src/components/attachment.tsx`.

| Part | v1 value |
| --- | --- |
| Compact bar | 40px tall, a single row `p-1 gap-1`: + (32px) · text · `tools` · `idle` (Inbox) · main button (`composer.tsx:538-552`). Width `max-w-[28.125rem]`, 450px = 728 ÷ φ (`floating-chat.tsx:256`). Centered on the column, 16px above the bottom (`page.tsx:76-81`, `px-5 pb-4`). |
| Compact surface | Command palette glass: `dark bg-popover/70 backdrop-blur-2xl backdrop-saturate-150 shadow-md ring-1 ring-foreground/10 rounded-xl` (`composer.tsx:517-519`). Dark in both themes. |
| Layer | Sits above the scrolling page, never inside it, because a masked ancestor (`scroll-fade-y`) stops `backdrop-filter`. Only the bar takes clicks (`pointer-events-none` layer). Content keeps 88px free at its end, `pb-22` (`page.tsx:34-49`). |
| Full composer | The `card` surface, `rounded-xl shadow-xs ring-1 ring-foreground/10`. Text `p-3 pb-0 text-sm`, growing up to `max-h-60` (240px). Action row `p-1`: + · tools … main button at the right (`composer.tsx:554-570`). Text sits 16px in; controls sit 4px in. |
| Embedded (inside the window) | `rounded-md`, 28px buttons with 6px corners, row padding `p-1.5` (`composer.tsx:159-162, 510-513`). |
| Main button | One action, in priority order: Sending (spinner) › Stop (`busy`) › Transcribing (spinner) › Done (✓, while listening) › Send (↑, when there is content) › Dictate (mic, when empty) (`composer.tsx:384-415`). Primary (`variant="default"`). Its tooltip is its label. |
| Inbox icon | A ghost 32px icon button with `RiInboxLine` and an 8px `bg-destructive` dot (`floating-chat.tsx:600-632`). It shows only while the box is empty and something needs the user (`:464-473`; v1 DESIGN empty-state rule 7). It opens the window's list of unread chats and chats with an open question (`:206-214`, polled every 5s). |
| Attachments | A rail above the text (`InputGroupAddon align="block-start"`) using `AttachmentGroup`: `flex gap-2 overflow-x-auto scroll-fade-x snap-x snap-mandatory scroll-px-1 scrollbar-none overscroll-x-contain py-1` (`attachment.tsx:186-197`). Compact chips are 28px: a 20px thumbnail 4px in, the name cut in the middle at 24 characters (`Banner-mob…08-10.jpg`), and a 20px remove (`composer.tsx:837-882`). Full chips (`sm`) add a second line, "PNG · 120 KB" or "Uploading". States: uploading (spinner, shimmer title), error (red border, message, "Retry upload"), done. |
| Adding files | Through +, drop on the group (the ring turns `ring-ring` while dragging) and paste (`composer.tsx:217-228, 523-535`). Each file uploads as soon as it is added, with an abort per file; Send waits for uploads to finish (`:278-340`). |
| Keys | Enter and ⌘Enter send; Shift+Enter adds a line (full mode only); the `@` palette takes Enter while it is open (`composer.tsx:86-102`). Esc minimizes the window. |
| Mentions | `@` opens a grouped list of people, agents, tasks, projects and files, at most 3 of each (`v1:apps/web/src/components/mentions.tsx:12,46`). |
| Prefill | `ComposerHandle.prefill(text)` replaces the text and puts the cursor at the end; `prepend(text)` is used for replies. `useAskAgent()` prefills the bar from anywhere (`floating-chat.tsx:129-135`). The empty-page "+ New schedule" button puts "Every " into the bar (`v1:.../empty-page.tsx:22-42`). |
| Morph | View Transitions, 320ms `cubic-bezier(0.32,0.72,0,1)`. The bottom edge stays pinned and the corners go from 12 to 8px. The old snapshot fades out over 120ms. Off with reduced motion (`v1:.../floating-chat.css:1-84`, `floating-chat.tsx:99-121`). |

## (d) The current composer (Craft) and what happens to each part

The chain is `R/components/app-shell/chat-display.tsx:1866` `ChatInputZone` › `input/chat-input-zone.tsx:73` (a card: `card-surface rounded-xl bg-card`, with `ActiveOptionBadges` on top) › `input/input-container.tsx:207` › `input/free-form-input.tsx` (2412 lines). It is mounted only as the chat page's sibling card under `PageCenterpiece`. An empty chat is the new-chat screen; there is no separate one.

| Part (evidence) | Decision |
| --- | --- |
| `RichTextInput`, a contenteditable that renders mention badges (`R/components/ui/rich-text-input.tsx`, 814 lines). Pasting more than 100 lines turns the text into an attachment. | **Keep**. Restyle it to v1's text insets. Compact mode joins pasted lines. |
| Send key setting `sendMessageKey`, `enter` or `cmd-enter` (`free-form-input.tsx:543-564, 1290-1310`). IME is respected. | **Keep**. It matches v1 in its default. |
| Up arrow on an empty draft while processing stops the run and recalls the prompt (`:1267-1286`). Esc blurs (`:1311`). | Keep stop-and-recall. Esc collapses compact mode, then blurs. |
| Send and Stop as two buttons (`:2331-2353`). | **Refactor** into v1's single main button: Send, Stop, Dictate, Done, then Busy. |
| Attachments: picker, drop, paste and an `otto:paste-files` event (`:981-1149`). Read as base64 by `readFileAsAttachment` (`:1030`). Shown as 64px tiles in `R/components/app-shell/attachment-preview.tsx`. Uploaded only at send time through `file:storeAttachment` (`app.tsx:1222`, `packages/server-core/src/handlers/rpc/files.ts:215`). | **Keep** the inputs and the send-time upload in this phase. **Replace** the tiles with the v1 rail (W3) and **delete** `attachment-preview.tsx`. Uploading as soon as a file is added waits for the library's HTTP upload (`docs/library.md:31`). |
| `/` slash menu: permission modes, `/compact`, folders (`R/components/ui/slash-command-menu.tsx`, `free-form-input.tsx:860`). | **Cut** in this phase. Its entries are Craft modes and folders. |
| `@` menu: skills, sources, files (`R/components/ui/mention-menu.tsx`, `:887`). | **Keep** it, limited to files and skills. Entity mentions (`EntityChip`, `DESIGN.md:1616`) come later. |
| `#` label menu, and "Add new label" through `EditPopover` (`:902-936, 1537-1546`). | **Cut**. Labels are set in the chat's panel. |
| Toolbar, left side: Attach, Sources, Working directory. Compact variant: permission, model, attach, source, folder (`:1717-1939`). | **Keep** Attach (+) and the permission picker. **Cut** Sources and Working directory from the composer. |
| Toolbar, right side: model and connection menu with a Thinking submenu, the context % chip that runs `/compact`, Send (`:1962-2353`). | **Keep** the model menu as a 28px picker in `tools`. **Cut** the context chip. |
| `ToolbarStatusSlot` "Esc to interrupt" hint (`:1698`). | Replace it with a `Kbd` in the Stop tooltip. |
| Rotating placeholders `chatInput.placeholder.{workOn,shiftTab,mention,labels,newLine}` (`:307-316`). | **Cut** the rotation. One placeholder comes from the page context (copy keys in (g)). |
| Drafts: `app.tsx` keeps them in a ref, debounces saves by 500ms and saves through `drafts:get/set/delete/getAll` to `drafts.json`. | Drafts are **browser only**, per the owner's data decision (`docs/data-architecture.md:53,431`): localStorage per workspace and context key. Deleting the drafts RPC and `drafts.json` is the data plan's job; W2 only stops calling it. |
| Height: `getComposerMaxHeight`, the smaller of 584px and 66% of the space (`composer-height.ts`). `InputContainer` animates the height when it switches to a structured input. | Change it to v1's 240px text cap. Keep the structured-input swap (permission, credential and admin requests in `input/structured/*`). In full mode only, they replace the composer body. |
| `compactMode` / `isCollapsedInCompact` ("Tap to type"), used only for `EditPopover` and the mobile web UI (`chat-display.tsx:218,483`). | **Delete** them together with `EditPopover` (W6). The new compact mode is a different thing. |

## (e) Transcription: inventory and plan to wire it back

**What exists today: nothing but prose.** I grepped `apps`, `packages` and `design` for `MediaRecorder`, `getUserMedia`, `transcription`, `dictation`, `whisper` and `speech`. The only hits are the `DESIGN.md:1632-1638` "Dictation" paragraph, which was carried over from v1, and an `'audio'` attachment type in `packages/shared/src/utils/files.ts:410-416`. There is no mic button, RPC, setting or locale key. `hints.transcribeVoiceMemo` is unrelated. Electron sets a media permission handler only for browser panes (`apps/electron/src/main/browser-pane-manager.ts:3280-3293`). No `NSMicrophoneUsageDescription` was found.

**What v1 had:**

| Layer | v1 |
| --- | --- |
| Capture | Browser `MediaRecorder` on `getUserMedia({audio:true})`, in 250ms chunks, so stopping never depends on a final flush. The recording is dropped on unmount (`v1:apps/web/src/components/composer.tsx:612-707`). It is batch, not streaming: there is **no interim text**. |
| API | `POST /api/transcriptions` with the raw `audio/*` body, a 25 MiB cap (413 `too_large`), authenticated, forwarded and never stored. It logs only sizes (`v1:apps/server/src/transcription-api.ts`). |
| Provider | OpenRouter `/api/v1/audio/transcriptions`, model `mistralai/voxtral-mini-transcribe` (`TRANSCRIPTION_MODEL`). The key is `OPENROUTER_API_KEY`; without it the API answers 501 `not_configured`. Timeout 20s; a second request is started if the first is slow after 1.5s; one retry on a transient error; the first success wins. Errors map to 504 `timeout`, 503 `unavailable` and 502 `failed`, with no provider body (`v1:apps/server/src/transcription.ts`, `v1:docs/operations.md:9`). Tests: `v1:tests/transcription.test.ts`. |
| UI while listening | The row becomes **× Cancel · waveform · elapsed time · Done (✓)**, and the text editor stays mounted but hidden. Waveform: 4px bars 2px apart that fill the width (`count = (width - 16 + 2) / 6`). An `AnalyserNode` with `fftSize` 64 uses bins 0-7 (up to about 6 kHz), mirrored from the center. Each bar is `scaleY(0.2 + level × 0.8)` with a 75ms transition, drawn with requestAnimationFrame. The bars start as flat 4px dots. Timer: m:ss, ticking every 250ms, `w-10 text-xs tabular-nums` (`composer.tsx:417-440, 709-801`). |
| After Done | The main button shows a spinner ("Transcribing") and Send is blocked. The text is inserted at the cursor, with a leading space when needed. Toasts: "No speech detected", "Unable to transcribe", "Dictation isn't set up", "Allow microphone access to dictate". |

**Plan to wire it back:**

1. **Domain.** Port `transcription.ts` (hedge, retry, error mapping) to `packages/shared/src/transcription/index.ts` as plain functions (`runTranscription(audio, type)`), with its tests. It has no tables. The key comes from the `connections` domain: the workspace's `openrouter` connection through `getConnectionSecret` (`packages/shared/src/connections/index.ts:138`; catalogue entry at `catalog.ts:16`). This keeps provider accounts in one place (AGENTS.md); open question 5. The model is the `transcriptionModel` setting, defaulting to voxtral.
2. **Transport.** Add one RPC, `transcription:create` (`{ audioBase64, type }` › `{ text }` or a coarse error code). It goes in `packages/shared/src/protocol/channels.ts`, a handler at `packages/server-core/src/handlers/rpc/transcription.ts` registered in `rpc/index.ts`, and `apps/electron/src/transport/channel-map.ts`. An RPC works the same in Electron and on the web; today there is no HTTP upload path (`docs/library.md:31`). Cap the audio at 10 MiB (Opus runs at roughly 0.5 MB a minute). Move it to HTTP together with library uploads.
3. **Gating.** If there is no OpenRouter connection, the call returns `not_configured`. The mic stays enabled and shows the toast "Connect OpenRouter to dictate"; the copy key is in (g). If the browser can't record, the mic is disabled with the tooltip "Dictation isn't available".
4. **Electron.** Allow `media` (audio only) for the app's own origin in the main window's session. Add `NSMicrophoneUsageDescription` and the audio-input entitlement to the macOS build, and call `systemPreferences.askForMediaAccess('microphone')` before the first recording.
5. **UI.** `use-dictation.ts`, `use-elapsed.ts` and `waveform.tsx` under `R/components/composer/`, ported as written. Fix the drift between `DESIGN.md:1636` (the main button "`loading`, its label unchanged") and v1's "Transcribing" spinner by using the DS Button `loading` state with the label "Transcribing".

## (f) Target architecture

- **One instance, mounted once.** `ComposerProvider` wraps `PageFrame` in `app-shell.tsx:641`. `PageFrame` gains one `composer` slot in its column track, under `page-body`, outside `PageScroll`'s mask. In full mode the slot is in the layout flow: on the chat page it is today's sibling card, 8px under the centerpiece. In compact mode it is an absolute layer over the bottom of the column. The editor never remounts on navigation. Its draft is stored per context key, so a page change swaps the text.
- **Context API.** It is one hook and holds no registry:

```ts
type ComposerContext = {
  key: string                       // draft key and identity: 'chat:<id>', 'task:<id>', 'page:tasks'
  entity?: string                   // ENTITY_TOKEN '<type>:<id>' (@otto/shared/entities); shown as a chip
  placeholder?: string              // already translated; default "Ask your agents about this page"
  mode?: 'compact' | 'full'         // default 'compact'; full on Inbox, chat, empty chat
  onSend?: (m: { text: string; attachments: FileAttachment[] }) => Promise<void>  // chat page: send; else default
  busy?: boolean; onStop?: () => void
  tools?: ReactNode                 // full mode pickers (model, permission) - chat page only
}
useComposerContext(ctx)             // a page registers on mount; the last one mounted wins
const composer = useComposer()      // { prefill(text), focus(), expand(), collapse() }
```

- **What context does in this phase.** It sets the placeholder and an entity chip (a 28px `EntityChip` at the start of the expanded row), selects the draft, and picks the send path. Send on the **chat** page is today's `handleSubmit`. On an **empty chat** it is today's first send. On the **Inbox** and on any other page it is the default send: create a chat (`action/new-session`) with `entity` as the first line, send, and navigate. Deferred: the agent seeing the page (tools for task updates), sending from compact without leaving the page, and `prefill` templates for task and project creation.
- **Modes, as a state machine:**

```
compact-idle --focus--> compact-focused --(wrap | Shift+Enter | files | dictate)--> expanded
expanded --(Esc | blur & empty)--> compact-idle        compact-focused --(Esc | blur)--> compact-idle
full (page mode) : never collapses; Esc blurs (and Stop keeps chat.stopProcessing's Esc while busy)
orthogonal: dictation idle -> listening -> transcribing -> idle ; send idle -> sending -> idle
```

- **Prefill.** `composer.prefill(text)` sets the text, puts the cursor at the end, focuses, and expands if needed. It replaces `EditPopover`, and later, creation dialogs.

## (g) UI spec

| Element | Spec |
| --- | --- |
| Compact bar | 40px tall, 448px wide (28rem, about 720 ÷ φ, the column's content width). It sits on the column's center line, **16px above the window's bottom** (8px frame + 8px). `p-1 gap-1`. Contents: + (32px ghost) · text (text starts 44px in) · Inbox (32px ghost, with a dot) · main button (32px primary). Command palette glass as in v1 (`dark bg-popover/70 backdrop-blur-2xl ring-1 ring-foreground/10 shadow-md rounded-xl`). |
| Expanded (from compact) | Same glass, grown to the column's content width (720px; under 768px, full width minus 20px on each side). Its bottom edge stays in place. Rows from top to bottom: attachment rail, text (up to 240px), action row (+, entity chip, tools … Inbox, main). |
| Full | The card surface (`card-surface bg-card rounded-xl`, `shadow-sm`), as wide as the column's track, in the layout flow, 8px from the window's bottom. Text `p-3 pb-0`, 16px in, from one line up to 240px. Action row `p-1` with 32px controls 4px in (8px corners nest in the 12px card). Tools are 28px pickers. No Inbox icon. |
| Attachment rail | `AttachmentGroup` from `DS/attachment.tsx:187-197`, the v1 file almost unchanged, **unused today**. The right fade is shadcn's `scroll-fade-x` (`node_modules/shadcn/dist/tailwind.css:97-155`, scroll-driven `--scroll-fade-s/e`): the end fades while more chips wait and the start fades once scrolled. Chips: 28px `xs` in compact and expanded mode, `sm` with the kind and size in full mode. Gap 8px, 4px from the composer's edge. No new design/ui piece is needed: the rail is the existing `AttachmentGroup`. |
| Main button | One 32px primary button: ↑ Send / ■ Stop / mic Dictate / ✓ Done / spinner. Its tooltip is the label plus a `Kbd` (Send ↵, Stop Esc, Done ↵). |
| Listening | × (32px ghost) · waveform (`flex-1 h-5`, the bars as specified in (e)) · elapsed time (`w-10 text-xs tabular-nums muted`) · Done. These replace the action row (full mode) or the text (compact mode). |
| Inbox icon | `Inbox` (Lucide) 32px ghost. A dot (8px `bg-destructive`, at the icon's top right) when the attention count is above 0. Its tooltip reads "Inbox", then the count, then its `Kbd`. |
| Inbox popover (superseded: see W5 as built) | Above the bar, 4px from it, 320px wide. Up to 8 rows of 28px (`ListRow` style): chats waiting on the user (pending permission or credential, `needs-review`, `hasUnread`), then unread notifications. A row opens its chat or entity. The footer is "Open Inbox" (28px ghost). Empty: "Nothing needs you". |
| Clearance | Every page column ends **80px** above the bar's top: 40 (bar) + 16 (below it) + 24. This is `--composer-clearance`, set by the slot and read by `PageColumn` (`DS/page.tsx:32-61`, `pb-10`). The page's bottom fade stays under the bar. |
| Motion | Compact to expanded and back: 320ms `cubic-bezier(0.32,0.72,0,1)`, bottom edge pinned, width and height together. A single CSS transition is enough; View Transitions are not required. The Inbox popover has no entry animation (`DESIGN.md:1345`). The waveform uses a 75ms transform. Everything is off with `motion-reduce:`. |
| Layers | The composer layer is `z-10` (`--z-local`), above page content and below the sidecar overlay (`DS/sidecar.tsx:70`, `z-20`), the sheet, popovers (`--z-popup` 500), dialogs and the palette (`--z-dialog` 380). Toasts stay at the bottom right (`DS/sonner.tsx:23`). On phones, they are offset by the clearance. |
| Phones (<768px) | The bar spans the width minus 20px on each side, at `bottom: 16px + env(safe-area-inset-bottom)`. With the keyboard open, the bar is lifted by the `visualViewport` offset (`R/lib/input-viewport.ts:24,77`; nothing lifts a bottom bar today). The sidebar sheet covers the composer. A full composer follows the same rule. |
| Keys | ⌘K stays the palette. New `composer.focus` action **⌘J** (`R/actions/definitions.ts`), shown with `Kbd`. Enter sends (or ⌘Enter, per `sendMessageKey`); Shift+Enter adds a line and expands. Esc collapses, then blurs, and focus goes back to where it was before. While busy, Esc still stops (`chat.stopProcessing`). Tab order: +, text, tools, Inbox, main. |
| Accessibility | `role="form"` labelled by the placeholder. The Inbox button has `aria-label` "Inbox, N need you". The waveform is `aria-hidden`. The timer has `aria-live="off"`; Done and Cancel have labels. |

Copy keys go in `packages/shared/src/i18n/locales/*.json`; delete the old `chatInput.placeholder.*` keys and add these:

- `composer.placeholder.reply` ("Reply to {{agent}}")
- `composer.placeholder.start` ("Ask your agents anything")
- `composer.placeholder.about` ("Ask your agents about this {{type}}")
- `composer.send`, `composer.stop`, `composer.addFiles`, `composer.inbox`, `composer.inboxCount_*`, `composer.openInbox`, `composer.nothingNeedsYou`
- `composer.dictate`, `composer.dictationUnavailable`, `composer.cancelDictation`, `composer.done`, `composer.transcribing`
- `composer.error.{noSpeech,unable,notConfigured,micDenied,tooLong}`
- `composer.removeFile`, `composer.retryUpload`

Agent names come from state; there are no hardcoded names.

## (h) Work packages

The order is **W1 first**: it fixes the API and the slot. **W2 to W6 then run in parallel**, each in the files it owns. **W7 comes last.** Every package updates its own part of DESIGN.md (Composer, Dictation, Floating chat, and the empty-state rule).

| WP | Model | Owns (only these files) | Content |
| --- | --- | --- | --- |
| **W1** shell, context and compact bar | Opus | new `R/components/composer/{composer-provider.tsx,use-composer-context.ts,shell-composer.tsx,use-composer-draft.ts}`; `DS/page-frame.tsx` (slot), `DS/page.tsx` (clearance); `R/components/app-shell/app-shell.tsx` (provider); new `DS/composer.tsx` (presentational `Composer`, `ComposerRow`, `ComposerMainButton`) | The state machine, compact and expanded on the glass, the default send path, browser drafts, the Inbox and chat pages registering `mode:'full'`, and a playground entry. |
| **W2** the big refactor: the Craft input to v1 | Opus | `R/components/app-shell/input/*`, `chat-display.tsx` (removes `ChatInputZone`, registers its context), `chat-page.tsx`, `R/components/ui/{rich-text-input,slash-command-menu,label-menu,mention-menu}.tsx`, `app.tsx` draft code | The full mode anatomy and the single main button. Cut slash, `#`, sources, working directory, the context chip and the rotating placeholders, deleting their files, keys and playground entries. Draft RPC calls go. Structured inputs stay. |
| **W3** attachment rail | Sonnet | `DS/attachment.tsx`, new `R/components/composer/attachment-rail.tsx`; deletes `R/components/app-shell/attachment-preview.tsx` and its playground entry | The `FileAttachment` chip in compact and full sizes, the middle cut, states, Retry, and the drag ring. |
| **W4** transcription | Opus (UI), Sonnet (server) | new `packages/shared/src/transcription/*`, `protocol/channels.ts` (one entry), `server-core/.../rpc/transcription.ts` and `rpc/index.ts` (one line), `channel-map.ts` (one line), `R/components/composer/{use-dictation.ts,use-elapsed.ts,waveform.tsx}`, Electron main (media permission), the macOS build plist | The domain, the RPC and the UI, as described in (e). Tests: the ported v1 suite and `ipc-channels.test.ts`. |
| **W5** Inbox icon and popover | Sonnet | new `R/components/composer/{attention-button.tsx,use-attention.ts}` | The count from `useNotifications().unreadCount` (`R/hooks/use-notifications.ts:15`), `sessionMetaMapAtom` (`hasUnread`, `needs-review`; `R/atoms/sessions.ts:43,137`) and `pendingPermissions` (`R/context/app-shell-context.tsx:47`). There is no single count today. |
| **W6** remove EditPopover and add prefill | Sonnet | `R/components/ui/edit-popover.tsx` (deleted), the 19 files that import it except those owned by W2, `editPopover.*` (55 keys × locales), `playground/registry/edit-popover.tsx`, the hidden-session filters (`app.tsx:958`, `app-shell.tsx:428`) | Each trigger (add skill, add source, add routine, edit statuses …) calls `composer.prefill(template)`. `CreateButton`s that open dialogs (task, project, library, member) keep them in this phase. |
| **W7** phones, keyboard, polish | Sonnet | `R/lib/input-viewport.ts`, `R/actions/definitions.ts`, `DS/sonner.tsx` offset, `index.css` safe area | Lifting the bar above the keyboard, safe areas, ⌘J, reduced motion, and a browser pass at 390, 768, 1280 and 1440px in both themes. |

**W1 as built** (6 Oct 2026; DESIGN.md, Components, Composer):

- `DS/composer.tsx` (`Composer` with `compact | expanded | full`, `ComposerInput`, `ComposerRow`, `ComposerMainButton`; the slots are `attachments`, `leading`, `context`, `tools`, `hint`, `attention`, `main`); `DS/page-frame.tsx` gained the `composer` slot and `--composer-clearance`; `DS/page.tsx` reads it.
- `R/components/composer/`: `composer-state.ts` (the reducer, `resolveShellSurface`, `buildFirstMessage`, `sendKeyAction`; tested), `composer-provider.tsx` (`ComposerProvider`, `useComposer`), `use-composer-context.ts`, `use-composer-draft.ts` (localStorage per workspace and key), `shell-composer.tsx`. `composer.focus` is ⌘J (Ctrl+J). Every page registers one line.
- Default send: `onCreateSession`, then `onSendMessage` with `<entity> <text>`, then the chat opens. Seams: a full `chat:` context draws nothing until W2 and the Inbox (full) shows compact; + is disabled until W3; `attention` is empty until W5.
- Found: the chat transcript does not draw `EntityText`, so the `task:<id>` token reads as raw text in the message and in the chat's auto title; W2 (or the chat's message renderer) should draw it as a chip.
- Placeholders are one key per type (`composer.placeholder.{task,project,document,file,routine,page,start}`), not `about` with `{{type}}`: gendered languages need the whole sentence.

**W2 to W4 as built** (6 Oct 2026; DESIGN.md, Components, Composer and Dictation), on the owner's later brief:

- ONE component: `R/components/app-shell/input/free-form-input.tsx` (`FreeFormInput`) is the chat input refactored in place on v1's look, with compact, expanded and full as its modes. `ShellComposer` is a host only. The chat registers its context from `ChatDisplay` (`input/use-chat-composer.tsx`: send, stop, the model picker and status overlay in `tools`, tasks and follow-ups in `chips`, the permission or credential request in `structured`, the `/` commands); plan approval moved to `input/use-plan-approval.ts`. The edit popover draws a second instance of the same component until W6.
- Removed with their code, keys and playground entries: `ChatInputZone`, `InputContainer`, the old `FreeFormInput` body, `ActiveOptionBadges` (permission-mode and status pickers, label badges), the attach, sources and working-directory pickers (`source-selector-popover`, `compact-source-selector`, `compact-working-directory-selector`, `working-directory-selector`, `use-working-directory-state`), `compact-model-selector`, `compact-permission-mode-selector`, `attachment-preview`, the `#` label menu in the input, the rotating placeholders, the context % chip, `composer-height`, `structured-height`, `use-input-available-height`, `scroll-focused-caret`, `use-dynamic-stack`. Kept, used elsewhere: `chat.cyclePermissionMode` (Shift+Tab), `label-menu` (session menus), the drafts RPC in `app.tsx` (the chat page now only moves a draft set there, a link's `input`, into the composer once).
- Commands: `/` holds mode, status, working directory, Compact and Add files; `@` holds skills, sources and files. Files are read when added into the existing `FileAttachment` (stored at send time by `file:storeAttachment`); no upload before send.
- Shortcuts show only while ⌘/Ctrl or Option/Alt is held; the Inbox key is the new `nav.inbox` action (⌘I, Alt+I in the browser).
- Assumed (open questions): 1 yes (three full pages); 2 not done (routing); 3 start the chat and open it; 4 overridden by the brief: only the model picker stays, permission mode is a `/` command; 5 the server side uses the connection (the transcription agent); 6 not in scope (W6); 7 always show the Inbox icon, with a dot (overridden by the owner in W5: only while something needs you).
- Left then: the Inbox popover (done, W5 below). Done since: the Electron microphone permission (`window-manager.ts`, audio-only `media` for the app's pages, `askForMediaAccess` on macOS), `NSMicrophoneUsageDescription` and the `audio-input` entitlement, the toast offset over the bar (`--composer-lift`), and `EditPopover` with its `editPopover.*` keys, playground entry and `InlineExecution` removed.

**W5 as built** (6 Oct 2026; DESIGN.md, Components, Composer, Inbox and Surface), on the owner's brief:

- No popover and no new data layer. `R/components/composer/use-attention.ts` reads what exists: the workspace's chats (as the Chats page filters them: not hidden or archived, the remote workspace's id too) with a pending permission or credential request (`waiting`), then those with `hasUnread` (newest first), then the unread notifications from `useNotifications()`. `count` is all of them.
- `R/components/composer/inbox-button.tsx`: `InboxButton` (only while `count > 0` and nothing is written or attached; `aria-expanded` while open; tooltip label only) and `InboxList`, drawn in `Composer`'s new `panel` slot above the text in the same surface (it grows to the content width and the list's height on the same morph). Its rows are `ListRow size="sm"` (new in `DS/list-group.tsx`); a notification row is the Inbox page's own, moved to `R/pages/inbox/notification-row.tsx` (`useNotificationRow`) and used by both. Pick opens and closes; Escape (capture phase, first), the button again, a click outside or a page change close.
- Keys: `attentionSlot()` in `composer-state.ts` (tested) decides the slot: while a modifier is held, the ONE `Kbd` (the focus key, ⌘J / Ctrl+J), else the Inbox, else nothing. The `hint` slot is gone from `Composer`. `nav.inbox` moved from `app-shell.tsx` into the hosted composer: it toggles the list while the bar shows and something needs you, else it opens the Inbox page (full mode, nothing to show).
- Surface (the owner's later brief): every look wears v1's full composer surface (`SURFACE` in `DS/composer.tsx`: `rounded-xl bg-card ring-1 ring-foreground/10 shadow-xs`, no border; text `p-3 pb-0` as 4 + `px-2 pt-2`, action row gap 8px). The compact bar's dark glass and the full card's `card-surface`/`shadow-sm` are gone. Verified in computed styles against v1's classes; the theme tokens are today's (`--card` in dark is 0.19, v1's 0.205).
- Place (the owner's later brief): the frame's slot is the one place for every look: sides on the column's content edges (`md:px-6`, 0 below 768px), bottom 8px above the body's end; the full look no longer drops the padding. A page with its wrapper down to the body's end and the composer inside (the chat) sets `--wrap-inset` (13px) on the root, and the slot pads by it on both sides and the bottom (`px-(--wrap-inset,…) pb-(--wrap-inset,0.5rem)`). `--composer-lift` is the slot's height, gap included. Measured numbers are in DESIGN.md, Composer, Place.
- Not done: the phone keyboard lift (W7): the list is capped at `min(20rem, 40dvh)` and scrolls, but the bar itself is not lifted above the keyboard yet.

**Risks:**

- `free-form-input.tsx` is 2412 lines. W2 should cut before it restyles and keep `chat.stopProcessing` and the structured-input swap working.
- W2 and W6 both meet `EditPopover` inside `free-form-input.tsx:1537-1546`. W2 owns that file and removes the use; W6 deletes the component last.
- `edit-popover.tsx` and `app-shell.tsx` have uncommitted edits by other agents. Rebase before starting W1 and W6.
- `backdrop-blur` fails inside a masked scroller. The slot must sit outside `PageScroll`.
- Scroll-driven fades need Chromium 115+, which Electron has. Without them, the rail simply shows no fade.
- macOS microphone permission in packaged builds can only be tested on a signed build.

## (i) Open questions for the owner

1. **Which pages are full by default:** new chat, chat and Inbox (three)? *Recommendation: yes, all three; everything else compact.*
2. Should `/` open the Inbox (v1's home) instead of Chats? *Recommendation: yes, but as a separate routing change after the composer.*
3. A send from the compact composer on a task: should it start a chat about the task and open it, or open a floating chat window over the page as in v1? *Recommendation: start the chat and open it; no window.*
4. Which Craft pickers stay in the full composer? *Recommendation: keep model (with thinking) and permission mode; cut sources, working directory, `#` labels and the context chip.*
5. Should dictation use the workspace's OpenRouter connection or a server `OPENROUTER_API_KEY` as in v1? *Recommendation: the connection (it lives in the providers domain and needs no new environment variable).*
6. Should every "+" prefill the composer now, or only the actions `EditPopover` handles today? *Recommendation: only the `EditPopover` actions now; the task, project and library dialogs stay until agents have the tools to create those.*
7. Should the Inbox icon always show on the compact bar, or only while something needs you (v1)? *Recommendation: always show it, with a dot when there is something, so the bar keeps its shape.*

## Transcription (built)

Server side of dictation (W4), 6 Oct 2026. The UI keeps capture, level and timer on the client; the server only turns one finished recording into text.

- **Channel:** `RPC_CHANNELS.transcription.CREATE` = `'transcription:create'`. Renderer API: `window.electronAPI.transcribe(audioBase64: string, type: string): Promise<{ text: string }>` (`channel-map.ts` key `transcribe`, typed in `shared/types.ts`).
- **Payload:** the whole take, not a stream. `MediaRecorder` chunks (250 ms) are joined on the client into one `Blob`; send its bytes as base64 and its `blob.type` (must start with `audio/`, for example `audio/webm;codecs=opus`). Up to 10 MiB of audio. Cancel is client-side: drop the chunks and send nothing. A request already sent cannot be cancelled; ignore its reply.
- **Reply:** `{ text }`, trimmed. An empty `text` means no speech (show the "No speech detected" toast). There are no server events: the waveform level and the timer come from the client's `AnalyserNode` as in v1.
- **Errors** (a rejected invoke; read `error.code`): `not_configured` (no `openrouter` connection visible to this user and workspace: show "Connect {{provider}} to dictate" and keep the mic enabled), `too_large`, `invalid` (not `audio/*`, or empty), `timeout`, `unavailable` (provider down or rate limited), `failed`. The messages carry no provider body.
- **Authorization:** members only, per request. The channel takes no workspace argument; it runs in the connection's workspace, which the guard re-checks as a member on every request (`bootstrap/authorize.ts`, covered by `authorize.isolated.ts`).
- **Key and model:** the `openrouter` connection's API key, found through the connections domain (the user's own first, then the workspace's, then the install's); the value never leaves the server. The model is fixed to `mistralai/voxtral-mini-transcribe` (no setting yet). Hedging and one retry as in v1.
- **Code:** `packages/shared/src/transcription/index.ts` (`runTranscription(where, audio, type, deps?)`, `TRANSCRIPTION_ERROR_CODES`, `TRANSCRIPTION_MAX_BYTES`), handler `packages/server-core/src/handlers/rpc/transcription.ts`. Not done here: the Electron media permission and the macOS plist (W4 UI).
