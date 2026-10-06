# Object storage (S3) as the source of truth for files

Status: plan (owner: "skills and sources must be saved to S3 as well, for a proper source of truth"). Nothing built.

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

## Order

1. S3 driver in `FileStore` + a test against Garage in a container (or Bun's S3 test double): library on S3.
2. `skills` and `sources` tables, the sync (watcher to S3, materialize from S3), the grids read the tables (instant lists, search, private/shared rules per workspace).
3. Chats' message files and attachments (with the `chats` table).
4. Backup and restore follow for free: DB dump + the bucket.

## Open

Garage versus another S3 provider, bucket-per-install versus per-workspace prefix (prefix proposed), retention/versioning (turn on bucket versioning instead of building history).
