# Operations qualification

Goal: exercise server lifecycle, human authentication delivery, bounded private storage I/O, and workspace membership rules through production boundaries.

The final lane run on 2 October 2026 passed **63 tests in 9 suites** with Vitest 5.0.3 explicitly under Bun 1.4.2. This includes the original 47 regressions and 16 new checks. The [tested-source manifest](operations-source.json) records 85 SHA-256 fingerprints and the 18 unstaged integration dependencies. Tests use real PostgreSQL 18.4 in a private 0700 Unix-socket directory with TCP disabled. To compose this isolated baseline lane, the test checkout contains an unstaged copy of main's queue module and caller-only naming updates; this evidence does not certify the eventual merged execution runtime or member/invitation route composition.

| Command | Observed result |
| --- | --- |
| `bun install --frozen-lockfile` after checking root package name `otto` | Exit 0; lockfile unchanged |
| `bun run check` | Exit 0; 89 files checked; no fixes or warnings |
| `bun run typecheck` | Exit 0, root and generated web type checks |
| `bun run check:boundaries` | Exit 0; 14 packages, no domain cycles/private-schema imports |
| `bun run test` | Exit 0; 63/63 tests, 9/9 suites |
| `bun run build` | Exit 0; generated web built, no product UI edits |
| `bash -n ops/run.sh` | Exit 0 |
| `Bun.YAML.parse` on `ops/compose.yaml`; `Bun.TOML.parse` on `ops/garage.toml` | Both parsed successfully |
| Official Garage Linux binary `--version` | `garage v2.4.1` |

The actual server executable was spawned against the private database and installed queue. HTTP readiness returned 200, unauthenticated API access returned 401, and SIGTERM/SIGINT each exited 0; a new process then became ready. Renaming the queue version table caused readiness to return 503 and restoring it recovered readiness. Occupying the requested HTTP port caused startup failure without stopping the existing listener. Repeated stop calls shared cleanup. Introducing a legacy `otto_jobs` schema caused both migration and startup to fail while its pending marker row remained intact. Invalid origin configuration reported the field name without the signing fixture.

Better Auth verification/reset ran through a real Bun HTTP listener, PostgreSQL, the production mail adapter, and a disposable loopback HTTP delivery sink. Signup delivered verification; unverified login returned 403; verification enabled login. Password reset delivered, changed the password, revoked the earlier session, and rejected token replay. The sender suppressed a simulated provider error body. No external mail was sent and no production account was used.

The S3 HTTP fixture deliberately ignores conditional headers and overwrites PUT keys. Digest-key writes read back correctly; a lost acknowledgement reconciled without another PUT. Different valid bytes targeting a saved digest key were rejected before writing. Corrupt stored bytes with plausible metadata failed hash validation. Existing legacy keys remained readable/retryable; missing legacy keys failed without PUT. Oversized objects and invalid upload hashes failed. A 403 did not trigger account substitution. These checks prove the adapter protocol behavior, not Garage durability or provider access control.

Running the earlier regression set against the baseline storage adapter produced 3 failures out of 5; the fixed adapter passed all 5. A subsequent independent changed-byte-before-PUT check also passed, bringing the storage suite to 6. The baseline trusted metadata on immutable retries, accepted a mismatched upload digest, and wrote absent legacy keys without a digest constraint.

Workspace tests exercised the actual domain operations and real database. The member directory returned only current workspace IDs/names/roles, excluding auth data and nonmembers. Agent callers were denied. Owner demotion, admin self-demotion, unauthorized admin promotion, and contributor role changes were denied. An owner could promote a member. Invitation delivery lookup rechecked current administrative authority.

Garage source qualification used the official [release index](https://garagehq.deuxfleurs.fr/_releases.html), pinned [PutObject handler](https://git.deuxfleurs.fr/Deuxfleurs/garage/src/tag/v2.4.1/src/api/s3/put.rs), and [API dispatch](https://git.deuxfleurs.fr/Deuxfleurs/garage/src/tag/v2.4.1/src/api/s3/api_server.rs). The handler does not inspect `If-None-Match`; Otto's digest-bound intent keys and read-back checks therefore supply the application invariant. The downloaded binary SHA-256 was `ae49f8de4aaee6b5ca305f7cbdccc8cd8a29b2804aac074649f18bfb83d0a2b6`; this records the observed download, not an independent publisher-signature verification.
