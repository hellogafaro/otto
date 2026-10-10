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

Garage has been provisioned on this installation with its approved vault
credentials, single-node layout and `otto-dev` bucket. Do not repeat provisioning
or issue replacement keys. Start the existing Colima `default` profile if it is
stopped (`colima start --profile default`); never reset or replace that VM.
Then start the owned Garage container. The launcher verifies its
ownership label, pinned image, command, bind mounts, private network and
loopback-only port before reusing it. It never removes/recreates a mismatched
container or resets data:

```sh
"$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" garage
```

Docker 29.5.2 does not activate published ports on an internal-only network.
Keep Garage's internal network and start this owned foreground process in a
separate terminal (or an owned detached process):

```sh
"$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" garage-forward
```

It verifies the existing Garage through the same launcher, resolves its current
internal IPv4 address, then uses Colima's existing SSH configuration to forward
only `127.0.0.1:43900` to Garage port 3900. It creates no credentials, network,
public listener or outbound route. It refuses a port conflict rather than
stopping another listener. Stopping this wrapper signals only its own SSH child;
re-run it after a VM stop or an SSH connection loss. Do not terminate unrelated
forwards. If the container's address changes, restart this owned forward to
resolve it again. Container recreation is not part of normal startup.

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
    /usr/bin/env -u MCP_ORIGIN -u MCP_ALLOW_LOOPBACK_HTTP \
    -u MCP_CREDENTIAL_BINDINGS -u MCP_ALLOW_ANONYMOUS \
    TRANSCRIPTION_MODEL=mistralai/voxtral-mini-transcribe \
    COMPUTER_DOCKER_IMAGE=sha256:b7adb4eb8a91a86f2c2ce9497311ae0cf8ce8a4bb81872bb540ef7bffa81fa08 \
    COMPUTER_DOCKER_SOCKET="$HOME/.colima/default/docker.sock" \
    COMPUTER_OWNER_ID=otto-v1-durable-compute \
    "$BUN" --no-env-file "$REPO/scripts/durable-dev.ts" "$@"
}
otto_secrets server
```

The API binds `127.0.0.1:45175`. Start Vite on `http://localhost:5173` with its
existing API proxy and HMR, not a production build:

```sh
cd "$REPO/apps/web"
"$BUN" --no-env-file --bun vite --host 127.0.0.1 --port 5173 --strictPort
```

Verify who
owns an existing API or Vite listener before stopping it. The server wrapper
forwards only its allowlisted config, not legacy web-UI credentials or ambient
model-provider keys. Valid auth configuration is required. When both S3 key
fields are absent it starts without storage; one missing key still fails
configuration. With all mail fields absent, ordinary email/password signup and
sign-in remain available; only password-reset and invitation delivery are
unavailable. The current installation already has its legitimate account and
Hello Gafaro workspace; do not replay its one-time bootstrap. These unavailable services are
reported at startup; they are not replaced with in-memory storage or fake auth.

## Bounded offline Agent computer

The startup command above selects the approved local computer configuration.
Use it only after the accepted runtime activation recorded in
[native acceptance](native-acceptance.md); a documentation command is not proof
that an already-running process loaded it. The normal server conditionally adds
`computer_execute` to its native Mastra tools. There is no browser, persistent
desktop, host-folder access or second agent runtime. All three `COMPUTER_*`
fields must be present together; omit all three to disable this tool.

The reviewed image is already cached in Colima. Its reproducible source is
`ops/offline-computer.Dockerfile`. To rebuild locally without fetching a missing
base, first require the pinned base to exist, then build with networking disabled:

```sh
DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" \
  docker image inspect node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 >/dev/null &&
DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" \
  docker build --pull=false --network=none -t otto-native-computer:20261010 \
  -f "$REPO/ops/offline-computer.Dockerfile" "$REPO/ops"
DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" \
  docker image inspect --format '{{.Id}}' otto-native-computer:20261010
```

