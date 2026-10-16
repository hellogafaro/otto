import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId } from "./provider-instance.ts";
import {
  decodeServerSettings,
  decodeServerSettingsPatch,
  encodeServerSettings,
} from "./settings.test-support.ts";

describe("ServerSettings voice", () => {
  it("defaults to enabled ChatGPT voice calls with Alloy", () => {
    expect(decodeServerSettings({}).voice).toEqual({
      enabled: true,
      provider: "chatgpt",
      voice: "alloy",
    });
  });

  it("accepts a partial voice settings patch", () => {
    expect(decodeServerSettingsPatch({ voice: { enabled: false, voice: "marin" } }).voice).toEqual({
      enabled: false,
      voice: "marin",
    });
  });
});

describe("ServerSettings local execution", () => {
  it("runs local execution with full access by default and accepts each supported policy", () => {
    expect(decodeServerSettings({}).localExecutionMode).toBe("full-access");
    expect(
      decodeServerSettingsPatch({ localExecutionMode: "approval-required" }).localExecutionMode,
    ).toBe("approval-required");
    expect(decodeServerSettingsPatch({ localExecutionMode: "auto" }).localExecutionMode).toBe(
      "auto",
    );
    expect(
      decodeServerSettingsPatch({ localExecutionMode: "full-access" }).localExecutionMode,
    ).toBe("full-access");
  });

  it("rejects edit-only automatic approval", () => {
    expect(() => decodeServerSettingsPatch({ localExecutionMode: "auto-accept-edits" })).toThrow();
  });
});

describe("ServerSettings local execution", () => {
  it("keeps full access as the unified default", () => {
    expect(decodeServerSettings({}).localExecutionMode).toBe("full-access");
    expect(decodeServerSettingsPatch({ localExecutionMode: "auto" }).localExecutionMode).toBe(
      "auto",
    );
    expect(
      decodeServerSettingsPatch({ localExecutionMode: "full-access" }).localExecutionMode,
    ).toBe("full-access");
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin on for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(true);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: false }).newWorktreesStartFromOrigin,
    ).toBe(false);
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it("defaults all style settings for legacy configs", () => {
    const settings = decodeServerSettings({});

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "repo_conventions",
      customInstructions: "",
      followChangeRequestTemplates: true,
    });
    expect(settings.sourceControlWriterModelSelection).toBeNull();
  });

  it("trims partial style updates", () => {
    const patch = decodeServerSettingsPatch({
      sourceControlWritingStyle: {
        mode: "custom",
        customInstructions: "  Prefer concise wording.  ",
      },
    });

    expect(patch.sourceControlWritingStyle).toEqual({
      mode: "custom",
      customInstructions: "Prefer concise wording.",
    });
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
          launchArgs: "  --strict-config --enable foo  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providers?.codex?.launchArgs).toBe("--strict-config --enable foo");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});

    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
          launchArgs: "  --strict-config  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.providers?.codex?.launchArgs).toBe("--strict-config");
  });
});
