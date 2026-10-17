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

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    voiceProviders: () => ({ query: "providers" }),
    voiceTranscriptionModels: ({ input }: { input: { provider: string } }) => ({
      query: "models",
      provider: input.provider,
    }),
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { query: string; provider?: string } | null) =>
    atom?.query === "models"
      ? {
          data: {
            models:
              atom.provider === "openrouter"
                ? [
                    { id: "openai/whisper-large-v3", name: "OpenAI: Whisper Large V3" },
                    { id: "deepgram/nova-3", name: "Deepgram: Nova-3" },
                  ]
                : [{ id: "gpt-4o-mini-transcribe", name: "GPT-4o mini Transcribe" }],
          },
          error: null,
        }
      : {
          data: {
            providers: ["openai", "elevenlabs", "cartesia", "fish", "openrouter"].map(
              (provider) => ({
                provider,
                connected: state.connected.includes(provider),
                keyRejected: false,
              }),
            ),
          },
          error: null,
          refresh: () => {},
        },
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

  it("shows the first added provider while the default has no key, and waits for one", () => {
    const unset = renderPages({}, ["openrouter"]);
    expect(unset.transcription).not.toContain("Choose a provider");
    expect(unset.transcription).toMatch(
      /aria-label="Default transcription provider"[^]*?OpenRouter/,
    );
    expect(unset.transcription).toMatch(
      /aria-label="Transcription model"[^]*?OpenAI: Whisper Large V3/,
    );

    const empty = renderPages({}, ["fish"]);
    expect(empty.transcription).toContain("Choose a provider");
    expect(empty.transcription).toContain("disabled");
    expect(empty.transcription).toContain(
      "Add a provider to dictate and to let bots transcribe audio and video.",
    );
    expect(empty.voice).not.toContain("Add a provider for API voice calls and read-aloud.");
  });

  it("shows the selected provider's models by name, its default until one is chosen", () => {
    const fresh = renderPages({ transcriptionProvider: "openrouter" }, ["openrouter"]);
    expect(fresh.transcription).toMatch(
      /aria-label="Transcription model"[^]*?OpenAI: Whisper Large V3/,
    );
    expect(fresh.transcription).not.toContain("openai/whisper-large-v3<");

    const chosen = renderPages(
      {
        transcriptionProvider: "openrouter",
        transcriptionModels: { openrouter: "deepgram/nova-3" },
      },
      ["openrouter"],
    );

    expect(chosen.transcription).toMatch(/aria-label="Transcription model"[^]*?Deepgram: Nova-3/);

    expect(renderPages({ transcriptionProvider: "openrouter" }, []).transcription).not.toContain(
      "Transcription model",
    );
  });
});
