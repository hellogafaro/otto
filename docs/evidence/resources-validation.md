# Resources rename — author validation

3 October 2026; input is pushed `084b76d23abb3a5880474af73cee991d090e0d68` plus the independently accepted Timesheets overlay/verdict (303 preserved files). This new change awaits its own independent review. Historical verdicts retain their original scopes.

| Input and production seam | Observed output |
| --- | --- |
| Existing populated private PostgreSQL with old file table/attachment columns, Task links, Skill refs, frozen share and a queued Run; execute explicit offline rename | Active work refuses atomically. After authorized queued Stop, table/constraints/indexes/columns rename in place; accepted Run/request, Session, retained scope, Skill/share JSON and queue bytes remain exact; populated Timesheet row remains exact |
| Original upload retry after rename, then changed retry | Same ID/object key/request/hash/bytes, one controlled storage put; changed identity conflicts |
| New HTTP resource/file, Document/message attachments, Task link, Skill export and accepted file read | New Resource vocabulary and same immutable bytes; no old public fields; old `/artifacts` and `/assets` routes404, old share/files payloads400, ambiguous supporting identity409 |
| Old frozen selected share read/file, then explicit revoke | Public Resource projection with exact stored snapshot bytes; byte delivery succeeds before revoke, then404 |
| Repeat native schema push on transferred private DB | Preserves populated evidence and queue; composite-FK DDL churn from pinned Drizzle remains possible, not a no-op claim |
| Published Pi1.0.0 → Otto HTTP/PG/queue → exact frozen Go gateway → controlled Responses peer | Actual `resource.create` schema advertised, Agent-authored scoped output saved with source Run, file bytes delivered; accepted Skill materialization/private Session/control cases pass (10/10 targeted) |
| Full stable-source Bun/Vitest suite | 297/297 across30 files,302.55s, including Timesheets, effective audience/revocation/pre-post I/O and schema constraints |
| Static/delivery checks | Biome161 files, strict TS/web types,17-package boundaries,78-backend-file/133-route consistency, build, frozen install, local guidance links and diff whitespace pass |

[The Resources storage boundary](../resources.md) and [offline procedure](../../scripts/rename-resources.sql) describe private legacy projection and operator-reviewed populated transfer. `tests/resources-transfer.test.ts` exercises same-database preservation/refusal/retry/references/publication; `tests/pi-gateway-runtime.test.ts` exercises the actual published Pi and frozen Go with controlled model/computer/storage peers. The existing share sandbox browser observation is retained in author thread storage rather than overwriting historical evidence.

All112 protected UI/setup/historical-evidence/Pi/gateway files, the Timesheets test and the Timesheets implementation/schema tails are byte-identical to the input. No actual/shared DB transfer, live provider/Garage/billing/isolation or UI integration is qualified. Earlier intermediate failures were test setup/shape mistakes (duplicate Environment, replay-array shape, export metadata), corrected before the final run; they are preserved in author evidence, not claimed as passing checks. Human work time is unknown. No staging/commit/push.
