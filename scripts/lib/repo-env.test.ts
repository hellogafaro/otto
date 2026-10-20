import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./repo-env.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), "OTTO_EXAMPLE=root\n");
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "OTTO_EXAMPLE=local\n");

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).OTTO_EXAMPLE).toBe("local");
    expect(loadRepoEnv({ baseEnv: { OTTO_EXAMPLE: "ci" }, repoRoot }).OTTO_EXAMPLE).toBe("ci");
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-repo-env-"));
  temporaryDirectories.push(directory);

  return directory;
}
