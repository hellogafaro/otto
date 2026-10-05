# UI rebuild checklist

The renderer is rebuilt in place on our shadcn (Base UI) design system, screen by screen,
so nothing Craft has is dropped. A file is done when it uses the design system's
components and the rules in `DESIGN.md`, and was looked at in light and dark.

**Order:** foundation (React 19, `@workspace/ui` in the renderer, Radix adapters) →
shell → settings → connection sign-in → chat → everything else. Tick as you go.

**Shell (done as a skeleton):** the sidebar on the frame, the one `ContentCard` with
`PageHeader`, the `FloatingCard` slot, floating Back / Previous / Next and the
floating action are in. The top bar, the rail and the panel stack (several panels
side by side, open in a new panel, `?panels=`) are deleted. Pages move onto the
page anatomy (DESIGN.md, Page anatomy) one by one; the settings pages are the
reference. Interim: Sources, Skills, Projects and Schedules still render their
old list panels in the sidebar's section; the chat transcript, the info pages and
the Documents library keep their own insets inside the card.


## Shell and chrome

- [x] `components/app-shell/app-sidebar.tsx`
- [x] `components/app-shell/page-header.tsx`
- [x] `components/app-shell/session-filter-menu.tsx`
- [x] `components/app-shell/sidebar-section.tsx`
- [ ] `components/app-shell/active-option-badges.tsx`
- [ ] `components/app-shell/active-tasks-bar.tsx`
- [x] `components/app-shell/app-shell.tsx`
- [ ] `components/app-shell/attachment-preview.tsx`
- [ ] `components/app-shell/background-finished-chip.tsx`
- [ ] `components/app-shell/batch-session-menu.tsx`
- [ ] `components/app-shell/chat-display.tsx`
- [ ] `components/app-shell/compact-session-menu.tsx`
- [x] `components/app-shell/fab-new-chat.tsx`
- [x] `components/app-shell/left-sidebar.tsx`
- [x] `components/app-shell/main-content-panel.tsx`
- [ ] `components/app-shell/multi-select-panel.tsx`
- [ ] `components/app-shell/panel.tsx`
- [ ] `components/app-shell/project-multi-select-filter.tsx`
- [ ] `components/app-shell/projects-list-panel.tsx`
- [ ] `components/app-shell/send-resource-to-workspace-dialog.tsx`
- [ ] `components/app-shell/send-to-workspace-dialog.tsx`
- [ ] `components/app-shell/session-badges.tsx`
- [ ] `components/app-shell/session-info-popover.tsx`
- [ ] `components/app-shell/session-item.tsx`
- [ ] `components/app-shell/session-list.tsx`
- [ ] `components/app-shell/session-menu.tsx`
- [ ] `components/app-shell/session-menu-parts.tsx`
- [ ] `components/app-shell/session-project-color-wrapper.tsx`
- [ ] `components/app-shell/session-search-header.tsx`
- [ ] `components/app-shell/session-status-icon.tsx`
- [ ] `components/app-shell/setup-auth-banner.tsx`
- [ ] `components/app-shell/sidebar-menu.tsx`
- [ ] `components/app-shell/skill-menu.tsx`
- [ ] `components/app-shell/skills-list-panel.tsx`
- [ ] `components/app-shell/source-menu.tsx`
- [ ] `components/app-shell/sources-list-panel.tsx`
- [ ] `components/app-shell/task-action-menu.tsx`
- [ ] `components/app-shell/transport-connection-banner.tsx`
- [x] `components/app-shell/workspace-switcher.tsx`

## Pages (5)

- [ ] `pages/chat-page.tsx`
- [ ] `pages/project-info-page.tsx`
- [ ] `pages/shortcuts-page.tsx`
- [ ] `pages/skill-info-page.tsx`
- [ ] `pages/source-info-page.tsx`

## Settings pages (12)

- [ ] `pages/settings/ai-settings-page.tsx`
- [ ] `pages/settings/app-settings-page.tsx`
- [ ] `pages/settings/appearance-settings-page.tsx`
- [ ] `pages/settings/input-settings-page.tsx`
- [ ] `pages/settings/labels-settings-page.tsx`
- [ ] `pages/settings/messaging-settings-page.tsx`
- [ ] `pages/settings/permissions-settings-page.tsx`
- [ ] `pages/settings/preferences-page.tsx`
- [ ] `pages/settings/server-settings-page.tsx`
- [x] `pages/settings/settings-navigator.tsx`
- [ ] `pages/settings/shortcuts-page.tsx`
- [ ] `pages/settings/workspace-settings-page.tsx`

## Onboarding and sign-in (10)

- [ ] `components/onboarding/api-setup-step.tsx`
- [ ] `components/onboarding/completion-step.tsx`
- [ ] `components/onboarding/credentials-step.tsx`
- [ ] `components/onboarding/git-bash-warning.tsx`
- [ ] `components/onboarding/local-model-step.tsx`
- [ ] `components/onboarding/onboarding-wizard.tsx`
- [ ] `components/onboarding/provider-select-step.tsx`
- [ ] `components/onboarding/welcome-step.tsx`
- [ ] `components/onboarding/primitives.tsx`

