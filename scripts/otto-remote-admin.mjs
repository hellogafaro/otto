import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const artifactRoot = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const node = process.execPath;

const serverEntry =
  process.env.OTTO_SERVER_ENTRYPOINT ||
  NodePath.join(artifactRoot, "node_modules", "otto", "dist", "bin.mjs");

const launcherEntry =
  process.env.OTTO_LAUNCHER_ENTRYPOINT ||
  NodePath.join(artifactRoot, "node_modules", "otto", "dist", "service-launcher.mjs");

const baseDir = process.env.OTTO_HOME || NodePath.join(NodeOS.homedir(), ".otto");

const userdata = NodePath.join(baseDir, "userdata");

// The server and service launcher read OTTO_LEGACY_HOME; derive it from the Otto home so an ambient
// Otto Legacy home can never redirect remote administration.
const childEnv = { ...process.env, OTTO_HOME: baseDir, OTTO_LEGACY_HOME: baseDir };

const version = NodeFS.readFileSync(NodePath.join(artifactRoot, "VERSION"), "utf8").trim();

// The Windows launcher forwards its original arguments, including the leading `remote`.
const argv =
  process.argv[2]?.toLowerCase() === "remote" ? process.argv.slice(3) : process.argv.slice(2);

const command = argv[0] || "help";

const args = argv.slice(1);

const run = (executable, parameters, options = {}) => {
  const result = NodeChildProcess.spawnSync(executable, parameters, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0)
    throw new Error(
      `${NodePath.basename(executable)} failed with exit code ${result.status ?? "unknown"}.`,
    );
};

// Task Scheduler owns the Windows service; the CLI boot-service manager supports only systemd
// and launchd.
const SERVICE_TASK = "Otto Remote";

const schtasks = (...parameters) => NodeChildProcess.spawnSync("schtasks.exe", parameters);

const otto = (...parameters) =>
  run(node, [serverEntry, ...parameters], {
    env: { ...childEnv, OTTO_SERVICE_RUNTIME_ROOT: artifactRoot },
  });

const currentVersion = () => {
  try {
    const state = JSON.parse(
      NodeFS.readFileSync(NodePath.join(baseDir, "runtime", "service-state.json"), "utf8"),
    );

    return state.protocol === 2 && typeof state.activeVersion === "string"
      ? state.activeVersion
      : version;
  } catch {
    return version;
  }
};

// Same pinned Ed25519 key as install-remote.sh and scripts/otto-release-manifest.pub. There is no
// environment override: a scheduled task's environment must never be able to replace the release key.
const RELEASE_MANIFEST_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAA74gQCflQCtBbynI3b+W2z/unYne9w6mPsei/hpmEWg=",
  "-----END PUBLIC KEY-----",
].join("\n");

