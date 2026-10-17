import type * as Schema from "effect/Schema";
import desktopPackageJson from "../../../apps/desktop/package.json" with { type: "json" };

import * as Config from "effect/Config";

import * as Effect from "effect/Effect";

import * as Path from "effect/Path";

import { BuildArch, BuildPlatform, RepoRoot } from "./model.ts";

import {
  type DesktopBuildIconAssets,
  stageMacIcons,
  stageLinuxIcons,
  stageWindowsIcons,
} from "./assets.ts";

const DESKTOP_APP_ID = "studio.hellogafaro.otto";

export interface DesktopBuildConfiguration {
  appId: string;
  productName: string;
  artifactName: string;
  electronLanguages: readonly string[];
  files: readonly string[];
  directories: { buildResources: string };
  extraResources: readonly {
    readonly from: string;
    readonly to: string;
    readonly filter?: readonly string[];
  }[];
  publish?: readonly Schema.JsonObject[];
  mac?: Schema.JsonObject;
  dmg?: Schema.JsonObject;
  linux?: Schema.JsonObject;
  win?: WindowsBuildConfiguration;
  nsis?: { differentialPackage: boolean };
  protocols?: readonly { name: string; schemes: readonly string[] }[];
  npmRebuild?: boolean;
}

interface WindowsBuildConfiguration {
  target: string[];
  icon: string;
  signAndEditExecutable: boolean;
  azureSignOptions?: Config.Success<typeof AzureTrustedSigningOptionsConfig>;
}

interface PlatformConfig {
  readonly cliFlag: "--mac" | "--linux" | "--win";
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
}

export const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  mac: {
    cliFlag: "--mac",
    defaultTarget: "dmg",
    archChoices: ["arm64", "x64", "universal"],
  },
  linux: {
    cliFlag: "--linux",
    defaultTarget: "AppImage",
    archChoices: ["x64", "arm64"],
  },
  win: {
    cliFlag: "--win",
    defaultTarget: "nsis",
    archChoices: ["x64", "arm64"],
  },
};

export const DESKTOP_ELECTRON_LANGUAGES = ["en-US"] as const;

export const DESKTOP_FILE_EXCLUSIONS = [
  // Otto Legacy always passes the user's installed Claude executable to the SDK,
  // so the SDK's optional platform packages (each a ~200MB bundled executable)
  // are dead weight. The trailing dash keeps the SDK's own JS package.
  "!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**/*",
  // Windows stages the server sidecar below prod-resources so electron-builder
  // can copy it using project-relative extraResources matchers. Keep those
  // staging inputs out of app.asar; they are emitted once at resources/.
  "!apps/desktop/prod-resources/windows-server",
  "!apps/desktop/prod-resources/windows-server/**/*",
] as const;

// Windows terminal helpers cannot run on macOS and slow signing and notarization.
export const MAC_FILE_EXCLUSIONS = [
  "!**/node_modules/node-pty/prebuilds/win32-*/**/*",
  "!**/node_modules/node-pty/third_party/conpty/**/*",
] as const;

// Windows ships the server tree (bundle + node_modules) as a separate
// resources/server.asar sidecar instead of loose files: the NSIS installer
// then extracts a handful of large archives instead of thousands of small
// files, which dominates install (and update) time. The Windows primary runs
// the server from inside server.asar via the asar-aware ELECTRON_RUN_AS_NODE
// runtime; the WSL backend cannot read asar archives, so enabling WSL lazily
// extracts the sidecar to a version-keyed directory (see DesktopWslServerTree).
export const WINDOWS_SERVER_ASAR_RESOURCE = "server.asar";

export const DESKTOP_PLUGIN_CATALOG_RESOURCE_SOURCE_DIR = "apps/desktop/prod-resources/plugins";

export const WINDOWS_SERVER_RESOURCE_SOURCE_DIR = "apps/desktop/prod-resources/windows-server";

export const WINDOWS_SERVER_EXTRA_RESOURCES = [
  {
    // Copy the archive and its .unpacked sibling from one parent directory.
    // Mapping the .unpacked directory as an independent FileSet silently
    // omitted it from Windows packages even though electron-builder copied
    // the adjacent archive.
    from: WINDOWS_SERVER_RESOURCE_SOURCE_DIR,
    to: ".",
    filter: [WINDOWS_SERVER_ASAR_RESOURCE, `${WINDOWS_SERVER_ASAR_RESOURCE}.unpacked/**/*`],
  },
] as const;

export const DESKTOP_EXTRA_RESOURCES = [
  {
    from: DESKTOP_PLUGIN_CATALOG_RESOURCE_SOURCE_DIR,
    to: "plugins",
  },
] as const;

