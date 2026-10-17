import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

export interface BetaReleasePlan {
  readonly publish: boolean;
  readonly version?: string;
  readonly tag?: string;
}

export interface BetaReleaseInput {
  readonly packageVersion: string;
  readonly latestStableVersion?: string;
  readonly headSha: string;
  readonly previousSha?: string;
  readonly previousIsAncestor?: boolean;
  readonly date: string;
  readonly runNumber: string;
}

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseStableVersion(label: string, version: string): readonly [number, number, number] {
  const match = STABLE_VERSION_PATTERN.exec(version);

  if (!match) throw new Error(`${label} is invalid: ${version}.`);

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function planBetaRelease(input: BetaReleaseInput): BetaReleasePlan {
  const packageVersion = parseStableVersion("Package version", input.packageVersion);

  const latestStable = input.latestStableVersion
    ? parseStableVersion("Latest stable version", input.latestStableVersion)
    : packageVersion;

  if (!/^[0-9a-f]{7,40}$/u.test(input.headSha)) {
    throw new Error(`Beta head SHA is invalid: ${input.headSha}.`);
  }

  if (!/^\d{8}$/u.test(input.date)) throw new Error(`Beta date is invalid: ${input.date}.`);

  if (!/^[1-9]\d*$/u.test(input.runNumber)) {
    throw new Error(`Beta run number is invalid: ${input.runNumber}.`);
  }

  if (input.previousSha === input.headSha) return { publish: false };

  if (input.previousSha && input.previousIsAncestor === false) {
    throw new Error("The latest published beta is not an ancestor of main.");
  }

  const stableIsNewer =
    latestStable[0] - packageVersion[0] ||
    latestStable[1] - packageVersion[1] ||
    latestStable[2] - packageVersion[2];

  const [major, minor, patch] = stableIsNewer > 0 ? latestStable : packageVersion;
  const version = `${major}.${minor}.${patch + 1}-beta.${input.date}.${input.runNumber}`;

  return { publish: true, version, tag: `v${version}` };
}

function gitIsAncestor(previousSha: string, headSha: string): boolean {
  return (
    NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", previousSha, headSha])
      .status === 0
  );
}

function optional(argument: string | undefined): string | undefined {
  return argument && argument !== "-" ? argument : undefined;
}

function main(): void {
  const [packageVersion, latestStableArgument, headSha, previousShaArgument, date, runNumber] =
    process.argv.slice(2);

  if (!packageVersion || !headSha || !date || !runNumber) {
    throw new Error(
      "Usage: node scripts/beta-release.ts <package-version> <latest-stable-version|-> <head-sha> <previous-sha|-> <yyyymmdd> <run-number>",
    );
  }

  const latestStableVersion = optional(latestStableArgument);
  const previousSha = optional(previousShaArgument);

  const plan = planBetaRelease({
    packageVersion,
    headSha,
    date,
    runNumber,
    ...(latestStableVersion ? { latestStableVersion } : {}),
    ...(previousSha
      ? { previousSha, previousIsAncestor: gitIsAncestor(previousSha, headSha) }
      : {}),
  });

  const output = [`publish=${String(plan.publish)}`];

  if (plan.version && plan.tag) output.push(`version=${plan.version}`, `tag=${plan.tag}`);
  const rendered = `${output.join("\n")}\n`;
  const outputPath = process.env.GITHUB_OUTPUT;

  if (outputPath) NodeFS.appendFileSync(outputPath, rendered);
  else process.stdout.write(rendered);
}

if (import.meta.url === NodeURL.pathToFileURL(process.argv[1] ?? "").href) main();