## Connection setup (2)

- [ ] `components/apisetup/api-key-input.tsx`
- [ ] `components/apisetup/oauth-connect.tsx`

## Chat (2)

- [ ] `components/chat/auth-request-card.tsx`
- [ ] `components/chat/empty-state-hint.tsx`

## Session info (1)

- [ ] `components/session-info/session-files-section.tsx`

## Automations (13)

- [ ] `components/automations/action-type-icon.tsx`
- [ ] `components/automations/automation-action-preview.tsx`
- [ ] `components/automations/automation-action-row.tsx`
- [ ] `components/automations/automation-avatar.tsx`
- [ ] `components/automations/automation-card.tsx`
- [ ] `components/automations/automation-event-timeline.tsx`
- [ ] `components/automations/automation-info-page.tsx`
- [ ] `components/automations/automation-menu.tsx`
- [ ] `components/automations/automation-test-panel.tsx`
- [ ] `components/automations/automations-list-panel.tsx`
- [ ] `components/automations/batch-automation-menu.tsx`
- [ ] `components/automations/cron-builder.tsx`
- [ ] `components/automations/phase-badge.tsx`

## Projects (1)

- [ ] `components/projects/create-project-dialog.tsx`

## Workspace (8)

- [x] `components/workspace/add-workspace-step-choice.tsx`
- [x] `components/workspace/add-workspace-step-connect-remote.tsx`
- [x] `components/workspace/add-workspace-step-create-new.tsx`
- [x] `components/workspace/add-workspace-step-open-folder.tsx`
- [x] `components/workspace/add-workspace-radio-option.tsx`
- [x] `components/workspace/workspace-creation-screen.tsx`
- [x] `components/workspace/workspace-picker.tsx`
- [x] `components/workspace/primitives.tsx`

## Files and preview (1)

- [ ] `components/files/file-viewer.tsx`

## Info panels (13)

- [ ] `components/info/auto-rules-data-table.tsx`
- [ ] `components/info/info-alert.tsx`
- [ ] `components/info/info-badge.tsx`
- [ ] `components/info/info-data-table.tsx`
- [ ] `components/info/info-grouped-list.tsx`
- [ ] `components/info/info-markdown.tsx`
- [ ] `components/info/info-page.tsx`
- [ ] `components/info/info-section.tsx`
- [ ] `components/info/info-status-badge.tsx`
- [ ] `components/info/info-table.tsx`
- [ ] `components/info/labels-data-table.tsx`
- [ ] `components/info/permissions-data-table.tsx`
- [ ] `components/info/tools-data-table.tsx`

## Messaging (13)

- [ ] `components/messaging/lark-connect-dialog.tsx`
- [ ] `components/messaging/messaging-dialog-host.tsx`
- [ ] `components/messaging/messaging-platform-icon.tsx`
- [ ] `components/messaging/messaging-session-menu-item.tsx`
- [ ] `components/messaging/pairing-code-dialog.tsx`
- [ ] `components/messaging/telegram-connect-dialog.tsx`
- [ ] `components/messaging/telegram-supergroup-pairing-dialog.tsx`
- [ ] `components/messaging/whats-app-connect-dialog.tsx`
- [ ] `components/messaging/access/access-mode-banner.tsx`
- [ ] `components/messaging/access/binding-allow-list-popover.tsx`
- [ ] `components/messaging/access/owners-list-editor.tsx`
- [ ] `components/messaging/access/pending-senders-list.tsx`
- [ ] `components/messaging/access/telegram-access-section.tsx`

## Browser (3)

- [ ] `components/browser/browser-tab-badge.tsx`
- [ ] `components/browser/browser-tab-strip.tsx`
- [ ] `components/browser/browser-toolbar.tsx`

## Markdown (1)

- [ ] `components/markdown/streaming-markdown.tsx`

## Settings building blocks (12)

- [ ] `components/settings/searchable-model-input.tsx`
- [ ] `components/settings/settings-card.tsx`
- [ ] `components/settings/settings-edit-row.tsx`
- [ ] `components/settings/settings-input.tsx`
- [ ] `components/settings/settings-menu-select.tsx`
- [ ] `components/settings/settings-radio-group.tsx`
- [ ] `components/settings/settings-row.tsx`
- [ ] `components/settings/settings-section.tsx`
- [ ] `components/settings/settings-segmented-control.tsx`
- [ ] `components/settings/settings-select.tsx`
- [ ] `components/settings/settings-textarea.tsx`
- [ ] `components/settings/settings-toggle.tsx`

## Top-level components (5)

- [ ] `components/keyboard-shortcuts.tsx`
- [ ] `components/keyboard-shortcuts-dialog.tsx`
- [ ] `components/server-directory-browser.tsx`
- [ ] `components/splash-screen.tsx`

## UI primitives to swap for the design system (72)

