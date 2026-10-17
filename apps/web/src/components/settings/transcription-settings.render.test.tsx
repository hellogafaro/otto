import {
  DEFAULT_SERVER_SETTINGS,
  type VoiceApiProvider,
  type VoiceSettings,
} from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  voice: {} as Partial<VoiceSettings>,
  connected: [] as string[],
}));

vi.mock("../../state/server", () => ({ serverEnvironment: { voiceProviders: () => ({}) } }));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      providers: ["openai", "elevenlabs", "cartesia", "fish", "openrouter"].map((provider) => ({
        provider,
        connected: state.connected.includes(provider),
        keyRejected: false,
      })),
    },
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("~/state/environments", () => ({
  usePrimaryEnvironment: () => ({ environmentId: "environment-1" }),
}));

vi.mock("~/hooks/use-settings", () => ({
  usePrimarySettings: <T,>(select: (settings: { voice: Partial<VoiceSettings> }) => T): T =>
    select({ voice: state.voice }),
  useUpdatePrimarySettings: () => vi.fn(),
}));

vi.mock("../../confirm-dialog", () => ({ requestConfirmDialog: vi.fn() }));

vi.mock("../chat/reply-playback-provider", () => ({ useOptionalReplyPlayback: () => null }));

import { TranscriptionSettingsSection } from "./transcription-settings";
import { VoiceSettingsSection } from "./voice-settings";

function renderPages(voice: Partial<VoiceSettings>, connected: ReadonlyArray<VoiceApiProvider>) {
  state.voice = { ...DEFAULT_SERVER_SETTINGS.voice, ...voice };
  state.connected = [...connected];

  return {
    transcription: renderToStaticMarkup(<TranscriptionSettingsSection />),
    voice: renderToStaticMarkup(<VoiceSettingsSection />),
  };
}

/** The provider names in a page's Providers card rows. */
function providerRows(html: string): string[] {
  return Array.from(
    html.matchAll(
      /data-settings-row=""[^>]*>.*?<span class="block truncate text-13px[^"]*">([^<]+)</g,
    ),
    (match) => match[1] ?? "",
  );
}

describe("settings split between Voice and Transcription", () => {
  beforeEach(() => {
    state.voice = {};
    state.connected = [];
  });

  it("lists transcription providers on Transcription and speech providers on Voice", () => {
    const pages = renderPages({}, ["openai", "fish", "openrouter"]);

    expect(providerRows(pages.transcription)).toEqual(["OpenAI API", "OpenRouter"]);
    expect(providerRows(pages.voice)).toEqual(["OpenAI API", "Fish Audio"]);
    expect(pages.transcription).toContain('id="transcription-providers"');
    expect(pages.voice).toContain('id="voice-api-connections"');
  });

  it("moves the transcription provider off Voice and onto a Default provider select", () => {
    const pages = renderPages({ provider: "composed", transcriptionProvider: "openrouter" }, [
      "openai",
      "openrouter",
    ]);

    expect(pages.voice).not.toContain('aria-label="Transcription provider"');
    expect(pages.voice).toContain("Speech provider");
    expect(pages.transcription).toContain("Transcription");
    expect(pages.transcription).toContain("Default provider");
    expect(pages.transcription).toContain('aria-label="Default transcription provider"');
    expect(pages.transcription).toMatch(
      /aria-label="Default transcription provider"[^]*?OpenRouter/,
    );
    expect(pages.transcription).not.toContain("Choose a provider");
  });

  it("asks for a choice when the default provider has no key, and waits for one to be added", () => {
    const unset = renderPages({}, ["openrouter"]);
    expect(unset.transcription).toContain("Choose a provider");

    const empty = renderPages({}, ["fish"]);
    expect(empty.transcription).toContain("Choose a provider");
    expect(empty.transcription).toContain("disabled");
    expect(empty.transcription).toContain(
      "Add a provider to dictate and to let bots transcribe audio and video.",
    );
    expect(empty.voice).not.toContain("Add a provider for API voice calls and read-aloud.");
  });
});
