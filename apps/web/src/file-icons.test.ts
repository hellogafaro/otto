import { assert, describe, it } from "vite-plus/test";

import { hasSpecificFileIconForFileName, syntheticFileNameForLanguageId } from "./file-icons";
import { resolveFileIconKind } from "@otto/client-runtime/file-icons";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FileEntryIcon } from "./components/chat/file-entry-icon";

describe("Remix file icons", () => {
  it("preserves exact filename and extension classification", () => {
    assert.equal(resolveFileIconKind("Dockerfile"), "docker");
    assert.equal(resolveFileIconKind("src/Button.tsx"), "react");
    assert.equal(resolveFileIconKind("vite.config.ts"), "vite");
  });

  it("preserves specific configuration and instructions filenames", () => {
    assert.equal(resolveFileIconKind("package.json"), "package");
    assert.equal(resolveFileIconKind("config/tsconfig.json"), "tsconfig");
    assert.equal(resolveFileIconKind("AGENTS.md"), "agents");
    assert.equal(resolveFileIconKind("CLAUDE.md"), "claude");
    assert.equal(resolveFileIconKind("README.md"), "readme");
    assert.equal(resolveFileIconKind("pnpm-lock.yaml"), "pnpm");
    assert.equal(resolveFileIconKind("pnpm-workspace.yaml"), "pnpm");
  });

  it("renders configuration and instructions icons directly from Remix without a sprite", () => {
    for (const pathValue of [
      "package.json",
      "tsconfig.json",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "pnpm-lock.yaml",
    ]) {
      const markup = renderToStaticMarkup(
        createElement(FileEntryIcon, { pathValue, kind: "file" }),
      );

      assert.include(markup, 'class="remixicon');
      assert.include(markup, "<path");
      assert.notInclude(markup, "<use");
    }
  });

  it("uses the shared file fallback for unknown file types", () => {
    assert.equal(resolveFileIconKind("artifact.unknown-ext"), "default");
    assert.isFalse(hasSpecificFileIconForFileName("artifact.unknown-ext"));
  });

  it("renders directories with the Remix folder rather than a file glyph", () => {
    const directory = renderToStaticMarkup(
      createElement(FileEntryIcon, { pathValue: "packages/client-runtime", kind: "directory" }),
    );

    const file = renderToStaticMarkup(
      createElement(FileEntryIcon, { pathValue: "artifact.unknown-ext", kind: "file" }),
    );

    assert.notEqual(directory, file);
    assert.include(directory, 'class="remixicon');
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });
});
