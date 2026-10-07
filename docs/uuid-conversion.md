# UUID cutover and offline copy

New application rows/messages/workspaces use direct platform `crypto.randomUUID()`.
NanoID and the former ID module/export are removed, as are message/workspace generator
wrappers. Mastra uses its native UUID default, while official composite/internal keys
stay unchanged. SQLite ID columns remain text; no DDL rekey is needed.

## Existing data

Never run a conversion on the active install. Stop the server, take a verified backup
and obtain explicit execution approval first. `scripts/db-uuid.ts` writes a **new config
copy** from a readonly SQLite `VACUUM INTO` snapshot, transforms the copy, copies files
and publishes it only after success. The original directory/database is never rewritten.
Do not point it at Johan's personal install to test it.

```
bun run scripts/db-uuid.ts <stopped-source-config-directory> <new-copy-directory>
```

Provide `ENCRYPTION_KEY` through the existing secure environment, never arguments/logs.
The key is required because `secrets` encrypt/decrypt binds AES-GCM authenticated data
to the row ID. Its owning domain rebinds a fixture value from old ID to new ID inside
the conversion transaction; ciphertext is never treated as plain ID-bearing text.
Wrong/missing key fails the transaction and removes unpublished staging data.

Explicit app tables are mapped, with row references, actor/entity strings, JSON keys
and values, canonical DM ordering, credential-provider account IDs, chat message IDs,
metadata/path references and local Library/session files. External provider account IDs
and auth token/password fields are not changed. Message search is rebuilt. Converted
credential fixtures sign in through Better Auth and secrets decrypt under their new IDs.
Repeated database conversion is a no-op; an existing destination is refused.

The procedure supports a stopped local install whose workspace roots are under the
source config directory, including portable `~` paths. It refuses symlinks, outside
workspace roots, remote S3 storage and any populated exact-owned Mastra runtime table.
Those require a separately reviewed import/copy procedure; do not copy vendor checkpoint
or remote object references blindly. Existing short-ID readers are temporary protection
for unconverted records, not new generation or a permanent common-pattern alternative.

Fixture tests cover linked task/Library references, memberships, JSON agent cursor keys,
paths, encrypted connection secret rebinding, unchanged source, wrong-key rollback,
real password sign-in, forced reverse UUID ordering for DMs and vendor-state refusal.
This proves the supported fixture procedure, not an executed migration of live data.
