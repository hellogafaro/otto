# UI rebuild checklist

The renderer is rebuilt in place on our shadcn (Base UI) design system, screen by screen,
so nothing Craft has is dropped. A file is done when it uses the design system's
components and the rules in `DESIGN.md`, and was looked at in light and dark.

**Order:** foundation (React 19, `@workspace/ui` in the renderer, Radix adapters) →
shell → settings → connection sign-in → chat → everything else. Tick as you go.


## Shell and chrome (45)

- [ ] `components/app-shell/ActiveOptionBadges.tsx`
- [ ] `components/app-shell/ActiveTasksBar.tsx`
- [ ] `components/app-shell/AppRail.tsx`
- [ ] `components/app-shell/AppShell.tsx`
- [ ] `components/app-shell/AttachmentPreview.tsx`
- [ ] `components/app-shell/BackgroundFinishedChip.tsx`
- [ ] `components/app-shell/BatchSessionMenu.tsx`
- [ ] `components/app-shell/ChatDisplay.tsx`
- [ ] `components/app-shell/CompactPanelTransition.tsx`
- [ ] `components/app-shell/CompactSessionListFilter.tsx`
- [ ] `components/app-shell/CompactSessionMenu.tsx`
- [ ] `components/app-shell/CompactWorkspaceSwitcher.tsx`
- [ ] `components/app-shell/FabNewChat.tsx`
- [ ] `components/app-shell/LeftSidebar.tsx`
- [ ] `components/app-shell/MainContentPanel.tsx`
- [ ] `components/app-shell/MultiSelectPanel.tsx`
- [ ] `components/app-shell/NavigatorPanel.tsx`
- [ ] `components/app-shell/Panel.tsx`
- [ ] `components/app-shell/PanelHeader.tsx`
- [ ] `components/app-shell/PanelResizeSash.tsx`
- [ ] `components/app-shell/PanelSlot.tsx`
- [ ] `components/app-shell/PanelStackContainer.tsx`
- [ ] `components/app-shell/ProjectMultiSelectFilter.tsx`
- [ ] `components/app-shell/ProjectsListPanel.tsx`
- [ ] `components/app-shell/SendResourceToWorkspaceDialog.tsx`
- [ ] `components/app-shell/SendToWorkspaceDialog.tsx`
- [ ] `components/app-shell/SessionBadges.tsx`
- [ ] `components/app-shell/SessionInfoPopover.tsx`
- [ ] `components/app-shell/SessionItem.tsx`
- [ ] `components/app-shell/SessionList.tsx`
- [ ] `components/app-shell/SessionMenu.tsx`
- [ ] `components/app-shell/SessionMenuParts.tsx`
- [ ] `components/app-shell/SessionProjectColorWrapper.tsx`
- [ ] `components/app-shell/SessionSearchHeader.tsx`
- [ ] `components/app-shell/SessionStatusIcon.tsx`
- [ ] `components/app-shell/SetupAuthBanner.tsx`
- [ ] `components/app-shell/SidebarMenu.tsx`
- [ ] `components/app-shell/SkillMenu.tsx`
- [ ] `components/app-shell/SkillsListPanel.tsx`
- [ ] `components/app-shell/SourceMenu.tsx`
- [ ] `components/app-shell/SourcesListPanel.tsx`
- [ ] `components/app-shell/TaskActionMenu.tsx`
- [ ] `components/app-shell/TopBar.tsx`
- [ ] `components/app-shell/TransportConnectionBanner.tsx`
- [ ] `components/app-shell/WorkspaceSwitcher.tsx`

## Pages (5)

- [ ] `pages/ChatPage.tsx`
- [ ] `pages/ProjectInfoPage.tsx`
- [ ] `pages/ShortcutsPage.tsx`
- [ ] `pages/SkillInfoPage.tsx`
- [ ] `pages/SourceInfoPage.tsx`

## Settings pages (12)

