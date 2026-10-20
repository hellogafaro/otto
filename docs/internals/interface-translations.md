# Interface translations

Interface language is a client preference, not environment state. A browser profile and an Electron profile must be able to choose independently while connected to the same environment. Language changes must never dispatch orchestration commands or rewrite stored content.

## Catalog conventions

The framework-free implementation lives in `packages/client-runtime/src/i18n`. React adapters own subscriptions and persistence. Device locale resolution is explicit so shared code does not depend on browser or native globals.

English is the source and fallback language. The initial shipped set is English and Simplified Chinese (`zh-CN`). Traditional Chinese and other locales fall back to English. Test-only catalogs do not count as shipped translations. Additional languages load through the same lazy registry.

Use shared messages when the meaning is the same. Translate static interface copy at its rendering boundary. Preserve whole sentences and named interpolation parameters rather than joining translated fragments. Plural messages need an `other` form and should use `Intl.PluralRules`; use the selected locale's `Intl` date and number formatters rather than formatting on the environment server.

Keep routing keys, command IDs, preference values, shortcut chords, and wire enums stable. Localized Settings search and command results must retain English search aliases. Translate accessible names, descriptions, placeholders, dialogs, and empty states along with visible labels.

Catalog validation checks missing and unknown entries and matching interpolation parameters. Partial catalogs fall back to English at runtime. Parameter values are substituted once, never parsed as another template. Do not register or eagerly import unapproved locales. When additional locales are approved, load only the selected catalog and retain English fallback while it loads or if loading fails.

## Content boundary

Never pass these values through translation lookup:

- Stored user or bot messages, instructions, bot names, or conversation titles.
- Source code, filesystem paths, URLs, model names, connector names, or provider output.
- Protocol identifiers, persisted enum values, error tags, and log messages.
- Interface text that becomes user content, such as the onboarding bot brief and reply quotes inserted into the prompt. It is sent as a message, so it stays in the source language.

Display translated explanatory error copy by matching a stable error code at the client boundary. Keep raw provider diagnostics intact and separate. Unknown codes need a generic English explanation, not a translation key. Adding translation infrastructure does not make existing raw error displays localized.

Connection failures follow this rule. `EnvironmentConnectionPresentation.errorCode` in `packages/client-runtime/src/connection/presentation.ts` carries the failure reason from the connection state machine (`ConnectionTransientReason` or `ConnectionBlockedReason`). `connectionFailureMessage` maps each code to one catalog sentence, and `translateConnectionStatus` builds the status line from the phase and that sentence. The raw `error` string never goes through translation. Web shows it in the status tooltip's `title`. A new failure code must be added to `connectionFailureMessage`, which the type checker enforces.

## Coverage and release gate

English extraction is incremental. A catalog's existence is not evidence that every route uses it. `coverage.test.ts` snapshots every file that calls the translator, the number of literal messages, and the finite label sources it checks, so a change in coverage shows up in review.

| Interface area                      | Web and desktop renderer                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Language preference and selector    | Client settings, Settings > General                                              |
| Settings                            | Rail, breadcrumb, searchable row titles, General, Providers, Connections pairing |
| Settings search and command palette | Translated labels plus English search aliases                                    |
| Pairing                             | Pairing route                                                                    |
| Roster and home                     | Roster sidebar, empty roster, new bot and new group dialogs, group details       |
| Chat                                | Bot and group chat views, landing pages, prompts, delegation cards, composer     |
| Chat dates and times                | Date dividers and routine receipt times use the interface locale                 |
| Provider availability               | Model pickers, bot engine row, no-provider banner                                |
| Bot settings                        | Settings page, details panel, channels and tools sheets, usage, model pickers    |
| Onboarding and errors               | Desktop onboarding and the root error view                                       |
| Connection errors                   | Stable-code status line; raw detail in tooltip                                   |
| Confirm dialogs and alerts          | Dialog buttons and fallback title; caller messages translated where owned        |
| Memory                              | Memory sheet, durable facts, transfer and import review, Privacy > Memory        |
| Routines                            | Routine panel, routine form, and routine receipts in chat                        |
| Approved non-English catalogs       | Simplified Chinese (`zh-CN`)                                                     |

