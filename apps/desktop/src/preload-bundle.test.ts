import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { build } from "vite-plus/pack";
import { afterAll, describe, expect, it } from "vite-plus/test";

import config from "../vite.config.ts";

const outDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-preload-"));

afterAll(() => NodeFS.rmSync(outDir, { recursive: true, force: true }));

describe("sandboxed preload bundles", () => {
  const preloads = (Array.isArray(config.pack) ? config.pack : []).filter((entry) =>
    String(entry.entry).includes("preload"),
  );

  it.each(preloads.map((entry) => [String(entry.entry), entry] as const))(
    "%s compiles inside Electron's sandboxed preload wrapper",
    async (_name, entry) => {
      await build({
        ...entry,
        config: false,
        outDir,
        sourcemap: false,
        clean: false,
        logLevel: "silent",
        cwd: NodePath.resolve(import.meta.dirname, ".."),
      });

      const file = NodePath.join(
        outDir,
        NodePath.basename(String(entry.entry)).replace(/\.ts$/, ".cjs"),
      );

      expect(
        () =>
          new Function(
            "require",
            "process",
            "Buffer",
            "global",
            "setImmediate",
            "clearImmediate",
            "exports",
            "module",
            NodeFS.readFileSync(file, "utf8"),
          ),
      ).not.toThrow();
    },
    60_000,
  );
});
