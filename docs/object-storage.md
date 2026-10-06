# Object storage (S3) as the source of truth for files

Status: P4a built (the S3 `FileStore` driver, library on S3 with a read-through cache; see "Built: P4a" below). Skills and sources on S3 are still plan (owner: "skills and sources must be saved to S3 as well, for a proper source of truth").

## Rule

Anything that is a file or a folder of files is stored in S3-compatible object storage (Garage when self-hosted, any S3 elsewhere). The database holds the metadata and the index; S3 holds the bytes; a local disk copy is a cache that agents read by path. Secrets never go to S3: they stay in the `secrets` table (encrypted with `ENCRYPTION_KEY`) and files only keep a `secretId`.

| What | Metadata (DB) | Bytes (S3) | Local disk |
|---|---|---|---|
| Library items | `library` (built) | `library/<id>` through the `FileStore` | cache (disk driver today) |
| Skills | `skills` (new): id, workspaceId, slug, title, description, scope, updatedAt | `workspaces/<ws>/skills/<slug>/...` (the whole folder: `SKILL.md`, icon, extras) | `<workspace>/skills/<slug>/` materialized for agents |
| Sources | `sources` (new): id, workspaceId, slug, title, type, secretId, updatedAt | `workspaces/<ws>/sources/<slug>/...` (config, guide, icon) | `<workspace>/sources/<slug>/` materialized |
| Chat message files (later) | `chats` (planned) | `workspaces/<ws>/chats/<id>/...` | cache |

## Mechanism (one driver, reused)

1. **S3 `FileStore` driver** (`packages/shared/src/library/file-store`): the interface already exists (put, stage, get, open as a stream, delete, keys are ids). Add an `s3` driver next to `disk`, using Bun's built-in `S3Client` (no dependency; endpoint, bucket, region and keys from env, credentials in Infisical). `OTTO_STORAGE=disk|s3` picks it. Library is the first user.
2. **Bundles** (skills, sources): a folder is a set of keys under one prefix. Writes go DB-row-first (`updatedAt` guard, same two-phase idea as library saves), then S3, then the local copy is refreshed.
3. **Disk is a cache that agents edit.** Agents change `SKILL.md` or a source's config by path. The existing config watcher (it already watches skills and sources) pushes a changed file to S3 and bumps the row's `updatedAt`; the server materializes from S3 at boot and when another node changes a bundle (the `domain:changed` push carries `skills` / `sources`). Conflicts: the newer `updatedAt` wins, a refused push reloads the local copy and toasts.
4. **No S3 configured:** the disk driver stays the default (local desktop, dev), so nothing changes for a single machine.

## Built: P4a

Library bytes can live in S3. Code: `packages/shared/src/library/{file-store,s3-file-store,storage}.ts`.

- **Selection.** The headless server calls `initFileStorage()` at boot (`packages/server/src/index.ts`); the desktop app never does, so it stays on disk. `OTTO_STORAGE=disk|s3` (default `disk`). With `s3`: `OTTO_S3_ENDPOINT`, `OTTO_S3_BUCKET`, `OTTO_S3_REGION`, `OTTO_S3_ACCESS_KEY_ID`, `OTTO_S3_SECRET_ACCESS_KEY` are required (the server refuses to boot naming the missing ones, never the values) and `OTTO_S3_PREFIX` is optional (a folder in the bucket; default none). Path-style addressing (`<endpoint>/<bucket>/<key>`), which Garage and minio need and AWS accepts. The driver is Bun's built-in `S3Client`; credentials are never logged (the boot line shows bucket and endpoint host only).
- **Keys.** `[<prefix>/]workspaces/<workspaceId>/library/<itemId>`: one object per item, no rev in the key. The `rev` prefix of decision 7 is for bundles (skills, sources), where a write is many objects; a library write is one object and S3 overwrites an object atomically, so the item's `updatedAt` guard in the database stays the single commit point.
- **Save.** `stage` keeps the bytes in memory and uploads nothing; `commit` is the one PUT, run after the guarded row update (Bun's S3 has no server-side copy, so the plan's "temp key then copy" was dropped as it adds a request and a leaked-object case for nothing). A failed PUT throws and the library puts the row back; a failed or discarded stage never touches the stored object.
- **`FileStore` interface.** Added `list(prefix?)` (keys relative to the store; disk and S3 alike; for the bundle sync in P4b). Keys stay validated ids.
- **Read-through cache rule.** `<workspace>/library/<id>` stays the path agents read. On S3 it is a cache: valid while the ETag recorded at `<workspace>/library/.etags/<id>` equals the object's current ETag (one HEAD per `get`/`open`). `get`/`open` download a missing or outdated file (streamed to a temp file and renamed, never buffered whole), then serve it from disk; `put` and a committed save write the new bytes through; `delete`, or a read that finds the object gone, drops the cached file. On `disk` the directory is the store and nothing changes.
- **Not wired yet.** Nothing fills the cache before an agent turn that names a file on a node that did not receive the upload (restart with an empty disk, a second node): a read through the library (`library:read`, `get`) does. Calling the store's `get`/`open` before building a turn's attachment paths is the P4b/P3 step. Existing library files are not copied to a bucket when switching from `disk` to `s3` (`list` plus `put` is the migration, not built).
- **Tests.** `packages/shared/src/library/__tests__/`: `s3-double.ts` is a small in-process S3 server (PUT, GET, HEAD, DELETE, ListObjectsV2); `file-store.contract.test.ts` runs one suite against the disk and the S3 driver; `s3-file-store.test.ts` covers the cache, key layout, env and the library domain on S3. Against a real Garage or minio: create a bucket, then run `OTTO_TEST_S3_ENDPOINT=http://localhost:3900 OTTO_TEST_S3_BUCKET=<bucket> OTTO_TEST_S3_REGION=garage OTTO_TEST_S3_ACCESS_KEY_ID=<id> OTTO_TEST_S3_SECRET_ACCESS_KEY=<secret> bun test packages/shared/src/library/__tests__/file-store.contract.test.ts` (it uses a unique prefix and deletes what it wrote). Not run here: no Garage or minio is installed.

## Order

1. S3 driver in `FileStore` + a test against Garage in a container (or Bun's S3 test double): library on S3.
2. `skills` and `sources` tables, the sync (watcher to S3, materialize from S3), the grids read the tables (instant lists, search, private/shared rules per workspace).
3. Chats' message files and attachments (with the `chats` table).
4. Backup and restore follow for free: DB dump + the bucket.

## Open

Garage versus another S3 provider, bucket-per-install versus per-workspace prefix (prefix proposed), retention/versioning (turn on bucket versioning instead of building history).
