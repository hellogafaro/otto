# The composer

## One full composer everywhere

`ShellComposer` hosts one `FreeFormInput` in the `PageFrame` bottom slot. It stays
mounted as pages change; pages provide context with `useComposerContext`. There
are no compact, expanded or full variants, size controls, collapse state or
centered Home placement. Responsive width and content-driven height remain.

The shared presentation lives in `design/ui/src/components/composer.tsx`:
attachments and page chips, multiline text, then an action row with Add files,
the page entity, optional chat tools and the main action. It uses the card color,
12px corners, a 1px foreground/10 ring and `shadow-xs`. Text starts 12px inside
the surface and grows up to 240px before scrolling. The action row has 32px
controls, 8px apart and 4px inside the surface. Dictation hides the still-mounted
text field and fills the action row with its waveform and timer.

The frame measures the composer's height and reserves that height, the bottom
gap and `--composer-gap` above it in the page scroll region. The last block can
scroll fully above the composer. The same slot publishes `--composer-lift` for
toasts. The composer stays on the column's content edges: 24px inside the 768px
track on desktop, the frame's 20px gutters below 768px, and 8px above the body's
bottom. Content height animates on the existing morph curve; reduced motion
disables that transition.

Home uses the same `PageHeader` and `PageColumn` anatomy as Settings. Its greeting
is the normal title, its prompt is the header description, and the existing
Tasks, Chats, Notifications and Routines cards stack in one column. Home has no
composer anchor, dashboard grid or wallpaper.

## Context and state

`ComposerContext` supplies the draft key, optional entity token and placeholder,
the current session ID, optional send/stop handlers, tools, chips, image notice,
structured request, send availability, working directory and chat commands.
It has no size or mode field. `useComposer()` exposes `prefill`, `focus` and
`take`; there is no expand/collapse API.

`useComposerDraft` stores drafts by workspace and context. An existing page draft
wins on navigation; otherwise the current text follows navigation within the
workspace. Files stay in the mounted composer. Chat events remain scoped to the
session: focus, paste files, restore an interrupted prompt and submit a follow-up.
When there is no page context, no composer surface is drawn.

The chat's own send path stays authoritative. Other pages create a new chat and
lead the first message with the page's entity token, when present. Attachments,
skill mentions and source mentions retain their existing send behavior.
Permissions and credential requests replace the composer body until answered.

## Input and actions

- The rich text editor keeps `@` badges and the mention menu for people, agents,
  tasks, projects, skills, sources and files. The existing slash commands stay.
- Enter or the configured Cmd/Ctrl+Enter sends. Shift+Enter adds a line. An open
  inline menu and IME composition retain priority. Escape blurs without changing
  the size or discarding the draft. The global composer focus action remains.
- Arrow Up on an empty draft while processing stops the run and recalls its
  prompt under the existing event guards.
- Add files, drop and paste use `useComposerFiles`. Long pasted text becomes an
  attachment. The rail always uses two-line `sm` chips with kind/size, loading,
  removal and retry states.
- The main action priority remains Sending, Stop, Transcribing, Done, Send,
  Dictate. Tooltips show shortcut keys with `Kbd`.
- `useDictation` retains microphone capture, transcription and cancellation.
  Dictated text inserts at the caret. Enter finishes a recording and Escape
  cancels recording or transcription.

Notifications remain accessible through Home and the Notifications page. The
compact-only composer attention slot, embedded notification list and
held-modifier hint are removed.

## Phones and verification

The web host's existing `visualViewport` sizing and keyboard safe-area handling
remain unchanged. The full composer narrows with the page track; this is not a
separate mobile mode. Existing mention/menu placement accounts for the root zoom
and visible viewport.

Focused tests cover send keys, action priority, draft selection, file metadata,
dictation mapping, mentions, Home rules and scoped input guards. Integration
verification should exercise Home, Settings and an existing chat at desktop and
phone widths, scroll the final page block above the composer, open the on-screen
keyboard, focus with the shortcut, add/remove an attachment, pick a mention,
send/stop/recall in a disposable chat, and display a pending structured request.
