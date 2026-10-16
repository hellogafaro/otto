import { defineConfig } from "vite-plus";

const shouldLaunchElectronAfterPack = process.env.OTTO_LEGACY_DESKTOP_DEV === "1";

// Otto: Electron runs a sandboxed preload inside a function whose parameters include
// setImmediate and require, so a bundled top-level declaration with one of those names
// (effect declares setImmediate) is a SyntaxError and the preload never loads. A closure
// gives the bundle its own scope.
const sandboxedPreload = {
  format: "cjs",
  outDir: "dist-electron",
  sourcemap: true,
  outExtensions: () => ({ js: ".cjs" }),
  banner: "(() => {",
  footer: "})();",
} as const;

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["otto#build"],
        cache: false,
      },
      dev: {
        command:
          "node scripts/build-preview-annotation-css.mjs && cross-env OTTO_LEGACY_DESKTOP_DEV=1 vp pack --watch",
        dependsOn: ["otto#build"],
        cache: false,
      },
      "dev:bundle": {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["otto#build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => id.startsWith("@otto/"),
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      ...sandboxedPreload,
      entry: ["src/preload.ts"],
      deps: {
        // Sandboxed preloads can require Electron only, so bundle the contract decoders.
        alwaysBundle: (id) =>
          id === "effect" || id.startsWith("effect/") || id.startsWith("@otto/"),
      },
    },
    {
      ...sandboxedPreload,
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
    {
      ...sandboxedPreload,
      entry: ["src/preview-pip-preload.ts"],
      deps: {
        // Sandboxed preloads can require Electron only, so bundle the contract decoders.
        alwaysBundle: (id) =>
          id === "effect" || id.startsWith("effect/") || id.startsWith("@otto/"),
      },
    },
  ],
});