- [ ] `pages/settings/AiSettingsPage.tsx`
- [ ] `pages/settings/AppSettingsPage.tsx`
- [ ] `pages/settings/AppearanceSettingsPage.tsx`
- [ ] `pages/settings/InputSettingsPage.tsx`
- [ ] `pages/settings/LabelsSettingsPage.tsx`
- [ ] `pages/settings/MessagingSettingsPage.tsx`
- [ ] `pages/settings/PermissionsSettingsPage.tsx`
- [ ] `pages/settings/PreferencesPage.tsx`
- [ ] `pages/settings/ServerSettingsPage.tsx`
- [ ] `pages/settings/SettingsNavigator.tsx`
- [ ] `pages/settings/ShortcutsPage.tsx`
- [ ] `pages/settings/WorkspaceSettingsPage.tsx`

## Onboarding and sign-in (10)

- [ ] `components/onboarding/APISetupStep.tsx`
- [ ] `components/onboarding/CompletionStep.tsx`
- [ ] `components/onboarding/CredentialsStep.tsx`
- [ ] `components/onboarding/GitBashWarning.tsx`
- [ ] `components/onboarding/LocalModelStep.tsx`
- [ ] `components/onboarding/OnboardingWizard.tsx`
- [ ] `components/onboarding/ProviderSelectStep.tsx`
- [ ] `components/onboarding/ReauthScreen.tsx`
- [ ] `components/onboarding/WelcomeStep.tsx`
- [ ] `components/onboarding/primitives.tsx`

## Connection setup (2)

- [ ] `components/apisetup/ApiKeyInput.tsx`
- [ ] `components/apisetup/OAuthConnect.tsx`

## Chat (2)

- [ ] `components/chat/AuthRequestCard.tsx`
- [ ] `components/chat/EmptyStateHint.tsx`

## Right sidebar (1)

- [ ] `components/right-sidebar/SessionFilesSection.tsx`

## Automations (13)

- [ ] `components/automations/ActionTypeIcon.tsx`
- [ ] `components/automations/AutomationActionPreview.tsx`
- [ ] `components/automations/AutomationActionRow.tsx`
- [ ] `components/automations/AutomationAvatar.tsx`
- [ ] `components/automations/AutomationCard.tsx`
- [ ] `components/automations/AutomationEventTimeline.tsx`
- [ ] `components/automations/AutomationInfoPage.tsx`
- [ ] `components/automations/AutomationMenu.tsx`
- [ ] `components/automations/AutomationTestPanel.tsx`
- [ ] `components/automations/AutomationsListPanel.tsx`
- [ ] `components/automations/BatchAutomationMenu.tsx`
- [ ] `components/automations/CronBuilder.tsx`
- [ ] `components/automations/PhaseBadge.tsx`

## Projects (1)

- [ ] `components/projects/CreateProjectDialog.tsx`

## Workspace (8)

- [ ] `components/workspace/AddWorkspaceStep_Choice.tsx`
- [ ] `components/workspace/AddWorkspaceStep_ConnectRemote.tsx`
- [ ] `components/workspace/AddWorkspaceStep_CreateNew.tsx`
- [ ] `components/workspace/AddWorkspaceStep_OpenFolder.tsx`
- [ ] `components/workspace/AddWorkspace_RadioOption.tsx`
- [ ] `components/workspace/WorkspaceCreationScreen.tsx`
- [ ] `components/workspace/WorkspacePicker.tsx`
- [ ] `components/workspace/primitives.tsx`

## Files and preview (1)

- [ ] `components/files/FileViewer.tsx`

## Info panels (13)