const download = async (url) => {
  const response = await fetch(url, { headers: { "user-agent": "Otto-Remote-Updater" } });

  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`);

  return Buffer.from(await response.arrayBuffer());
};

// Mirrors the Unix `remote update`: resolve the latest release, verify the Windows archive against
// the signed manifest, stage it beside the running version, then ask the service to update.
// `update` accepts two test-only flags so tests can stage a signed stub release. They require
// OTTO_REMOTE_TEST_RELEASE=1 because the launcher forwards every `otto remote` argument, and
// `--manifest-key-file` replaces the pinned key for that one invocation.
const update = async (parameters) => {
  const repo = process.env.OTTO_REMOTE_REPOSITORY || "hellogafaro/otto";

  if (repo !== "hellogafaro/otto" && process.env.OTTO_REMOTE_ALLOW_CUSTOM_REPOSITORY !== "1") {
    throw new Error("Custom release repositories require OTTO_REMOTE_ALLOW_CUSTOM_REPOSITORY=1.");
  }

  let apiOrigin = "https://api.github.com";
  let manifestKey = RELEASE_MANIFEST_KEY;

  for (let index = 0; index < parameters.length; index += 1) {
    const flag = parameters[index];

    if (flag === "--api-origin" || flag === "--manifest-key-file") {
      const value = parameters[index + 1];

      if (process.env.OTTO_REMOTE_TEST_RELEASE !== "1") {
        throw new Error(`${flag} is only available to Otto release tests.`);
      }

      if (!value) throw new Error(`${flag} requires a value.`);

      if (flag === "--api-origin") apiOrigin = value;
      else manifestKey = NodeFS.readFileSync(value, "utf8");
      index += 1;
    } else {
      throw new Error(`Unknown remote update argument: ${flag}`);
    }
  }

  const release = JSON.parse(
    (await download(`${apiOrigin}/repos/${repo}/releases/latest`)).toString("utf8"),
  );

  const tag = String(release.tag_name ?? "");

  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag))
    throw new Error("Could not resolve the latest Otto release.");
  const targetVersion = tag.slice(1);
  const deferred = NodePath.join(userdata, "remote-update-deferred-at");

  if (targetVersion === currentVersion()) {
    NodeFS.rmSync(deferred, { force: true });
    console.log(`Otto Remote ${targetVersion} is already current.`);

    return;
  }

  const asset = async (name) => {
    const url = release.assets?.find((entry) => entry.name === name)?.browser_download_url;

    if (!url) throw new Error(`Release ${tag} does not include ${name}.`);

    return download(url);
  };

  const archiveName = `Otto-Remote-${targetVersion}-win32-x64.zip`;

  const [archive, manifest, signature] = await Promise.all(
    [archiveName, "OTTO-REMOTE-MANIFEST.txt", "OTTO-REMOTE-MANIFEST.sig"].map(asset),
  );

  if (!NodeCrypto.verify(null, manifest, manifestKey, signature)) {
    throw new Error("The release manifest signature does not match the pinned Otto release key.");
  }

  const expected = manifest
    .toString("utf8")
    .split(/\r?\n/u)
    .map((line) => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/iu))
    .find((match) => match?.[2] === archiveName)?.[1];

  if (!expected) throw new Error(`Release checksum is missing for ${archiveName}.`);

  if (NodeCrypto.createHash("sha256").update(archive).digest("hex") !== expected.toLowerCase()) {
    throw new Error(`SHA-256 verification failed for ${archiveName}.`);
  }

  const installRoot = process.env.OTTO_INSTALL_ROOT || NodePath.resolve(artifactRoot, "..", "..");
  const target = NodePath.join(installRoot, "versions", targetVersion);

  if (!NodeFS.existsSync(target)) {
    const next = `${target}.next.${process.pid}`;
    NodeFS.rmSync(next, { recursive: true, force: true });
    NodeFS.mkdirSync(next, { recursive: true });

    try {
      NodeFS.writeFileSync(NodePath.join(next, archiveName), archive);

      // Windows' bundled bsdtar reads the release zip.
      const tar =
        process.env.OTTO_REMOTE_TAR ||
        NodePath.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

      run(tar, ["-xf", NodePath.join(next, archiveName), "-C", next]);

      if (!NodeFS.existsSync(NodePath.join(next, "otto", "otto.cmd")))
        throw new Error("The Otto Remote archive is incomplete.");
      NodeFS.renameSync(NodePath.join(next, "otto"), target);
    } finally {
      NodeFS.rmSync(next, { recursive: true, force: true });
    }
  }

  const modeFile = NodePath.join(artifactRoot, "REMOTE_MODE");

  if (NodeFS.existsSync(modeFile))
    NodeFS.copyFileSync(modeFile, NodePath.join(target, "REMOTE_MODE"));
  console.log(`Prepared Otto Remote ${targetVersion} for a transactional service update.`);

  let port, token;

  try {
    port = JSON.parse(
      NodeFS.readFileSync(NodePath.join(userdata, "server-runtime.json"), "utf8"),
    ).port;
    token = NodeFS.readFileSync(NodePath.join(userdata, "remote-control-token"), "utf8").trim();
  } catch {}

  if (!port || !token)
    throw new Error(
      "The running service state or update credential is missing. Run otto remote doctor --repair.",
    );

  const response = await fetch(`http://127.0.0.1:${port}/api/remote/update`, {
    method: "POST",
    headers: { "x-otto-machine-token": token, "content-type": "application/json" },
    body: JSON.stringify({ targetVersion }),
  });

  const body = await response.text();

  if (response.status === 409) {
    if (!NodeFS.existsSync(deferred))
      NodeFS.writeFileSync(deferred, `${new Date().toISOString()}\n`);

    if (Date.now() - Date.parse(NodeFS.readFileSync(deferred, "utf8").trim()) >= 86_400_000) {
      throw new Error(
        `Update ${targetVersion} exceeded its 24-hour maintenance deadline while bot work remained active. Run otto remote doctor.`,
      );
    }

    console.log(
      `Update ${targetVersion} deferred because a bot turn is active; the hourly task will retry.`,
    );

    return;
  }

  if (response.status !== 202)
    throw new Error(`Otto update request failed with HTTP ${response.status}: ${body}`);
  NodeFS.rmSync(deferred, { force: true });
  console.log(`${body}\nOtto Remote update ${targetVersion} entered the transactional launcher.`);
};

