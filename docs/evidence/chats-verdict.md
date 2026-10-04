# Independent Chats-rename review: consolidated final report (reviewer thr_y3i6ab88xr)

FINAL VERDICT: PASS on corrected freeze2 (manifest fe595ef704408f97f4a958420a7ed0a88406e371d49484017f02d61b50585cc9,
archive 4c5d2248c25c97ff845fcac3fb61fa34bff736683d6edc2cd11f0e5605b1b3c7, patch 57626c309d2cc74b333b01e3a9f80ac51642a79f0510eb15f4fd18871c538db2).
The first freeze (manifest f3e35821a937f8d7258590358cea535ddbb16e98fd64158d7a161e3eb3f9d55d, archive 7f747e539d7709fa7bed38de8189f0f9e953977f96381951fe6d25e6af77aa97)
was REQUIRED CHANGES (finding F1); that report stays immutable in review-freeze/.

## Input and scope
- Prepared input: 324 files, manifest 179ce60bd35f9bc4015d31a7925423acab3f129411c2d3b900b040eebe6b584f, archive 492467502757c7d79e8eaac31e441e77a24c49e0b76511ec3706999277ebf4fd, HEAD 084b76d.
- freeze2: 328 safe regular unique members, all hashes verified; delta vs the failed freeze is exactly 5 paths: packages/runs/src/runtime.ts, tests/chats-transfer.test.ts, TESTING.md, docs/chats.md, docs/evidence/chats-validation.md.
- Chats only; no Channels concept, no UI edits. Index unchanged, nothing staged or committed.

## F1 (resolved)
Failed freeze: runtime.ts executionScope() serialized "chatId" while persisted environments.executionScope held "conversationId", so after rename-chats.sql bindExecutionScope's exact
comparison refused every new Run on a populated Environment (admission_configuration_unavailable). The author's transfer test used a synthetic scope, so it missed this.
Correction: one property, `conversationId: run.chatId`, at its original position; saved scopes are not rewritten and the bind check is not relaxed.

## Real-scope proof on freeze2 (same database, three processes, no stored workaround)
Old input code (own process): real prompt Run (Agent 1) and real script Run (Agent 2), stable audience -> rename-chats.sql -> corrected code (own process).
- Both original executionScope byte strings unchanged in the DB; a new prompt Run and a new script Run finish on the same Environments; scopes unchanged afterwards. 27/27 probe checks.
- A Run with a changed source set and a Run on a different Chat are still refused (admission_configuration_unavailable); scope bytes unchanged after the refusals.
- Downstream paths previously tested only with a workaround now pass on the real fix: legacy frozen-share update/publish/revoke (public read stays chat, stored bytes become chat only after the explicit update),
  Schedule manual Run + history, archive blocks new Runs while saved reads and the old retry continue, Agent-viewer cap, creator title edit, monotonic read, Task capture, retired link type rejected.
- Mutation: restoring `chatId: run.chatId` in a scratch copy makes chats-transfer.test.ts fail on the conversationId key assertion.
- Rename SQL: 6 adversarial refusals (queued Run, leased Environment, existing chats table, extra conversationId column, mixed Task-link type, un-renamed Schedules) + repeat refusal, each leaving all tables unchanged;
  38 public tables equal modulo the renames; 436 constraints valid; orphan Message insert rejected; no conversation-named object remains.
- Schema DEFINITIONS (not names only): columns (361), constraint definitions with FK targets and column order (436), indexes (82) identical to a fresh native push, before and after a repeat push. Repeat push reports changed:true and emits FK/PK
  drop-add churn only, same as a fresh-database control; no table/column drops. Native queue rows unchanged.

## Check attribution (kept separate)
- Earlier broad run on the FAILED freeze f3e35821: biome, tsc+web, boundaries 17 packages, consistency 79 files, git diff --check; full Vitest 36 files / 344 tests, no skips, with the actual published Pi and my own Go 1.26.0 helper
  (official archive sha256 aac1b08a0fb0c4e0a7c1555beb7b59180b05dfc5a3d62e40e9de90cd42f88235, matches go.dev); go test ./..., go vet, go mod verify, CGO_ENABLED=0 go build. These carry to freeze2 ONLY through unchanged hashes; they were not rerun.
- Fresh on freeze2: biome, tsc+web, boundaries, consistency, git diff --check pass; focused Vitest 8 files / 81 tests pass, no skips (chats/schedules/resources/skills transfer, runtime, runs, execution-authority, authorization).
- Protected: Pi bridge, Go gateway, UI, historical evidence and 33 other fingerprinted files byte-identical to input.
- Not run: Playwright, Go race, load, any live OAuth/Infisical/provider/Garage/compute proof. No claim of native isolation, billing or storage certification.

## Cleanup and limits
Probe PostgreSQL and processes stopped; my temporary directories removed; 12 unattributed /tmp/otto-pg-* directories (not mine) left alone. Build artifact removed from ops/gateway. Main and UI untouched. Human time unknown.
Scratch probe state files contain destroyed fixture credentials: restricted scratch only (mode 600), never part of this report or the repository. An earlier handoff line calling a scratch state file non-sensitive is retracted.
Minor non-blocking: docs/otto/references.md and docs/creator-skills.md retain historical Conversation/Automation/Artifact wording consistent with prior renames.

## Evidence (all under /home/g4f4r0/.bb/thread-storage/thr_y3i6ab88xr/)
- f1-review/ (index f1-review.sha256, immutable); review-freeze/ (failed-review bundle, index review-freeze.sha256, immutable); this report in final-report/ (index SHA256INDEX-FINAL.txt).
- Rerun path: review-freeze/RERUN.md with probe sources (harness.ts, seed.test.ts, verify.test.ts, orch.ts, zz-stage2.ts, zz-stage3.ts) and f1-review/zz-verify3b.test.ts (downstream, no workaround).
