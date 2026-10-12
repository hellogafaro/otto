import { defineConfig } from "vite-plus";

const shouldLaunchElectronAfterPack = process.env.OTTO_LEGACY_DESKTOP_DEV === "1";

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
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
      deps: {
        // Sandboxed preloads can require Electron only, so bundle the contract decoders.
        alwaysBundle: (id) =>
          id === "effect" || id.startsWith("effect/") || id.startsWith("@otto/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pip-preload.ts"],
      deps: {
        // Sandboxed preloads can require Electron only, so bundle the contract decoders.
        alwaysBundle: (id) =>
          id === "effect" || id.startsWith("effect/") || id.startsWith("@otto/"),
      },
    },
  ],
});
