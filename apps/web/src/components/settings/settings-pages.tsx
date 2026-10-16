import { BrowserSettingsSection } from "./browser-settings";
import { ImageGenerationSettingsSection } from "./image-generation-settings";
import { ProvidersListSection } from "./provider-detail-page";
import { SandboxSettingsPanel } from "./sandbox-settings-panel";
import { BotWorkspaceSettingsSection } from "./settings-panels";
import { SettingsPageContainer } from "./settings-layout";
import { VoiceSettingsSection } from "./voice-settings";

// Pages that combine sections from several panels. Each section keeps its own
// anchor id so search results and deep links still land on the right row.

// Otto: Models holds the chat providers and image generation.
export function ModelsSettingsPage() {
  return (
    <SettingsPageContainer>
      <ProvidersListSection />
      <ImageGenerationSettingsSection />
    </SettingsPageContainer>
  );
}

// Otto: Voice holds voice calls, read-aloud and the speech API keys that dictation and calls use.
export function VoiceSettingsPage() {
  return (
    <SettingsPageContainer>
      <VoiceSettingsSection />
    </SettingsPageContainer>
  );
}

// Otto: Computer is what a bot's machine can do: its workspace, sandbox and browser.
export function ComputerSettingsPage() {
  return (
    <SettingsPageContainer>
      <BotWorkspaceSettingsSection />
      <SandboxSettingsPanel />
      <BrowserSettingsSection />
    </SettingsPageContainer>
  );
}