- [ ] `components/info/AutoRulesDataTable.tsx`
- [ ] `components/info/Info_Alert.tsx`
- [ ] `components/info/Info_Badge.tsx`
- [ ] `components/info/Info_DataTable.tsx`
- [ ] `components/info/Info_GroupedList.tsx`
- [ ] `components/info/Info_Markdown.tsx`
- [ ] `components/info/Info_Page.tsx`
- [ ] `components/info/Info_Section.tsx`
- [ ] `components/info/Info_StatusBadge.tsx`
- [ ] `components/info/Info_Table.tsx`
- [ ] `components/info/LabelsDataTable.tsx`
- [ ] `components/info/PermissionsDataTable.tsx`
- [ ] `components/info/ToolsDataTable.tsx`

## Messaging (13)

- [ ] `components/messaging/LarkConnectDialog.tsx`
- [ ] `components/messaging/MessagingDialogHost.tsx`
- [ ] `components/messaging/MessagingPlatformIcon.tsx`
- [ ] `components/messaging/MessagingSessionMenuItem.tsx`
- [ ] `components/messaging/PairingCodeDialog.tsx`
- [ ] `components/messaging/TelegramConnectDialog.tsx`
- [ ] `components/messaging/TelegramSupergroupPairingDialog.tsx`
- [ ] `components/messaging/WhatsAppConnectDialog.tsx`
- [ ] `components/messaging/access/AccessModeBanner.tsx`
- [ ] `components/messaging/access/BindingAllowListPopover.tsx`
- [ ] `components/messaging/access/OwnersListEditor.tsx`
- [ ] `components/messaging/access/PendingSendersList.tsx`
- [ ] `components/messaging/access/TelegramAccessSection.tsx`

## Browser (3)

- [ ] `components/browser/BrowserTabBadge.tsx`
- [ ] `components/browser/BrowserTabStrip.tsx`
- [ ] `components/browser/BrowserToolbar.tsx`

## Markdown (1)

- [ ] `components/markdown/StreamingMarkdown.tsx`

## Settings building blocks (12)

- [ ] `components/settings/SearchableModelInput.tsx`
- [ ] `components/settings/SettingsCard.tsx`
- [ ] `components/settings/SettingsEditRow.tsx`
- [ ] `components/settings/SettingsInput.tsx`
- [ ] `components/settings/SettingsMenuSelect.tsx`
- [ ] `components/settings/SettingsRadioGroup.tsx`
- [ ] `components/settings/SettingsRow.tsx`
- [ ] `components/settings/SettingsSection.tsx`
- [ ] `components/settings/SettingsSegmentedControl.tsx`
- [ ] `components/settings/SettingsSelect.tsx`
- [ ] `components/settings/SettingsTextarea.tsx`
- [ ] `components/settings/SettingsToggle.tsx`

## App menu (4)

- [ ] `components/app-menu/DesktopAppMenu.tsx`
- [ ] `components/app-menu/MobileAppMenu.tsx`
- [ ] `components/app-menu/MobileMenuItem.tsx`
- [ ] `components/app-menu/MobileMenuPage.tsx`

## Top-level components (7)

- [ ] `components/AppMenu.tsx`
- [ ] `components/KeyboardShortcuts.tsx`
- [ ] `components/KeyboardShortcutsDialog.tsx`
- [ ] `components/ResetConfirmationDialog.tsx`
- [ ] `components/RtkUpdateDialog.tsx`
- [ ] `components/ServerDirectoryBrowser.tsx`
- [ ] `components/SplashScreen.tsx`

## UI primitives to swap for the design system (72)

- [ ] `components/ui/CompactSourceSelector.tsx`
- [ ] `components/ui/CompactWorkingDirectorySelector.tsx`
- [ ] `components/ui/EditPopover.tsx`
- [ ] `components/ui/HeaderIconButton.tsx`
- [ ] `components/ui/HeaderMenu.tsx`
- [ ] `components/ui/PanelHeaderCenterButton.tsx`
- [ ] `components/ui/SkillSelectorPopover.tsx`
- [ ] `components/ui/SourceSelectorPopover.tsx`
- [ ] `components/ui/TopBarButton.tsx`
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
