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

function renderProvider(connected: boolean | undefined, keyRejected = false) {
  return renderToStaticMarkup(
    <VoiceApiProviderRow
      provider="elevenlabs"
      connected={connected}
      keyRejected={keyRejected}
      onSave={async () => true}
      onRemove={() => {}}
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
    expect(html).toContain("Connect OpenAI API under API keys");
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
    expect(html).toContain("Connect Fish Audio under API keys");
  });
});

describe("voice API provider row", () => {
  it("offers Connect when a provider is not connected, with the key asked in a dialog", () => {
    const html = renderProvider(false);
    expect(html).toContain(">Connect</button>");
    expect(html).toContain("Transcription · Speech");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain(">Remove</button>");
  });

  it("offers Remove and Replace key once connected, without revealing the key", () => {
    const html = renderProvider(true);
    expect(html).toContain("Connected");
    expect(html).toContain(">Remove</button>");
    expect(html).toContain(">Replace key</button>");
    expect(html).not.toContain('type="password"');
  });

  it("waits for the provider status before offering actions", () => {
    const loading = renderProvider(undefined);
    expect(loading).not.toContain(">Connect</button>");
    expect(loading).not.toContain(">Remove</button>");
  });

  it("shows a rejected key in the danger tone instead of Connected", () => {
    const html = renderProvider(true, true);
    expect(html).toContain("Key rejected");
    expect(html).toContain("text-destructive-foreground");
    expect(html).not.toContain("Connected");
    expect(html).toContain(">Replace key</button>");
  });
});