The coverage test scans every file that imports `useI18n`, plus a short explicit list of plain modules that translate through a passed-in or module-level translator: `command-palette.logic.ts`, `composer-provider-menu-items.ts`, the onboarding logic modules, `botInbox.ts`, `durable-memory.ts`, `imageGeneration.ts`, `provider-availability.ts`, and `errors/thread-error-presentation.ts` in client-runtime, and `bot-engine-selection.ts`, `routine-receipts.ts`, and `settings-panels.logic.ts` in the web app. Plural forms passed to `plural` are extracted as messages too.

### Untranslated exceptions

These surfaces render English in every language. Each is a known gap, not a claim of coverage.

- Desktop native shell: the application menu, context menus built in the main process, updater dialogs, and the startup splash (`desktop-application-menu.ts`, `desktop-window.ts`, startup assets). Electron's built-in menu roles follow the operating system. Translating them needs a client-local preference bridge into the main process, a menu rebuild on change, and Electron restart verification.
- Web workspace tools: the file browser, code-block diffs, project scripts, and preview panels. Font previews in Settings also render English sample text.
- Web Settings section bodies outside General. Row titles translate everywhere through Settings search, but descriptions, controls, and dialogs in Appearance and the theme editor, Keybindings, Bot channels setup, Voice, Image generation, Browser, Plugins, Sandbox, Privacy (except Memory), Connections access details, Source control and writing style, Errors, Diagnostics, and project settings render English.
- Desktop update tooltips and toasts built in `desktop-update.logic.ts` and `provider-updates.logic.ts`.
- Web roster timestamps and the chat timestamp tooltip format with the browser or host locale, not the interface language (`roster.logic.ts`, `bot-roster-sidebar.tsx`, `timestamp-format.ts`).
- Channel origin labels and shared composer mention labels in `packages/client-runtime` and `packages/shared`.
- Toast titles and descriptions raised from non-component code outside the translated areas, and confirm dialog messages passed by callers in those areas.
- Raw error text from providers, the environment server, git, and the operating system. It is shown as received, next to a translated explanation where a stable code exists.
- Raw provider diagnostics in Settings > Providers and desktop onboarding: command failure messages, login flow errors, a failed API key save reason, and the last failed request message from a provider check. The page shows them as received and falls back to translated copy only when the server sends no message.

Content that is never translated, by design, is listed under Content boundary above. In memory and routine screens that includes fact text, memory documents, the `USER.md`, `MEMORY.md`, and `GROUP.md` file names, routine names and instructions, run summaries, and timezone names.

Shared helpers that build copy outside React, such as the durable memory labels in `packages/client-runtime/src/durable-memory.ts` and the routine schedule and receipt helpers on web, export catalog keys or take an optional translator that defaults to English. Components pass the active translator; tests and non-React callers get English. Durable fact failures return a catalog message chosen from the failure's stable tag, with the raw server detail kept separate and appended as received.

### Bundle cost

Measured with production web builds on 2026-09-23. The startup set is every script and stylesheet `index.html` loads or preloads.

| Build                                | Startup files | Raw bytes | Gzip bytes |
| ------------------------------------ | ------------- | --------- | ---------- |
| Before translations                  | 4             | 4,661,037 | 1,343,601  |
| Phase 1 (settings, pairing, palette) | 5             | 4,690,879 | 1,353,581  |
| Web chat surfaces                    | 10            | 4,764,677 | 1,380,723  |
| Durable memory merged, untranslated  | 10            | 4,785,827 | 1,385,924  |
| Memory and routines translated       | 10            | 4,800,158 | 1,390,185  |
| Delta from before translations       | +6            | +139,121  | +46,584    |
| `zh-CN` catalog, on demand           | separate      | 68,466    | 24,735     |

Translating memory and routines added 14,331 raw and 4,261 gzip bytes to the startup set, almost all of it English catalog entries. The `zh-CN` chunk grew from 59,202 raw and 21,730 gzip bytes. Gzip figures use `gzip -9`.

The first extra startup file is Vite's preload helper, split out by the catalog's dynamic import. The other five are shared chunks (`select`, `useButton`, and three small hooks) that the bundler split out of code already loaded at startup. They add no new startup code. Most of the growth is the English catalog in the entry chunk, because English is the source and fallback. The `zh-CN` chunk loads only when that language is selected or resolved from the device.

### Verification still owed

Verify every translated route in Simplified Chinese and in English. Exercise switching back, reset to system, restart and reconnect, two clients with different languages, unsupported locales, missing messages, connection errors, long strings, narrow layouts, CJK text, and large text sizes. Browser screenshots alone do not prove these behaviors; Electron needs its own integrated checks.