Do not replace the configured immutable image ID with a tag or silently accept
a different rebuilt ID. A different platform/image needs confinement acceptance
before activation. Runtime provisioning only inspects the cached ID; it never
pulls an image. Missing cache or mismatched confinement fails closed.

Each authorized Run can perform one bounded JavaScript computation in its own
non-root container: no network or host mounts, read-only root, 64 MiB noexec
temporary space, 256 MiB memory, half a CPU and 64 PIDs. The action has a 20-second
deadline and a separate 60-second PID1 lifetime. Combined stdout/stderr is capped
at 16 KiB. No input credentials or server environment are forwarded. Results
are returned only after confirmed destruction; existing authorized File/Chat
tools can save the returned text, not a persistent container filesystem.

Keep the server's owner namespace `otto-v1-durable-compute` distinct from test
owners and other server instances. Startup reconciliation considers only exact
owner/type labels and verifies immutable identity and security settings before
removing stopped owned containers. Foreign name collisions are never adopted,
started or deleted. Uncertain provisioning/destruction withholds results and
retains an uncertain Run rather than permitting a successor. Do not manually
clear that state or run broad container cleanup to make startup pass. Inspect
the exact owned object and retained evidence before recovery.

## One-time storage provisioning

Provisioning is separate from routine startup. The following exact Otto/dev
root names were approved and created for this installation; existing records
must never be overwritten by rerunning setup:

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

The launcher never creates users, memberships or provider accounts. Ordinary
email/password signup and sign-in need no SMTP or mandatory email verification,
including for an existing unverified account. No flag or local bypass is used,
and no `emailVerified` value or password is rewritten. An unverified email is
not proof of ownership and confers no workspace membership.

The first workspace is claimed explicitly by the operator with
`bun scripts/bootstrap.ts <existing-user-id> <workspace-title>` against this
installation. That operation grants the selected identity owner membership and
creates the default Agent; it does not assert verified email ownership. Existing
workspace access instead requires an authorized invitation's private mailed
token and current recipient/issuer permissions, not an email match or ID alone.
That initial claim has already completed on this installation. Routine startup
never needs another signup, bootstrap, password reset or provider setup.

For an explicitly authorized initialization repair, the current workspace owner
can run `bun scripts/bootstrap.ts <existing-user-id> --workspace <existing-workspace-id>`
through the same database wrapper. This path never reclaims an installation or
changes membership. It ensures the Default Agent and its required unavailable
Environment metadata exist, preserving an existing Environment's identity,
generation, state and computer binding. It provisions no computer and admits no
Run. Only the explicit existing workspace is touched; nonowners are refused.

Password reset and invitation delivery are unavailable until approved SMTP is
configured: `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, and paired
`SMTP_USER`/`SMTP_PASSWORD` for authenticated submission. The launcher forwards
these without saving them. Use `tls` for implicit TLS or `starttls` for a required
upgrade, with normal certificate checks. `none` is restricted to loopback test
sinks. See [mail configuration](operations.md#smtp-mail). The temporary Mailpit
inbox and enrollment-verification helper were retired; neither is part of normal
local startup. No external mail or Garage provisioning is implied by login.

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

Routine owned dev-server restarts and HMR refreshes are authorized for this
local testing installation without another pause request. Check process ownership
and active execution first; preserve saved data, authentication, provider choices
and unrelated processes. Do not interrupt an external effect of uncertain outcome.
A non-disruptive check can read `/ready`, load the Sign in page in a separate
browser context, and inspect persisted membership/configuration without changing
it. Such reads are not a fresh restart or authenticated browser proof.
Keep prior controlled and durable-restart evidence labelled with its source and
time rather than replaying a live restart unnecessarily. Provider/model assistance
requires the confirmed endpoint and credential authority; never infer these from
an old provider row or overwrite the person's current choices during startup or
qualification.
