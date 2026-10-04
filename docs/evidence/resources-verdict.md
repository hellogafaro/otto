# Independent Resources review

Verdict: **PASS**, no required findings. Exact reviewed source manifest `c48b92a568fe94addc1626ab977b226c6c778e46462aec23cbf646db275d20c0`; archive `f806a926f5064b115ee0635de7e279bb0389c1fb1f3afc1896bb9fa9c231fd0f`. HEAD `084b76d23abb3a5880474af73cee991d090e0d68` plus approved 303-file Timesheets input manifest `477be18c2180f9fc2c962acda7d28129861517a1772249e8843ed42c17fd4641`. This is a separate configured Otto review of the immutable assignment; no WIP/main source reads or Schedules scope.

## Observed proof

| Real input / production path | Observed output | Evidence |
| --- | --- | --- |
| Verified safe full archive and actual input-relative delta | 307 regular files match; 45 changed, 9 added, 5 authorized replacements/deletions; index/HEAD preserved | overlay.json |
| Captured original 303-file source, original native push, original HTTP/auth/old domain saves in separate Bun process, then same private PG offline rename | Same saved rows/IDs/request JSON/key/SHA/size/bytes; Document/message/Task references work; populated Session/scope, Run/request JSON, old Skill/share JSON, queue jobs, Timesheet byte-equivalent | captured-input-transfer.test.ts, captured-input/populate-old.ts, captured-input-probe-complete.log |
| Native push on old populated schema; queued work or mixed columns at offline transfer; second transfer | Destructive push refuses unchanged; queued/mixed state atomically refuses unchanged; repeat transfer refuses; post-transfer native push preserves data/jobs | captured-input-proof.json |
| Original domain and authenticated HTTP upload retries; original message retry with resourceIds; changed upload identity | Original saved IDs returned, no extra put; changed upload conflicts | captured-input-proof.json |
| Old Skill/share JSON reads; ambiguous dual Skill identity; old routes and old request shapes | Only resourceId/resource/resourceType projections; ambiguous identity 409; old routes 404; old Skill/share inputs 400; stored old JSON unchanged before explicit edits | captured-input-probe-complete.log |
| Legacy published share preview/update/publish, then revoke | Old snapshot stays frozen until explicit human publication; current preview/publish succeeds, then retrieval 404 | captured-input-proof.json |
| Later workspace member reads transferred ordinary and source-Run files; current source revoked during storage.get | Ordinary file 200; old accepted source file 403; during-I/O private file 403, public file 404, accepted Skill read forbidden | captured-input-proof.json |
| Actual published Pi1.0.0 -> owned exact Go helper -> controlled Responses -> resource.create; accepted Skill files/private Session/controls | Full suite includes 10 native cases, advertised current tool and exact saved output/file; current authority/fences remain exercised | full-suite.log, gateway-fixture, go-version.txt |
| Share HTML browser sandbox | Inspected screenshot displays “Frozen resource” and only selected-file text; browser test checks script/cookie/network isolation | share-sandbox.png, full-suite.log |
| Approved Timesheets current permission, ownership, duration/date and archive/Done corrections | All 5 Timesheets cases pass; existing populated old Timesheet row survives transfer; test and handwritten domain/schema tails identical to approved input | full-suite.log, preservation-final.json |

## Checks

- **Verified:** frozen Bun install; Biome (159 files); TypeScript including web types; web build; 17-package acyclic business-operation/private-schema check; current naming/133-route consistency check; full Bun/Vitest suite **297/297, 30 files, 304.72s**; final independent actual-old-input probe **1/1, 5.38s**. Broad suite justified by package/schema/tool/attachment/share/runtime rename.
- **Verified:** own Go helper compiled from exact unchanged frozen `ops/gateway` using Go1.26.0, shared pinned module cache and own build cache/output. No native skip. Native component source is unchanged; helper builds are evidence for exercised fixture, not a gateway redesign review.
- **Failed then corrected (scratch harness only):** first three co-loaded old/new probe rounds failed with Drizzle column/module identity TypeError. Kept failing logs. Separate old-population Bun process with original schema/APIs fixes the harness; final complete probe green. These are not source findings. Vite warns about the scratch config module format; it executes successfully.
- **Unverified / outside scope:** live existing-installation transfer, live authorization/billing/provider isolation, Garage durability, UI product work, later Schedules amendment. PostgreSQL/storage/provider peers are disposable/private and controlled. Repeat push can churn composite FK DDL as documented; no no-op claim.

## Naming and preservation

`@otto/resources`, `resources`, Resource/createResource/getResource/getResources, resourceId/resourceIds, /resources, resource.create and Task/share resource discriminator are coherent through package/lock/schema/domain/tool/HTTP call chains. Normalized moved domain/storage/schema/package source matches old implementation except the requested Resource type export. Lock diff is workspace rename only; no external dependency change.

Explicit exceptions: accepted private Skill references retain artifactId; accepted Skill identity retains documentId; stored share artifact/artifactType project only in owning server composition; offline SQL necessarily names old table/columns/discriminator; negative tests/consistency inventory retain retired names; Agent Skills assets directory and Connection/MCP generic resources remain native. Historical documents/manifests/verdicts stay immutable. Inventory: naming-inventory.txt. No public old domain alias, duplicate model or dead compatibility transport found.

All307 final source hashes and5 deletions rechecked after execution. All112 protected source hashes compared directly with input and frozen source; approved Timesheets test and domain/schema tails exact. Original 303-file checkpoint archived separately in original-input.tar.gz; earlier input checkpoint untouched. No reviewer production edits, staging, commit, push, shared database access, credentials or UI lane writes. Tests/owned child servers/private PG/native processes joined and commands completed; evidence/build/scratch files retained in reviewer thread storage. Installation/type/build generated only ignored checkout artifacts; worktree retirement/integration belongs to root. Human work time unknown.

Standalone copyable verdict: [verdict.txt](verdict.txt). Exact evidence hashes: [evidence-sha256.json](evidence-sha256.json). Author source/evidence checksums verified at intake; own verdict uses independently observed checks.
