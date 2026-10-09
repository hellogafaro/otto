# Schedules rename — author validation

Current public backend uses `@otto/schedules`, `schedules`, `schedule_history`, `/schedules` and `scheduleId`/`scheduleEditToken`. Schedules remain reusable manual/cron execution settings, with optional human Task association. Input is the independently reviewed Resources working revision: manifest `c48b92a568fe94addc1626ab977b226c6c778e46462aec23cbf646db275d20c0`, preserved before this amendment. Schedule independent review is pending; Resources acceptance does not qualify this rename.

| Actual input / seam | Observed output | Rerunnable evidence |
| --- | --- | --- |
| Authenticated HTTP creates disabled script Schedule without AI account | Manual Run admitted; archive denies with 409; disabled restore leaves cron absent | `tests/schedules-transfer.test.ts` |
| Same private PG reconstructed with populated old table/scalar names; queued Run present | Offline rename refuses atomically; quiescent retry preserves IDs, tokens, history and bytes | `scripts/rename-schedules.sql`, `tests/schedules-transfer.test.ts` |
| Accepted Run JSON, populated private Session binding and retained scope, native schedules/jobs before/after explicit rename and repeated native push | Exact comparisons remain equal; old request ID returns original Run | `tests/schedules-transfer.test.ts` |
| Old pending native tick and reconciliation deliveries, then current workers/restart | Original delivery UUID consumed once; same UUID yields no additional Run/history | `tests/schedules-transfer.test.ts` |
| Edit/disable after admission, then dispatch/tick | Queued Run fails `configuration_changed`; old tick records `stale_configuration`; disabled manual remains available | `tests/schedules-transfer.test.ts`, `tests/runs.test.ts` |
| Real pg-boss minute clock for prompt/script; timezone/DST expressions; archive/disable while running | Both clock deliveries finish; accepted active work/output/control continues; queued work remains fenced | `tests/runtime.test.ts`, `tests/runs.test.ts` |
| Current inferred HTTP and trusted request identity | New `/schedules` works, old `/automations` is 404; public Schedule controls map to unchanged private retry keys | `tests/authorization.test.ts`, `tests/schedules-transfer.test.ts` |

Logs and exact input/output fingerprints: `/home/g4f4r0/.bb/thread-storage/thr_kfugrrgbs4/schedule-rename/`. Full Bun/Vitest: **298/298, 31 files, 310.27s**. Transfer check: **1/1**; Runs/authorization: **26/26**. Types, Biome, 17-package boundaries, consistency, web build, frozen install, local links and diff whitespace pass. Post-suite runtime-test formatting changes only import order/whitespace; `format-only.json` verifies unchanged import set and printed non-import syntax. No production behavior changed after the full run.

Native pg-boss names/payload `automationId` and private Run request-identity keys remain deliberately exact at the owning queue/admission boundary; new admissions use the same durable shape. Accepted JSON, Session/retained scope and native queue rows are not rewritten. See [Schedules](../schedules.md) for the operator-reviewed offline procedure. It was exercised only on disposable PostgreSQL; normal fresh development remains native schema push, never automatic transfer or destructive approval.

Controlled compute/model/storage peers qualify only their exercised behavior. The populated Session/scope preservation fixture does not establish provisioned compute or live Session portability. Live transfer, provider isolation, billing and Garage certification remain unverified. Resources/Pi/gateway/UI/setup/historical evidence and Timesheets tests remain byte-identical to input. Resources verdict is copied without edits in [resources-verdict.md](resources-verdict.md).

Failed intermediate transfer attempts remain in thread storage: an old-table fixture tried current HTTP Stop after scalar reconstruction, then used a record parser for Stop's control response. Fixture ordering/parser assertions were corrected; final transfer/full checks pass. No source was staged, committed or pushed; human work time is unknown.
