import { BrowserSettingsSection } from "./browser-settings";
import { InboxSection } from "./inbox-panel";
import { ProvidersListSection } from "./provider-detail-page";
import { SandboxSettingsPanel } from "./sandbox-settings-panel";
import { AdvancedSettingsSections, BotWorkspaceSettingsSection } from "./settings-panels";
import { SettingsPageContainer } from "./settings-layout";
import { VoiceSettingsSection } from "./voice-settings";

// Pages that combine sections from several panels. Each section keeps its own
// anchor id so search results and deep links still land on the right row.

export function ProvidersSettingsPage() {
  return (
    <SettingsPageContainer>
      <ProvidersListSection />
      <VoiceSettingsSection />
    </SettingsPageContainer>
  );
}

export function SandboxSettingsPage() {
  return (
    <SettingsPageContainer>
      <BotWorkspaceSettingsSection />
      <SandboxSettingsPanel />
    </SettingsPageContainer>
  );
}

export function BrowserSettingsPage() {
  return (
    <SettingsPageContainer>
      <BrowserSettingsSection />
    </SettingsPageContainer>
  );
}

export function AdvancedSettingsPage() {
  return (
    <SettingsPageContainer>
      {/* The bot inbox keeps its `errors` anchor so old inbox and error links land here. */}
      <InboxSection />
      <AdvancedSettingsSections />
    </SettingsPageContainer>
  );
}
