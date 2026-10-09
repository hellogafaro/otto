# Durable localhost development

This is a private local development instance, not a deployment or a disposable
test fixture. PostgreSQL and Garage state live in
`~/.capy/work/otto-v1-durable`; stopping services never deletes that directory.
The old SQLite and isolated test clusters stay separate and unchanged.

## Start tomorrow

Use the assigned checkout and qualified Bun. The launcher requires Bun 1.4.2
or later and resolves its repository/config paths from its own location, not
the terminal's current directory. On the qualified machine:

```sh
REPO="/Users/jg/.capy/worktrees/jam_01M4BZMD6M2Y9EEVA8SX8BXFS1/otto"
BUN="$HOME/.capy/work/otto-v1-preflight-2a6e9a79/runtime/bin/bun"
cd "$REPO"
```

Start PostgreSQL in an owned terminal or detached process. An already-running
owned cluster is left alone. This command never initializes a cluster:

```sh
"$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" postgres
```

PostgreSQL is Homebrew 17.6, with UTF-8 database and role `otto_dev`. It listens
only on its private 0700 Unix socket directory, port 55437, with no TCP or
database password. Do not substitute a shared database. Native schema sync is
explicit and rejects interactive destructive proposals:

```sh
"$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" schema
```

Start the already-provisioned Garage container. The launcher verifies its
ownership label, pinned image, command, bind mounts, private network and
loopback-only port before reusing it. It never removes/recreates a mismatched
container or resets data:

```sh
"$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" garage
```

The storage container is `otto-v1-durable-garage`; S3 is
`http://127.0.0.1:43900`, bucket `otto-dev`, region `garage`. Its pinned official
v2.4.1 image has no entrypoint, so startup explicitly invokes `/garage server`.
The config is mounted read-only from `ops/local-garage.toml`; data and metadata
are bind-mounted from the durable state directory. Single-node fsync is enabled
but provides no redundancy or backup guarantee.

Use explicit current vault selectors, not the historical `.infisical.json`.
The clean wrapper prevents ambient credentials from being mistaken for values
in the authorized project. It creates no secrets:

```sh
otto_secrets() {
  env -i HOME="$HOME" PATH="$PATH" LC_ALL=C \
    infisical --telemetry=false --silent \
    --profile johan@hellogafaro.com--hello-gafaro-v-qjc \
    --domain https://vault.hellogafaro.net \
    run --projectId 44ca0ed3-4d24-4f7e-a080-43f0b8787035 \
    --env dev --path / --include-imports=false \
    --secret-overriding=false --expand=false -- \
    "$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" "$@"
}
otto_secrets server
```

The API binds `127.0.0.1:45175`. Keep Vite on `http://localhost:5173`, using its
existing HMR command and API proxy; do not run a production build. Verify who
owns an existing API or Vite listener before stopping it. The server wrapper
forwards only its allowlisted config, not legacy web-UI credentials or ambient
model-provider keys. It does not start without valid auth and S3 configuration.

## One-time storage provisioning

Provisioning is separate from routine startup and requires approval for exactly
these previously absent Otto/dev root names:

| Name | Origin | Consumer |
| --- | --- | --- |
| `GARAGE_RPC_SECRET` | Locally generated 32 random bytes, hex encoded | Garage server/local RPC CLI |
| `S3_ACCESS_KEY_ID` | Issued by Garage | Otto S3 client |
| `S3_SECRET_ACCESS_KEY` | Issued with the ID by Garage | Otto S3 client |

Create the internal `otto-v1-durable` Docker network with the ownership label
`io.otto.purpose=durable-local-dev`. First container creation uses
`otto_secrets garage`, after the RPC secret is approved and stored. The helper
creates only private data directories and the owned container; a separate
approved provisioning step assigns the single-node layout, creates the bucket
and grants its key read/write access without ownership or bucket-creation rights.

`/garage json-api CreateKey -` supports stdin requests and JSON stdout over
local RPC, so no persistent admin token is required. Capture stdout/stderr
entirely in memory; never print issuance results or raw errors. Vault writes
require an approved atomic create-only API; a preflight absence check followed
by the CLI's upsert command cannot guarantee no overwrite. Transport credentials
in process memory, never credential-valued arguments or files. No storage
credential is derived from an existing secret.
Garage retains issued keys in its private metadata; Docker retains the RPC
environment in local container state. Do not print unrestricted inspection
output. Partial provisioning must be reconciled explicitly, never silently
rotated or overwritten on retry.

The existing `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` remain untouched. The
existing encryption value is 64 hex characters; the local restart wrapper
re-encodes the same 32 bytes as canonical base64 in memory. Production config
validation stays unchanged, and no saved data is migrated.

## Authentication and restarts

No users, email verification, memberships or provider accounts are created by
this launcher. Normal signup requires an approved Resend sender/key pair
(`MAIL_FROM`, `RESEND_API_KEY`); no alternative mail backend or auth bypass is
provided. A new empty database has no verified user until legitimate enrollment.

Stopping the foreground PostgreSQL/server wrapper signals only its child.
For an explicit PostgreSQL stop, use `pg_ctl -D` against this exact durable
data directory, then the start command above. For a deliberate storage restart,
use `docker restart otto-v1-durable-garage` after checking ownership. Routine
`garage` startup uses `docker start`, so a running storage process is not
interrupted. Credential rotation or config/mount changes require explicit
reconciliation; the helper never replaces an existing container automatically.

Before claiming readiness, prove a real S3 byte roundtrip across a full Garage
process restart and authenticated application persistence/reload. Disposable
storage peers, controlled provider fixtures and schema success alone do not
establish these results. Keep source hashes, scoped results and remaining
unverified gates in the native acceptance handoff.
