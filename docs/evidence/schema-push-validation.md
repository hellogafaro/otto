# Populated Environment schema push validation

Independent verdict: [PASS](schema-push-verdict.txt), from fresh Otto thread `thr_jym967prr9`. Integrated source is byte-identical to the reviewed two-file delta against `241e425472fc26f713f96d5fb1ac3c88bd71f603`. No commit or remote update is part of this integration.

| Source | Baseline SHA-256 | Reviewed SHA-256 |
| --- | --- | --- |
| `packages/environments/src/schema.ts` | `3c082b9836175bf44c1b1b53553b9d7e7005783233574382466aeb642fce909c` | `a3a4f99fc8283ab45dad5490c13714828afa2d79ab54cb508334280225c8de5e` |
| `tests/environment-binding.test.ts` | `5b8d89c7432158455ac70be03707cb36e2cb0fd9bd493134a1f4e254fc185484` | `110b22bf1f58c4af36eee3638edbaba96c0d01d3985ddd4033a9c669d5cdc08f` |

Patch SHA-256: `b61eea6749a984f9c6bef9f94282c6441586ff0d2b3f8440ae4bb756fe545ecd`. Reviewed archive SHA-256: `4760bcf5ef93dc3c1682c093f07f6935049b8896038fa7b25276c0351ff8d8b6`.

The named native UNIQUE pair now declares `computerRef, provider`, matching pinned Kit introspection. Its global scope, NULL-distinct semantics and database enforcement remain intact. Wrapper, dependencies and queue ownership are unchanged.

## Observed behavior

Author and reviewer independently created private databases using the exact baseline declaration and actual `scripts/push.ts`, then created three Agents/Environments through authenticated HTTP across two workspaces. One retained a bound uncertain lease and execution scope; two remained unbound; pg-boss held a future job. Baseline repeat push failed with exit 1. Raw Kit caught its non-TTY truncation prompt error and returned zero without applying changes; the unchanged wrapper rejected that incomplete result.

Changing only the declaration in each same populated database made two wrapper pushes and a verbose native push succeed without prompt, truncation or binding-constraint DDL. The original physical `UNIQUE (provider, "computerRef")`, constraint OID 17009 and index OID 17008 survived. Snapshots preserved 46 tables, 518 constraint definitions, 101 index definitions and 40 queue relation identities. Duplicate pairs across workspaces still produced HTTP 409 and SQL 23505; multiple NULL pairs remained valid. Native `queue.version` heartbeat timestamps may advance; its schema version and every other table's complete row hashes were compared.

| Attribution | Verified checks |
| --- | --- |
| Author `thr_7639m47pcu` | 9/9 affected binding/schema tests; 1/1 same-baseline-database transition probe; both new regressions fail with original schema |
| Independent reviewer `thr_jym967prr9` | 9/9 affected tests; 1/1 independently executed same-database probe with extra physical identity/type/NULL checks; both new regressions fail with original schema |
| Both | Formatting, strict types, boundaries, consistency and build pass; private fixtures stopped |
| Main integration | Input/output hashes, exact patch paths, byte-exact verdict, proof links and diff whitespace checked; identical reviewed source did not trigger redundant runtime reruns |

Pinned qualification: Bun 1.4.2, Vitest 5.0.3, PostgreSQL 18.4, Drizzle Kit 0.31.11, Drizzle ORM 0.45.3 and pg-boss 12.35.1. No current candidate check failed. The full runtime suite was not rerun for this affected change.

## Evidence and scope

[Author handoff](/home/g4f4r0/.bb/thread-storage/thr_7639m47pcu/handoff.md) and [author evidence hashes](/home/g4f4r0/.bb/thread-storage/thr_7639m47pcu/evidence-hashes.json) retain the reproduction, transition and logs. [Independent review](/home/g4f4r0/.bb/thread-storage/thr_jym967prr9/review.md) and [review evidence hashes](/home/g4f4r0/.bb/thread-storage/thr_jym967prr9/evidence-hashes.json) retain independently executed proof. Review report SHA-256: `34c6b819191317113e5c622ab3ad52065f916e9464e4febd67dc55add72d7931`; copied verdict SHA-256: `dbf5c14999fbdc6c45b2f135366b432ffb41382c650b66db5a6ab2d0676bdd2f`.

Repeat native push still drops/re-adds 30 composite FKs and `workspace_members_workspaceId_userId_pk` with equal definitions. Acceptance means semantic stability, not a no-op or preservation of every constraint OID. The unordered upstream introspection query remains; dependency changes require rerunning these regressions.

Live Garage/mail/external qualification remains blocked pending the user's scope decision and is outside this verdict. Unexecuted service preparation scripts were not integrated. Controlled computer fixtures do not qualify provider isolation, native login or billing. Historical evidence and verdicts remain unchanged.
