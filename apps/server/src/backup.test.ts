import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { backupDatabases } from "./backup.ts";

it.effect("copies a live WAL database consistently and keeps the newest seven backups", () =>
  Effect.gen(function* () {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-backup-"));
    const stateDir = NodePath.join(root, "userdata");
    const backupsDir = NodePath.join(root, "backups");
    NodeFS.mkdirSync(stateDir);
    NodeFS.writeFileSync(NodePath.join(stateDir, "settings.json"), "{}");
    const live = new NodeSqlite.DatabaseSync(NodePath.join(stateDir, "state.sqlite"));
    live.exec("PRAGMA journal_mode = WAL; CREATE TABLE notes (body TEXT);");
    live.exec("INSERT INTO notes VALUES ('kept');");

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        live.close();
        NodeFS.rmSync(root, { recursive: true, force: true });
      }),
    );

    let target = "";

    for (let day = 1; day <= 9; day += 1) {
      target = yield* backupDatabases({ stateDir, backupsDir, now: Date.UTC(2026, 9, day) });
    }

    assert.lengthOf(NodeFS.readdirSync(backupsDir), 7);
    assert.deepEqual(NodeFS.readdirSync(target), ["state.sqlite"]);
    const copy = new NodeSqlite.DatabaseSync(NodePath.join(target, "state.sqlite"));
    assert.deepEqual(copy.prepare("SELECT body FROM notes").all(), [{ body: "kept" }]);
    copy.close();
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