export function renderMacEntitlements(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
  </dict>
</plist>
`;
}

const AzureTrustedSigningOptionsConfig = Config.all({
  publisherName: Config.string("AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"),
  endpoint: Config.string("AZURE_TRUSTED_SIGNING_ENDPOINT"),
  certificateProfileName: Config.string("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
  codeSigningAccountName: Config.string("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
  fileDigest: Config.string("AZURE_TRUSTED_SIGNING_FILE_DIGEST").pipe(Config.withDefault("SHA256")),
  timestampDigest: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_DIGEST").pipe(
    Config.withDefault("SHA256"),
  ),
  timestampRfc3161: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161").pipe(
    Config.withDefault("http://timestamp.acs.microsoft.com"),
  ),
});

export const DESKTOP_UPDATE_PUBLISH_CONFIG = {
  provider: "github",
  owner: "hellogafaro",
  repo: "otto",
  releaseType: "release",
} as const;

export function resolveDesktopUpdateChannel(version: string): "latest" | "beta" {
  return /-beta\.\d{8}\.\d+$/.test(version) ? "beta" : "latest";
}

function isDesktopPreviewVersion(version: string): boolean {
  return /-pr\./.test(version);
}

export function resolveMockUpdateServerUrl(mockUpdateServerPort: number | undefined): string {
  return `http://localhost:${mockUpdateServerPort ?? 3000}`;
}

// Electron Builder detects pnpm from npm_config_user_agent, whose value uses
// user-agent syntax (pnpm/11.10.0) rather than packageManager syntax
// (pnpm@11.10.0).
export function resolvePackageManagerUserAgent(packageManager: string): string {
  const trimmed = packageManager.trim();
  const versionSeparator = trimmed.lastIndexOf("@");

  if (versionSeparator <= 0 || versionSeparator === trimmed.length - 1) {
    return trimmed;
  }

  return `${trimmed.slice(0, versionSeparator)}/${trimmed.slice(versionSeparator + 1)}`;
}

export function resolveDesktopProductName(): string {
  return desktopPackageJson.productName ?? "Otto";
}

