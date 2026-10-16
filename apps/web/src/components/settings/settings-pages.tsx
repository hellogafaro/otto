import { BrowserSettingsSection } from "./browser-settings";
import { ImageGenerationSettingsSection } from "./image-generation-settings";
import { ModelsConnectionsSection } from "./models-settings";
import { SandboxSettingsPanel } from "./sandbox-settings-panel";
import { BotWorkspaceSettingsSection } from "./settings-panels";
import { SettingsPageContainer } from "./settings-layout";
import { VoiceSettingsSection } from "./voice-settings";

// Pages that combine sections from several panels. Each section keeps its own
// anchor id so search results and deep links still land on the right row.

// Otto: Models is the one card of connections bots run on.
export function ModelsSettingsPage() {
  return (
    <SettingsPageContainer>
      <ModelsConnectionsSection />
    </SettingsPageContainer>
  );
}

// Otto: Images holds image generation, which runs on the ChatGPT or Grok connection.
export function ImagesSettingsPage() {
  return (
    <SettingsPageContainer>
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
