import { BrowserSettingsSection } from "./browser-settings";
import { ImageGenerationSettingsSection } from "./image-generation-settings";
import { ProvidersListSection } from "./provider-detail-page";
import { SandboxSettingsPanel } from "./sandbox-settings-panel";
import { BotWorkspaceSettingsSection } from "./settings-panels";
import { SettingsPageContainer } from "./settings-layout";
import { VoiceSettingsSection } from "./voice-settings";

// Pages that combine sections from several panels. Each section keeps its own
// anchor id so search results and deep links still land on the right row.

// Otto: Models holds every model choice: chat providers, voice and image generation.
export function ProvidersSettingsPage() {
  return (
    <SettingsPageContainer>
      <ProvidersListSection />
      <VoiceSettingsSection />
      <ImageGenerationSettingsSection />
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