switch (command) {
  case "doctor":
    otto("__remote-doctor", ...args);
    break;
  case "status":
    otto("__remote-doctor");
    otto("service", "status");
    break;
  case "logs": {
    const log = NodePath.join(userdata, "logs", "boot-service.log");

    if (!NodeFS.existsSync(log)) throw new Error("No service log was found.");
    const lines = NodeFS.readFileSync(log, "utf8").trimEnd().split(/\r?\n/u);
    process.stdout.write(`${lines.slice(-Number(process.env.OTTO_LOG_LINES || 200)).join("\n")}\n`);
    break;
  }

  case "link":
  case "heartbeat":
  case "unlink":
    throw new Error(
      "Hosted account linking is not part of self-hosted Otto Remote; pair directly with otto pair.",
    );
  case "rollback":
    run(node, [launcherEntry, "--manual-rollback"], { env: childEnv });
    schtasks("/End", "/TN", SERVICE_TASK);
    run("schtasks.exe", ["/Run", "/TN", SERVICE_TASK]);
    break;
  case "uninstall":
    schtasks("/End", "/TN", SERVICE_TASK);
    {
      // Try every task, then confirm any failed delete against the full task list. A task that is
      // already gone is fine; one that is still scheduled would run Remote again.
      const tasks = [SERVICE_TASK, "Otto Remote Update", "Otto Remote Heartbeat"];
      const failed = tasks.filter((task) => schtasks("/Delete", "/F", "/TN", task).status !== 0);

      if (failed.length > 0) {
        const listed = NodeChildProcess.spawnSync("schtasks.exe", ["/Query", "/FO", "CSV", "/NH"], {
          encoding: "utf8",
        });

        if (listed.status !== 0)
          throw new Error(`Could not confirm removal of scheduled tasks: ${failed.join(", ")}.`);

        const scheduled = new Set(
          listed.stdout.split(/\r?\n/u).map((row) => row.match(/^"\\?([^"]*)"/u)?.[1]),
        );

        const remaining = failed.filter((task) => scheduled.has(task));

        if (remaining.length > 0)
          throw new Error(`Could not remove scheduled tasks: ${remaining.join(", ")}.`);
      }
    }

    console.log("Removed Otto Remote. Its data remains in ~/.otto.");
    break;
  case "update":
    if (process.env.OTTO_REMOTE_CONTAINER === "1")
      throw new Error("Docker manages Otto updates by changing the image tag.");
    await update(args);
    break;
  case "help":
    console.log("Usage: otto remote {doctor|status|logs|update|rollback|uninstall}");
    break;
  default:
    throw new Error("Unknown Otto Remote command.");
}
