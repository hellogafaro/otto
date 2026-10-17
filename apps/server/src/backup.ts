import * as NodeSqlite from "node:sqlite";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import { ServerConfig } from "./config.ts";

const KEEP = 7;

const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/;

const listBackups = (backupsDir: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readDirectory(backupsDir)),
    Effect.map((names) => names.filter((name) => BACKUP_NAME.test(name)).sort()),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  );

/**
 * Copies every SQLite database in the state directory into `<backupsDir>/<time>` with SQLite's
 * online backup, which stays consistent while the server writes, then keeps the newest seven.
 * The source opens read-only: a writable connection from this SQLite build would delete the WAL
 * on close under another build's open connection (libsql's memory store) and break it.
 */
export const backupDatabases = Effect.fn("backupDatabases")(function* (input: {
  readonly stateDir: string;
  readonly backupsDir: string;
  readonly now: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stamp = DateTime.formatIso(DateTime.makeUnsafe(input.now)).replaceAll(":", "-");
  const target = path.join(input.backupsDir, stamp);
  yield* fs.makeDirectory(target, { recursive: true, mode: 0o700 });

  yield* Effect.gen(function* () {
    for (const name of yield* fs.readDirectory(input.stateDir)) {
      if (!name.endsWith(".sqlite")) continue;

      yield* Effect.acquireUseRelease(
        Effect.try(
          () => new NodeSqlite.DatabaseSync(path.join(input.stateDir, name), { readOnly: true }),
        ),
        (database) => Effect.tryPromise(() => NodeSqlite.backup(database, path.join(target, name))),
        (database) => Effect.sync(() => database.close()),
      );
    }
  }).pipe(Effect.onError(() => fs.remove(target, { recursive: true }).pipe(Effect.ignore)));

  for (const old of (yield* listBackups(input.backupsDir)).slice(0, -KEEP)) {
    yield* fs.remove(path.join(input.backupsDir, old), { recursive: true });
  }

  return target;
});

/** Hourly, backs up the databases into `<baseDir>/backups` once the newest backup is a day old. */
export const dailyBackupLoop = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const backupsDir = path.join(config.baseDir, "backups");
  const now = yield* Clock.currentTimeMillis;
  const latest = (yield* listBackups(backupsDir)).at(-1);

  const newest = latest
    ? yield* fs.stat(path.join(backupsDir, latest)).pipe(
        Effect.map((info) => Option.match(info.mtime, { onNone: () => 0, onSome: (at) => +at })),
        Effect.orElseSucceed(() => 0),
      )
    : 0;

  if (now - newest < Duration.toMillis(Duration.days(1))) return;
  const target = yield* backupDatabases({ stateDir: config.stateDir, backupsDir, now });
  yield* Effect.logInfo("databases backed up", { target });
}).pipe(
  Effect.catch((error) => Effect.logWarning("database backup failed", { error })),
  Effect.catchDefect((defect) => Effect.logWarning("database backup defect", { defect })),
  Effect.repeat(Schedule.spaced(Duration.hours(1))),
);
