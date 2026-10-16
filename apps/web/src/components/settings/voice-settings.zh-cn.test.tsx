import { catalogRegistry } from "@otto/client-runtime/i18n";
import { VOICE_API_PROVIDERS, type VoiceApiProvider } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/server", () => ({ serverEnvironment: {} }));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({}) }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("~/state/environments", () => ({ usePrimaryEnvironment: () => null }));

vi.mock("../../confirm-dialog", () => ({ requestConfirmDialog: vi.fn() }));

vi.mock("../chat/reply-playback-provider", () => ({ useOptionalReplyPlayback: () => null }));

import { LanguageProvider } from "../../i18n";
import { VoiceApiProviderRow } from "./voice-settings";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

function renderRow(provider: VoiceApiProvider, chinese: boolean, keyRejected = false) {
  const row = (
    <VoiceApiProviderRow
      provider={provider}
      keyRejected={keyRejected}
      onReplace={() => {}}
      onRemove={() => {}}
    />
  );

  return renderToStaticMarkup(
    chinese ? (
      <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
        {row}
      </LanguageProvider>
    ) : (
      row
    ),
  );
}

describe("voice provider rows in Simplified Chinese", () => {
  it("translates the actions and the status badge", () => {
    for (const provider of VOICE_API_PROVIDERS) {
      expect(renderRow(provider, true)).not.toContain(">Remove</button>");
      expect(renderRow(provider, true, true)).not.toContain(">Replace key</button>");
    }

    const rejected = renderRow("openai", true, true);
    expect(rejected).toContain("密钥被拒绝");
    expect(rejected).not.toContain("Key rejected");
  });
});
