/**
 * MigrationsLive - Migration runner with inline loader
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * Migrations run automatically when the MigrationLayer is provided,
 * ensuring the database schema is always up-to-date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Otto: One baseline until MVP; schema changes after it get numbered migrations.
import Migration0001 from "./migrations/001_Baseline.gen.ts";
import Migration0002 from "./migrations/002-project-cover.ts";
import Migration0003 from "./migrations/003-notifications.ts";
import Migration0004 from "./migrations/004-bot-instructions.ts";
import Migration0005 from "./migrations/005-thread-visibility.ts";
import Migration0006 from "./migrations/006-memories.ts";
import Migration0007 from "./migrations/007-compaction-usage.ts";
import Migration0008 from "./migrations/008-bot-always-allowed.ts";
import Migration0009 from "./migrations/009-composio-account-labels.ts";
import Migration0010 from "./migrations/010-task-repeat.ts";
import Migration0011 from "./migrations/011-retire-thread-settling.ts";
import Migration0012 from "./migrations/012-library-file-shares.ts";
import Migration0013 from "./migrations/013-routine-triggers.ts";
import Migration0014 from "./migrations/014-resource-memories.ts";
import Migration0015 from "./migrations/015-message-search.ts";
import Migration0016 from "./migrations/016-bot-visibility.ts";
import Migration0017 from "./migrations/017-bot-sandbox-size.ts";
import Migration0018 from "./migrations/018-person-dms.ts";
import Migration0019 from "./migrations/019-task-capabilities.ts";

const migrationEntries = [
  [1, "Baseline", Migration0001],
  [2, "ProjectCover", Migration0002],
  [3, "Notifications", Migration0003],
  [4, "BotInstructions", Migration0004],
  [5, "ThreadVisibility", Migration0005],
  [6, "Memories", Migration0006],
  [7, "CompactionUsage", Migration0007],
  [8, "BotAlwaysAllowed", Migration0008],
  [9, "ComposioAccountLabels", Migration0009],
  [10, "TaskRepeat", Migration0010],
  [11, "RetireThreadSettling", Migration0011],
  [12, "LibraryFileShares", Migration0012],
  [13, "RoutineTriggers", Migration0013],
  [14, "ResourceMemories", Migration0014],
  [15, "MessageSearch", Migration0015],
  [16, "BotVisibility", Migration0016],
  [17, "BotSandboxSize", Migration0017],
  [18, "PersonDms", Migration0018],
  [19, "TaskCapabilities", Migration0019],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries.flatMap(([id, name, migration]) =>
        throughId === undefined || id <= throughId ? [[`${id}_${name}`, migration]] : [],
      ),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));

  return executedMigrations;
});

/**
 * Layer that runs migrations when the layer is built.
 *
 * Use this to ensure migrations run before your application starts.
 * Migrations are run automatically - no separate script is needed.
 *
 * @example
 * ```typescript
 * import { MigrationsLive } from "@acme/db/Migrations"
 * import * as SqliteClient from "@acme/db/SqliteClient"
 *
 * // Migrations run automatically when SqliteClient is provided
 * const AppLayer = MigrationsLive.pipe(
 *   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
 * )
 * ```
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
