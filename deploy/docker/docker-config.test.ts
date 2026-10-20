import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

const read = (path: string) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");

const dockerfile = read("./Dockerfile");

const compose = read("./compose.yaml");

const entrypoint = read("./otto-entrypoint.sh");

const dockerignore = read("../../.dockerignore");

it("health-gates the image on the server's environment endpoint", () => {
  expect(dockerfile).toMatch(
    /HEALTHCHECK [^\n]*\\\n\s+CMD curl -fsS http:\/\/127\.0\.0\.1:3773\/\.well-known\/ottoLegacy\/environment/,
  );
  expect(compose).toContain("${OTTO_IMAGE:-otto:local}");
  expect(dockerfile).toContain("OTTO_SERVER_ENTRYPOINT=/opt/otto/node_modules/otto/dist/bin.mjs");
  expect(dockerfile).toContain("OTTO_REMOTE_CONTAINER=1");
  expect(entrypoint).toContain('exec /opt/otto/remote-admin "$@"');
});

it("never schedules the unsupported hosted heartbeat command", () => {
  for (const file of [dockerfile, compose, entrypoint]) {
    expect(file).not.toContain("heartbeat");
  }
});

it("keeps Otto's data in OTTO_HOME and ignores an ambient OTTO_LEGACY_HOME", () => {
  expect(dockerfile).toContain("OTTO_HOME=/data");

  for (const file of [dockerfile, compose]) {
    expect(file).not.toContain("OTTO_LEGACY_HOME");
  }

  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-entrypoint-"));

  try {
    const entry = NodePath.join(root, "otto");
    // Replace the container paths with a probe that reports the server's resolved home.
    NodeFS.writeFileSync(
      entry,
      entrypoint
        .replace("/opt/otto/initialize-remote-identity.sh", "true")
        .replace(
          /exec node \/opt\/otto\/node_modules\/otto\/dist\/bin\.mjs "\$@"/,
          'printf "%s|%s" "$OTTO_HOME" "$OTTO_LEGACY_HOME"',
        ),
      { mode: 0o755 },
    );

    const run = (env: Record<string, string>) =>
      NodeChildProcess.spawnSync("sh", [entry, "serve"], {
        env: { PATH: process.env.PATH ?? "", HOME: root, ...env },
        encoding: "utf8",
      }).stdout;

    expect(run({ OTTO_LEGACY_HOME: "/legacy/.ottoLegacy" })).toBe(`${root}/.otto|${root}/.otto`);
    expect(run({ OTTO_LEGACY_HOME: "/legacy/.ottoLegacy", OTTO_HOME: "/data" })).toBe(
      "/data|/data",
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("keeps every state on the /data volume, never a host folder", () => {
  expect(dockerfile).toContain("OTTO_HOME=/data");
  expect(dockerfile).not.toMatch(/^VOLUME/m);
  expect(compose).toContain("otto-data:/data");
  expect(dockerfile).not.toContain("/workspace");
  expect(compose).not.toContain("/workspace");
  expect(entrypoint).toContain("exec setpriv --reuid=node --regid=node");
});

it("installs from package manifests before copying source", () => {
  const installAt = dockerfile.indexOf("pnpm install --frozen-lockfile");
  const copySourceAt = dockerfile.indexOf("COPY . .");
  expect(installAt).toBeGreaterThan(-1);
  expect(copySourceAt).toBeGreaterThan(installAt);
  const beforeInstall = dockerfile.slice(0, installAt);

  for (const manifest of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/server/package.json",
    "apps/web/package.json",
    "scripts/clean-tsgo-backups.mjs",
    "patches",
  ]) {
    expect(beforeInstall).toContain(manifest);
  }
});

it("keeps root and nested environment and private-key files out of the Docker context", () => {
  expect(dockerignore).toContain(".env.*");
  expect(dockerignore).toContain("**/.env.*");
  expect(dockerignore).toContain(".env*");
  expect(dockerignore).toContain("**/.env*");
  expect(dockerignore).toContain("!.env.example");
  expect(dockerignore).toContain("!**/.env.example");
  expect(dockerignore).toContain("**/*.pem");
  expect(dockerignore).toContain("**/*.key");
});