- [ ] `components/ui/compact-source-selector.tsx`
- [ ] `components/ui/compact-working-directory-selector.tsx`
- [ ] `components/ui/edit-popover.tsx`
- [ ] `components/ui/header-icon-button.tsx`
- [ ] `components/ui/source-selector-popover.tsx`
- [ ] `components/ui/action-menu-item.tsx`
- [ ] `components/ui/action-tooltip.tsx`
- [ ] `components/ui/avatar-group.tsx`
- [ ] `components/ui/avatar.tsx`
- [ ] `components/ui/badge.tsx`
- [ ] `components/ui/button.tsx`
- [ ] `components/ui/calendar.tsx`
- [ ] `components/ui/collapsible.tsx`
- [ ] `components/ui/color-picker.tsx`
- [ ] `components/ui/command.tsx`
- [ ] `components/ui/context-menu.tsx`
- [ ] `components/ui/data-table.tsx`
- [ ] `components/ui/dialog.tsx`
- [ ] `components/ui/drawer.tsx`
- [ ] `components/ui/dropdown-menu.tsx`
- [ ] `components/ui/empty.tsx`
- [ ] `components/ui/entity-icon.tsx`
- [ ] `components/ui/entity-list-badge.tsx`
- [ ] `components/ui/entity-list-empty.tsx`
- [ ] `components/ui/entity-list-label-badge.tsx`
- [ ] `components/ui/entity-list.tsx`
- [ ] `components/ui/entity-panel.tsx`
- [ ] `components/ui/entity-row.tsx`
- [ ] `components/ui/fading-text.tsx`
- [ ] `components/ui/gradient-resize-handle.tsx`
- [ ] `components/ui/horizontal-resize-handle.tsx`
- [ ] `components/ui/inline-color-picker-row.tsx`
- [ ] `components/ui/input.tsx`
- [ ] `components/ui/kbd.tsx`
- [ ] `components/ui/label-badge-row.tsx`
- [ ] `components/ui/label-icon.tsx`
- [ ] `components/ui/label-menu.tsx`
- [ ] `components/ui/label-value-popover.tsx`
- [ ] `components/ui/label.tsx`
- [ ] `components/ui/mention-badge.tsx`
- [ ] `components/ui/mention-menu.tsx`
- [ ] `components/ui/menu-context.tsx`
- [ ] `components/ui/metadata-badge.tsx`
- [ ] `components/ui/popover.tsx`
- [ ] `components/ui/rename-dialog.tsx`
- [ ] `components/ui/resizable.tsx`
- [ ] `components/ui/rich-text-input.tsx`
- [ ] `components/ui/scroll-area.tsx`
- [ ] `components/ui/select.tsx`
- [ ] `components/ui/separator.tsx`
- [ ] `components/ui/service-logo.tsx`
- [ ] `components/ui/session-status-menu.tsx`
- [ ] `components/ui/skill-avatar.tsx`
- [ ] `components/ui/skill-mention-menu.tsx`
- [ ] `components/ui/slash-command-menu.tsx`
- [ ] `components/ui/sonner.tsx`
- [ ] `components/ui/sortable-list.tsx`
- [ ] `components/ui/source-avatar.tsx`
- [ ] `components/ui/source-status-indicator.tsx`
- [ ] `components/ui/status-icon.tsx`
- [ ] `components/ui/styled-context-menu.tsx`
- [ ] `components/ui/styled-dropdown.tsx`
- [ ] `components/ui/switch.tsx`
- [ ] `components/ui/table.tsx`
- [ ] `components/ui/tabs.tsx`
- [ ] `components/ui/textarea.tsx`
- [ ] `components/ui/window-header-badge.tsx`
- [ ] `components/ui/workspace-avatar.tsx`

## Rule: finish a swap, delete what it replaced

A swap is not done until the old thing is gone: no adapter, no import, no dependency.
For each row, the last step is `grep` finding nothing, then removing the package from
every `package.json` and running `bun install` so the lockfile drops it.

| Old | Replaced by | Gone when |
| --- | --- | --- |
| `@radix-ui/*` (context-menu, dialog, dropdown-menu, label, popover, scroll-area, select, separator, slot, switch, tabs, tooltip, avatar, collapsible) | Base UI via `@workspace/ui` | `grep -r "@radix-ui" apps packages` is empty |
| The `asChild` adapter (`components/ui/as-child.tsx`) and every `asChild` prop | `render` prop | no `asChild` left in `apps/electron` and `packages/ui` |
| Craft's own primitives in `components/ui/` that have a design-system twin | `@workspace/ui/components/*` imported directly | the Craft file is deleted and call sites import the design system |
| `@remixicon/react` (the design system's icons, ~15 files) | `lucide-react`, which Craft already uses and we keep | `grep -r "@remixicon" apps packages design` is empty, `iconLibrary` in `design/ui/components.json` is `lucide`, DESIGN.md says Lucide |
| `vaul` (drawer), `cmdk` duplicates, other Radix-adjacent helpers | the design system's sheet and command | no import left |
| `packages/ui` primitives that duplicate `design/ui` | `design/ui` | file deleted |
| Craft theme tokens that shadcn now owns | `design/ui/src/styles/globals.css` | no duplicate variable in `index.css` |

Check before removing a dependency: `grep -rn "<package>" apps packages --include=*.ts --include=*.tsx --include=*.css`
must be empty, then typecheck, tests and one look in the browser.
