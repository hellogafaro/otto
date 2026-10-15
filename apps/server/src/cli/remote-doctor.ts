import { RemoteDoctorReport } from "@otto/contracts";
import { HostProcessArchitecture, HostProcessPlatform } from "@otto/shared/hostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import { resolveBaseDir } from "../os-jank.ts";
import {
  renderRemoteDoctor,
  runRemoteDoctor,
  writeRemoteSupportBundle,
} from "../remote/diagnostics.ts";

const encodeDoctorReport = Schema.encodeEffect(Schema.fromJsonString(RemoteDoctorReport));

/**
 * Otto Remote diagnostics read only Otto's home: an explicit `--base-dir`, then `OTTO_HOME`,
 * then `~/.otto`. An ambient `OTTO_LEGACY_HOME` is ignored so Otto Legacy's `~/.ottoLegacy` is never inspected
 * or repaired by accident.
 */
export const remoteDoctorHome = (
  baseDirFlag: Option.Option<string>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => Option.getOrUndefined(baseDirFlag) ?? env.OTTO_HOME;

export const remoteDoctorCommand = Command.make(
  "__remote-doctor",
  {
    json: Flag.boolean("json").pipe(Flag.withDefault(false)),
    repair: Flag.boolean("repair").pipe(Flag.withDefault(false)),
    supportBundle: Flag.string("support-bundle").pipe(Flag.optional),
    baseDir: Flag.string("base-dir").pipe(Flag.optional),
  },
  (flags) =>
    Effect.gen(function* () {
      const baseDir = yield* resolveBaseDir(remoteDoctorHome(flags.baseDir, process.env));
      const platform = yield* HostProcessPlatform;

      const report = yield* Effect.promise(() =>
        runRemoteDoctor({ baseDir, repair: flags.repair, platform }),
      );

      if (Option.isSome(flags.supportBundle)) {
        const bundlePath = Option.getOrThrow(flags.supportBundle);
        const arch = yield* HostProcessArchitecture;
        yield* Effect.sync(() => writeRemoteSupportBundle(bundlePath, report, { platform, arch }));
      }

      const output = flags.json
        ? yield* encodeDoctorReport(report).pipe(Effect.orDie)
        : renderRemoteDoctor(report);

      yield* Console.log(output);
    }),
).pipe(Command.withDescription("Run typed Otto Remote diagnostics."));
