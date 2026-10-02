import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@otto/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getConstructionPlans } from "pg-boss";
import { z } from "zod";

/** Real PostgreSQL, isolated by a private 0700 socket directory, with TCP disabled. No credentials or shared services. */
export async function startPostgres() {
  const directory = await mkdtemp(join(tmpdir(), "otto-pg-"));
  await chmod(directory, 0o700);
  const packagePath = Bun.resolveSync(
    `@embedded-postgres/${process.platform}-${process.arch}`,
    dirname(
      Bun.resolveSync(
        "embedded-postgres",
        dirname(fileURLToPath(import.meta.url)),
      ),
    ),
  );
  const binaries = z
    .object({ initdb: z.string(), postgres: z.string() })
    .parse(await import(packagePath));
  const packageDirectory = dirname(dirname(packagePath));
  const hydrate = Bun.spawnSync(
    [process.execPath, join(packageDirectory, "scripts/hydrate-symlinks.js")],
    { cwd: packageDirectory, stdout: "pipe", stderr: "pipe" },
  );
  if (hydrate.exitCode !== 0)
    throw new Error("PostgreSQL dependency symlink setup failed");
  const init = Bun.spawnSync(
    [
      binaries.initdb,
      "-D",
      join(directory, "data"),
      "--username=otto_test",
      "--auth-local=trust",
      "--auth-host=reject",
      "--locale=C",
      "--encoding=UTF8",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (init.exitCode !== 0)
    throw new Error(
      `Postgres init failed: ${init.stderr.toString().slice(-4000)}`,
    );
  const processHandle = Bun.spawn(
    [
      binaries.postgres,
      "-D",
      join(directory, "data"),
      "-k",
      directory,
      "-c",
      "listen_addresses=",
      "-c",
      "unix_socket_permissions=0700",
      "-c",
      "fsync=on",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const database = openDatabase({
    host: directory,
    user: "otto_test",
    database: "postgres",
    port: 5432,
  });
  const stop = async () => {
    await database.pool.end();
    processHandle.kill("SIGTERM");
    await processHandle.exited;
    await rm(directory, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await database.pool.query("select 1");
        ready = true;
        break;
      } catch {
        await Bun.sleep(100);
      }
    }
    if (!ready) throw new Error("Private PostgreSQL did not become ready");
    await migrate(database.db, {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
    await database.pool.query(getConstructionPlans("otto_jobs"));
    return { ...database, stop, directory };
  } catch (error) {
    await stop();
    throw error;
  }
}
