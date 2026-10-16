import { DEFAULT_SERVER_SETTINGS, type VoiceSettings } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/server", () => ({ serverEnvironment: {} }));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({}) }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("~/state/environments", () => ({ usePrimaryEnvironment: () => null }));

vi.mock("~/hooks/use-settings", () => ({
  usePrimarySettings: vi.fn(),
  useUpdatePrimarySettings: () => vi.fn(),
}));

vi.mock("../../confirm-dialog", () => ({ requestConfirmDialog: vi.fn() }));

vi.mock("../chat/reply-playback-provider", () => ({ useOptionalReplyPlayback: () => null }));

import type { EnvironmentId } from "@otto/contracts";
import { VoiceApiConnectionsSection } from "./voice-api-connections";
import { VoiceApiProviderRow, VoiceModeRows } from "./voice-settings";

const environmentId = "environment-1" as EnvironmentId;

function renderMode(
  voice: Partial<VoiceSettings>,
  connected: ReadonlyArray<"openai" | "fish"> | null,
) {
  return renderToStaticMarkup(
    <VoiceModeRows
      voice={{ ...DEFAULT_SERVER_SETTINGS.voice, ...voice }}
      environmentId={environmentId}
      connected={connected}
      onChange={() => {}}
    />,
  );
}

function renderProvider(keyRejected = false) {
  return renderToStaticMarkup(
    <VoiceApiProviderRow
      provider="elevenlabs"
      keyRejected={keyRejected}
      onReplace={() => {}}
      onRemove={() => {}}
    />,
  );
}

function renderProviders(connected: ReadonlyArray<"openai" | "elevenlabs"> | null) {
  return renderToStaticMarkup(
    <VoiceApiConnectionsSection
      environmentId={environmentId}
      connected={connected}
      serverRejected={{}}
      loadError={null}
      onChanged={() => {}}
      onKeySaved={() => {}}
    />,
  );
}

describe("voice mode rows", () => {
  it("keeps the ChatGPT subscription path unchanged", () => {
    const html = renderMode({}, []);
    expect(html).toContain("ChatGPT subscription");
    expect(html).toContain("No API key is billed");
    expect(html).toContain("Voice selection");
    expect(html).not.toContain("API connections");
    expect(html).not.toContain("Transcription provider");
  });

  it("explains realtime billing and flags a missing OpenAI key", () => {
    const html = renderMode({ provider: "openai" }, []);
    expect(html).toContain("OpenAI API voice");
    expect(html).toContain("interrupt the bot");
    expect(html).toContain("Connect OpenAI API under Providers");
  });

  it("shows speech-only composition without interruption and asks to connect the speech provider", () => {
    const html = renderMode(
      { provider: "composed", transcriptionProvider: "openai", synthesisProvider: "fish" },
      ["openai"],
    );

    expect(html).toContain("cannot be interrupted");
    expect(html).toContain("Transcription provider");
    expect(html).toContain("Speech provider");
    expect(html).toContain("Fish Audio");
    expect(html).toContain("Connect Fish Audio to choose a voice.");
    expect(html).toContain("Connect Fish Audio under Providers");
  });
});

describe("voice providers card", () => {
  it("lists only connected providers under a count row, like Models", () => {
    const html = renderProviders(["elevenlabs"]);
    expect(html).toContain("Providers");
    expect(html).toContain("1 provider");
    expect(html).toContain('aria-label="Add provider"');
    expect(html).toContain("ElevenLabs");
    expect(html).not.toContain("Cartesia");
    expect(html).not.toContain(">Connect</button>");
  });

  it("explains an empty card and waits for the status before offering Add provider", () => {
    expect(renderProviders([])).toContain("Add a provider for API voice calls and dictation.");
    expect(renderProviders(null)).not.toContain('aria-label="Add provider"');
    expect(renderProviders(null)).not.toContain("Add a provider for API voice calls");
  });

  it("offers Remove on a working key, without a status badge or the key", () => {
    const html = renderProvider();
    expect(html).toContain("Transcription · Speech");
    expect(html).toContain(">Remove</button>");
    expect(html).not.toContain(">Replace key</button>");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain('type="password"');
  });

  it("shows a rejected key in the danger tone with Replace key", () => {
    const html = renderProvider(true);
    expect(html).toContain("Key rejected");
    expect(html).toContain("text-destructive-foreground");
    expect(html).toContain(">Replace key</button>");
  });
});