export const createBuildConfig = Effect.fn("createBuildConfig")(function* (
  platform: typeof BuildPlatform.Type,
  target: string,
  version: string,
  signed: boolean,
  mockUpdates: boolean,
  mockUpdateServerPort: number | undefined,
  macSigning:
    | {
        readonly entitlementsPath: string;
        readonly notarize: boolean;
        readonly provisioningProfilePath?: string;
      }
    | undefined,
) {
  const buildConfig: DesktopBuildConfiguration = {
    appId: DESKTOP_APP_ID,
    productName: resolveDesktopProductName(),
    artifactName:
      platform === "linux"
        ? "Otto-Bot-${version}-x64.${ext}"
        : "Otto-Bot-${version}-${arch}.${ext}",
    electronLanguages: [...DESKTOP_ELECTRON_LANGUAGES],
    files: [...DESKTOP_FILE_EXCLUSIONS, ...(platform === "mac" ? MAC_FILE_EXCLUSIONS : [])],
    directories: {
      buildResources: "apps/desktop/resources",
    },
    // All platforms keep app.asar fully packed; electron-builder's default
    // smart unpack extracts native libraries, which loaders find in
    // app.asar.unpacked. Windows additionally ships the server tree as the
    // hand-packed server.asar sidecar (see WINDOWS_SERVER_ASAR_RESOURCE).
    extraResources: [
      ...DESKTOP_EXTRA_RESOURCES,
      ...(platform === "win" ? WINDOWS_SERVER_EXTRA_RESOURCES : []),
    ],
  };

  if (!isDesktopPreviewVersion(version)) {
    if (mockUpdates) {
      buildConfig.publish = [
        {
          provider: "generic",
          url: resolveMockUpdateServerUrl(mockUpdateServerPort),
        },
      ];
    } else if (platform === "mac" && signed) {
      buildConfig.publish = [
        resolveDesktopUpdateChannel(version) === "beta"
          ? { ...DESKTOP_UPDATE_PUBLISH_CONFIG, releaseType: "prerelease", channel: "beta" }
          : DESKTOP_UPDATE_PUBLISH_CONFIG,
      ];
    }
  }

  if (platform === "mac") {
    const path = yield* Path.Path;
    const repoRoot = yield* RepoRoot;
    buildConfig.mac = {
      target: target === "dmg" ? [target, "zip"] : [target],
      // The .icon bundle is preferred by electron-builder: it compiles an
      // asset catalog for macOS 26 theming and derives the legacy icns from
      // the same source for older systems.
      icon: "otto.icon",
      category: "public.app-category.developer-tools",
      extendInfo: {
        NSMicrophoneUsageDescription:
          "Otto uses the microphone for calls and dictation with your bots.",
      },
      protocols: [
        {
          name: "Otto",
          schemes: ["otto", "otto-dev"],
        },
      ],
      // Unsigned builds opt into identity "-" so electron-builder replaces
      // Electron's linker-signed stub. Developer ID builds use CSC_NAME or CSC_LINK.
      hardenedRuntime: true,
      notarize: macSigning?.notarize ?? false,
      sign: path.join(repoRoot, "scripts/sign-macos.ts"),
      ...(signed ? {} : { identity: "-" }),
      ...(macSigning
        ? {
            entitlements: macSigning.entitlementsPath,
            entitlementsInherit: macSigning.entitlementsPath,
            ...(macSigning.provisioningProfilePath
              ? { provisioningProfile: macSigning.provisioningProfilePath }
              : {}),
          }
        : {}),
    };
  }

  if (platform === "mac" && target === "dmg") {
    buildConfig.dmg = {
      // Give the themed installer its own Finder volume name. Finder caches
      // DMG window backgrounds by volume name, so reusing a generic name can
      // make a newly built background look unchanged during testing.
      title: `${resolveDesktopProductName()} ${version} Installer`,
      background: "dmg/dmg-background-latest.png",
      window: {
        width: 540,
        // Finder counts its 32px title bar in the window bounds. The themed
        // background itself is 380px tall, so add the chrome height here to
        // keep the full canvas visible.
        height: 412,
      },
      contents: [
        { x: 130, y: 220, type: "file" },
        { x: 410, y: 220, type: "link", path: "/Applications" },
      ],
      iconSize: 80,
      iconTextSize: 12,
      // The release workflow asserts a primary signature on the DMG container
      // (spctl --type open --context context:primary-signature), and
      // electron-builder leaves DMGs unsigned by default.
      ...(signed ? { sign: true } : {}),
    };
  }

  if (platform === "linux") {
    buildConfig.linux = {
      target: [target],
      executableName: "otto",
      icon: "icons",
      category: "Development",
      // electron-builder turns these into MimeType=x-scheme-handler/<scheme>;
      // in the .desktop entry (Exec already gets %U), so browsers can hand
      // otto:// OAuth callbacks to the app.
      protocols: [
        {
          name: "Otto",
          schemes: ["otto", "otto-dev"],
        },
      ],
      desktop: {
        entry: {
          StartupWMClass: "otto",
        },
      },
    };
  }

  if (platform === "win") {
    buildConfig.npmRebuild = false;
    // Keep blockmap-based differential downloads enabled while changing the
    // installed file topology. The optimization is in the payload shape, not
    // in trading update bandwidth for install speed.
    buildConfig.nsis = { differentialPackage: true };
    // electron-builder writes HKCU URL-protocol registry entries from this
    // list, so the OS hands otto:// activations to this install instead of
    // whatever app (for example an old OttoLegacy build) registered a scheme earlier.
    // Only the production scheme: packaged builds never run as development,
    // and claiming otto-dev would steal it from a developer's local build.
    buildConfig.protocols = [
      {
        name: "Otto",
        schemes: ["otto"],
      },
    ];

    const winConfig: WindowsBuildConfiguration = {
      target: [target],
      icon: "icon.ico",
      // Resource editing applies the product metadata and icon independently
      // of code signing. Disabling it for local unsigned builds leaves the
      // packaged executable with Electron's stock icon.
      signAndEditExecutable: true,
    };

    if (signed) {
      winConfig.azureSignOptions = yield* AzureTrustedSigningOptionsConfig;
    }

    buildConfig.win = winConfig;
  }

  return buildConfig;
});

export const assertPlatformBuildResources = Effect.fn("assertPlatformBuildResources")(function* (
  platform: typeof BuildPlatform.Type,
  stageResourcesDir: string,
  iconAssets: DesktopBuildIconAssets,
  verbose: boolean,
) {
  if (platform === "mac") {
    yield* stageMacIcons(
      stageResourcesDir,
      iconAssets.macIconPng,
      iconAssets.macIconComposer,
      verbose,
    );

    return;
  }

  if (platform === "linux") {
    yield* stageLinuxIcons(stageResourcesDir, iconAssets.linuxIconPng, verbose);

    return;
  }

  if (platform === "win") {
    yield* stageWindowsIcons(stageResourcesDir, iconAssets.windowsIconIco);
  }
});
