import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import { backupDatabases } from "../backup.ts";
import { deriveServerPaths } from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";

export const backupCommand = Command.make(
  "backup",
  { baseDir: Flag.string("base-dir").pipe(Flag.optional) },
  (flags) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;

      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(flags.baseDir) ??
          process.env.OTTO_HOME ??
          process.env.OTTO_LEGACY_HOME,
      );

      const { stateDir } = yield* deriveServerPaths(baseDir, undefined);

      const target = yield* backupDatabases({
        stateDir,
        backupsDir: path.join(baseDir, "backups"),
        now: yield* Clock.currentTimeMillis,
      });

      yield* Console.log(target);
    }),
).pipe(Command.withDescription("Back up Otto's databases into <home>/backups, keeping seven."));
