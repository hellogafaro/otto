# Computer isolation: one machine per bot vs per thread

Research and proposal only. No application code was changed for this note.

Johan’s question: a bot often works in several chats at once (building, testing, and so on) and those chats share one machine, so they collide on files, processes, ports, dev servers, and git. The ideal he has in mind is one computer per thread. This note studies how computers actually work today, then asks whether per-thread is the right default.

**Recommendation:** do not replace the standing “one computer per bot” identity with “one computer per thread.” Keep the bot’s durable home computer. Isolate the thing that actually collides: two *working turns* of the same bot on the same OS. Git working trees are already per chat. Processes, ports, and the desktop are not.

---

## 1. How it works today

In this codebase a **thread** is an Otto chat. A **turn** is one bout of work in that chat. A **computer** is a Mastra workspace: a local directory or a remote VM, plus a shell.

There is no provider type named `box`. The historical Ascii Box provider is **Boat** (`"ascii"` in saved settings still decodes to `"boat"`). The other remotes are E2B, Daytona, Vercel Sandbox, and Railway. Local needs no credential.

### Mapping

```
Bot (roster.sandbox, or Settings default)
  └── one Computer  (pool key + otto-<hash> identity)
        └── many Threads / chats  (session lease on the same workspace)
              └── Turns  (chat folder, worktrees, GitHub login, keepAlive / idle)
```

A thread without a bot is the exception: it already gets its own computer, keyed `thread-<threadId>`.

Delegation does not invent a third model. A child chat uses the *target* bot’s computer. Two delegations to the same worker bot share that worker’s machine. `sandbox: null` on a grant means no computer (`workspaceType: "none"`).

Routines store their own `sandbox` field. Session start still uses the responding bot’s sandbox (`apps/server/src/orchestration/layers/provider-command/session.ts`).

Otto Memory (Yours / Team) is not on the computer. It lives in the app and is injected as chat context.

### Keying

All of this is in `apps/server/src/provider/bot-workspace-pool.ts`.

| Piece | Function | Production value |
| --- | --- | --- |
| Resource scope | `botRuntimeResourceScope` | **bot id**, or `thread-<id>` if there is no bot |
| Legacy scope | `legacyBotResourceScope` | `bot-<id>` (older identity files; carried over so a rename does not wipe a VM) |
| Pool key | `botWorkspaceResourceKey` | Local: `local:no-workspace:<botId>`. Remote: `<provider>:<credentialFingerprint>:<botId>` |
| Durable id | `botWorkspaceIdentity` | `otto-` + first 24 hex of SHA-256(key). Railway strips the credential segment so rotating a token does not mint a second VM |

The live session path never puts a project `cwd` into the local key (`session-lifecycle.ts`, `provider-command/session.ts`). Comments about cwd-keyed local leases are leftover.

Computers are **not** keyed by person. The asker only affects that turn’s GitHub login.

Identity is a JSON file, not a SQLite table: `{stateDir}/bot-workspaces/{workspaceId}.json`. Local files live in the sibling folder `{workspaceId}/`.

### Lifecycle

`BotWorkspacePool` is a refcounted lease (`RcMap`). Concurrent chats of the same bot share one `OttoBotWorkspace` object.

1. **Create.** Session start → `OttoSessionResources.acquire` → pool `acquire(key, create)` → `createBotWorkspace`. Local writes the identity and makes `LocalSandbox` under `{stateDir}/bot-workspaces/{id}/`, with Mastra isolation (`sandbox-exec` / `bubblewrap`) when the host has it. Remote reconnects from `providerId` or creates (Boat uses an idempotency key and a 5 minute TTL).
2. **Reuse.** Same key, same object. A later chat of a warm bot does not provision again.
3. **Sleep.** After the last lease, wait **5 minutes** (`session-resources.ts`: group chats switch bots every message; stop/wake per message is too expensive), then `workspace.sleep()`. E2B pauses, Vercel snapshots, Daytona stops, Railway is a no-op, Boat snapshots and archives. Local `stop()`s; a failed local sleep destroys the Mastra object but leaves the disk for sweep. Boat keep-alive every **2 minutes** while a turn works; after a turn, idle TTL is **2 minutes** unless another chat of that bot is still working (`idleComputer`).
4. **Destroy.** The pool never deletes. `sweepComputers` (startup + every 10 minutes) deletes `bot_deleted`, `sandbox_changed`, `replaced` (newer remote for the same bot+provider), and unscoped remotes left **7 days**.

A turn waiting on a person lets the computer stop. The answer wakes it. Running processes, including dev servers, do not survive a Boat stop. That is already documented in `docs/user/sandboxes.md`.

### Per-chat isolation that already exists

`createBotComputerSetup` (`bot-computer-setup.ts`) runs at the start of a human-asked turn:

- Working directory: `chats/<chat id>/`, exported as `OTTO_CHAT_DIR`. The shell wrapper `withCommandEnvironment` (`otto-workspace-tools.ts`) sends relative paths there.
- Git: shared clones in `repos/<owner>/<repo>`; each chat gets a **detached worktree** under its folder, same relative path. Two chats do not edit the same files or branch, if they stay in the chat folder.
- GitHub: `.otto/github/<sha16(threadId)>/` plus `GIT_CONFIG_GLOBAL` / `GH_CONFIG_DIR`. Token is an App user token, ≤8 hours, deleted at turn end.
- Toolbox: `gh` in `.otto/bin`, and on remotes `apt` for git plus desktop tools, once per computer (`.otto/setup` marker).
- Setup/cleanup for one chat is queued so a finished turn’s logout cannot land after the next turn’s login.

The prompt tells the truth and then asks the model to behave (`otto-agent-instructions.ts`):

> Your other chats share this computer. … Work, clone and branch only there. … Run heavy builds and tests one at a time.

That last sentence is policy, not a runtime lock.

### Watch computer

Boat only. The button is “Watch *bot*’s computer.” One desktop per VM. The owner can open it any time; others only while the bot is working in that chat. Local has no desktop. E2B / Daytona / Vercel / Railway have no Otto desktop stream.

### Provider differences that matter for this decision

| | Sleep | Start cost | Standing per-thread computer |
| --- | --- | --- | --- |
| **Local** | stop | cheap directory | Viable on disk; host ports still collide unless a network namespace exists |
| **Boat** | snapshot + archive; limited account starts | resume is cheaper than create; create is scarce | Tempting for the desktop; expensive as a standing identity |
| **E2B / Daytona / Vercel** | pause / stop / snapshot | medium | Possible, multiplies idle sandboxes |
| **Railway** | **none** — VM keeps running and billing | high | A standing VM per chat is a billing incident |

---

## 2. Where chats collide today

Same bot ⇒ same pool key ⇒ one OS user on one machine. Concurrent *working* turns of that bot share:

| State | Isolated today? | What goes wrong |
| --- | --- | --- |
| Chat working tree / git branch | Yes, if the agent stays in `$OTTO_CHAT_DIR` | Agent ignores the folder, edits `repos/`, `/tmp`, or another chat’s tree |
| Processes, ports, dev servers | No | Two chats bind `:3000`; one kills the other’s PID; leftover servers survive the turn |
| Browser / Boat desktop | No | One screen, one profile; Watch shows whichever chat last grabbed the display |
| GitHub login folder | Folder is per chat; **same Unix user** | Documented hole: the other chat can read the login (`bot-computer-setup.ts`) |
| Toolbox / apt / npm globals / caches | Shared on purpose | First-turn setup races; usually a feature |
| `/tmp`, home, anything outside `chats/` | No | Screenshots, recordings, lock files, sockets |
| Process leftovers after a turn | No tree kill | Next chat inherits stray processes |

What does **not** collide, and should not be “fixed” by another VM:

- Otto Memory, Library, chat history, skills, MCP managers (already per thread).
- Git working trees, when the agent obeys the chat folder.
- Sequential chats of the same bot. Most work is one turn at a time. The 5 minute idle TTL exists so the machine stays warm.

Two more collisions a standing per-thread computer does **not** fix:

1. **Inside one chat.** A thread admits one turn at a time, but a turn can run several shell calls. Build and test in the same chat still share cwd, ports, and processes.
2. **Delegation to the same worker.** Two child chats of worker bot W share W’s computer, same as two ordinary chats of W.

---

## 3. Alternatives

Scored for this codebase, not in the abstract. Isolation here means processes, ports, and writable workspace of a *working* turn. Persistence means logins, installed tools, shared clones, the desktop a person already signed into.

### A. Standing computer per thread (Johan’s ideal, taken literally)

Change `botRuntimeResourceScope` so a bot’s chats no longer collapse to `botId`. Each chat gets its own identity, pool entry, disk, and VM.

- Isolation: complete across chats.
- Persistence: each chat keeps *its* disk across its own turns, and loses the bot-wide home. `gh`, apt, browser logins, and shared clones are paid again per chat.
- Latency: first turn of every chat pays create/wake. Group-chat bot switching would stop/wake a machine per message unless the 5 minute TTL is kept *and* multiplied by every chat that recently spoke.
- Cost: Railway becomes N always-on VMs. Boat spends limited starts on chats that may never overlap. Idle sweep has to learn “this chat is quiet” vs “this bot is gone.”
- Product: Settings, Watch, and the prompt all say “the bot’s computer.” DESIGN.md: every bot always gets its own computer (files and browser logins). That promise is the point of the current key.
- Complexity: the keying change is small. Sweep, Watch, Boat dashboard names, toolbox, and migration of existing `otto-<hash>` homes are not.

This solves the shared-machine problem by throwing away the shared home. Most days the extra machines would sit idle.

### B. Worktrees / chat folders on one computer (today)

Already shipped. Solves git and relative files. Does not solve ports, processes, or the desktop. Cheap. Keep it.

### C. Per-thread containers or namespaces inside one box

One VM per bot; each working chat gets a mount + network + PID namespace (or a second `LocalSandbox` with isolation).

- Isolation: good for processes and ports, if the provider can do it.
- Persistence: shared home is natural (bind `repos/` and `.otto/`).
- Cost / latency: one VM.
- Complexity: **provider-divergent**. Local already has Mastra `LocalSandbox` isolation at *bot* scope; nesting it per chat is plausible on Linux bubblewrap and weaker on macOS `sandbox-exec` (no network namespace). Boat, E2B, Daytona, Vercel, and Railway do not expose a supported “nested container” API in this repo. Building one inside the VM is a second product.

Worth doing on **Local**. Do not bet the remote design on it.

### D. Pool of computers leased to threads

Warm VMs, assign to a turn, return to the pool.

- Isolation: complete while leased.
- Persistence: gone unless the disk is the bot’s and the VM is not.
- Cost: bounded by pool size, not by chat count.
- Complexity: a new scheduler on top of today’s identity files. Boat’s limited starts and Railway’s no-pause make a generic pool a poor fit.

A *narrow* version of this is useful: overflow VMs only while two turns overlap. That is option F, not a standing pool.

### E. Serialize computer-heavy work per bot

One working turn per computer. Other chats wait, or only their non-shell work proceeds.

- Isolation: complete, by not overlapping.
- Persistence / cost / latency: unchanged.
- Complexity: a lock next to `idleComputer` / `workingThreadIds`.
- Product: two people talking to the same bot in two chats would take turns on the machine.

Best cheap control if overlap is rare. Measure before making it the only tool.

### F. Hybrid: durable home per bot + isolated compute for overlapping turns (recommended)

Keep today’s identity. When a second working turn of the same bot starts, give that turn isolated compute. When it is the only turn, it uses the warm home.

What “isolated compute” means depends on the provider (see §5). The product stays “the bot’s computer.” The runtime stops lying that chat folders are enough for ports and processes.

---

## 4. Recommendation

**Keep one durable computer per bot. Do not mint a standing computer per thread. Isolate overlapping working turns.**

Reasons, in order:

1. **The product is a bot with a machine**, not a chat with a machine. Files, toolbox, and Boat logins are supposed to survive across that bot’s chats. DESIGN.md and `docs/user/sandboxes.md` are explicit. Per-thread as a standing identity reverses that.
2. **Git is already isolated.** The remaining pain is processes, ports, leftover servers, and one desktop. Those are occupancy problems, not identity problems.
3. **Overlap is the rare path.** Sequential reuse is why the pool, the 5 minute idle TTL, and Boat keep-alive exist. Paying create/wake per chat taxes the common path to fix the uncommon one.
4. **Railway cannot pause.** A standing VM per chat is unbounded billing. Any per-thread remote must be destroyed after the turn, or never created on Railway.
5. **Boat starts are scarce.** The idle TTL is 2 minutes specifically so a quick reply does not spend a start. N standing VMs spend starts on chats that are not even running.
6. **Per-thread does not fix build-and-test in one chat**, nor two delegations to the same worker, unless isolation is per *working turn* (or per parallel shell), not per chat id.

What to tell the product: the bot still has one computer. If it is already working in another chat, the second chat does not share that OS. Watch still opens the bot’s desktop when only one chat is on the home machine; a concurrent chat on Boat either gets its own overflow desktop or a clear “this chat is on a spare machine” state. Do not silently point two Watch buttons at one screen.

---

## 5. Concrete proposal

### Data model and keying

Do **not** change `botRuntimeResourceScope` for the home computer. Keep:

- Home identity: today’s `botWorkspaceIdentity(botWorkspaceResourceKey({ resourceScope: botId, … }))`
- Identity file: `{stateDir}/bot-workspaces/{homeId}.json` with `scope: botId`
- Home pool key: unchanged

Add a second, optional record for overflow compute:

```
scope:          botId
kind:           "home" | "overflow"
threadId:       set only on overflow
homeId:         overflow points at the bot’s home
workspaceId:    otto-<hash>  (overflow hash includes threadId)
providerId:     remote VM id, if any
usedAt, orphanedAt
```

`kind` can start as a field on the existing `BotWorkspaceRecord` (`bot-workspace-lifecycle.ts`) so sweep can delete overflow independently of the home. No SQLite computer table is required. Roster `bot.sandbox` stays the bot’s provider.

Session acquire becomes:

1. Compute home key as today.
2. Look at `workingThreadIds()` (already in `agent-controller.ts`).
3. If no other working turn holds this home, lease the home.
4. If another working turn holds it, lease overflow keyed `home + threadId` (Local always; Boat / E2B / Daytona / Vercel when the provider can create; Railway either in-home isolation or a VM that sweep destroys when the turn ends — never an always-on sibling).

`idleComputer` already knows “another chat still works on this workspace.” Overflow just makes that workspace *not* the home.

### Lifecycle

| Event | Home | Overflow |
| --- | --- | --- |
| First turn of a bot | Create / wake home | — |
| Second overlapping turn | Stay up | Create / wake overflow for that thread |
| Turn ends, sibling still working | Stay up (`idleComputer` already does this) | Idle → sleep, then destroy or 7-day orphan |
| Last turn ends | 5 minute pool TTL, then provider sleep | Destroy after idle (do not keep a standing per-chat VM) |
| Bot deleted or sandbox changed | Sweep deletes home (today) | Sweep deletes overflow for that bot |
| Person answers a waiting turn | Wake the lease that chat holds | Same |

Process leftovers: every turn gets a process group (or a recorded pid set). Turn end kills the group. That is independent of how many VMs exist and is the only fix for intra-chat parallel shells.

### Shared state across threads

Keep on the **home** (and, on Local, bind or copy into overflow as needed):

- `repos/` clones (read + worktree-add; do not check out the shared tree)
- `.otto/bin`, `.otto/setup`
- Boat browser profile, when the chat is on the home VM
- apt / image contents of the home VM

Keep **per working turn**, even on the home:

- `chats/<id>/` and its worktrees (already)
- GitHub login folder with a real permission boundary (fix the same-user read hole)
- Process group, port base (`OTTO_PORT` / a small allocator), `TMPDIR` under the chat folder
- MCP manager (already per thread)

Never share across bots. That rule does not change.

### Local sandbox

Local is the right place to go furthest, because a directory is cheap and Mastra isolation already exists.

- Keep one bot root: `{stateDir}/bot-workspaces/{homeId}/`
- Default path: today’s single `LocalSandbox` on that root, plus Phase 1 jail / process group / ports
- Overlap path: a second `LocalSandbox` whose `workingDirectory` is `chats/<threadId>/`, isolation backend on, `repos/` and `.otto/bin` visible read-only or via bind
- Host ports: bubblewrap can take a network namespace; `sandbox-exec` on macOS cannot. On macOS, port allocation is the honest ceiling; say so in the computer prompt
- Watch: still none

`createBotWorkspace` (`bot-workspace.ts`) is the seam. Isolation profiles already live outside the bot-writable tree (`sandbox-profiles/`).

### Boat (the box provider)

Do not give every chat a standing VM.

- Sequential chats: today’s one VM, named by bot id, snapshot on stop, 2 / 5 minute TTLs
- Overlap: create a sibling with `idempotencyKey` and `ttlSeconds: 300`, name it `{botId} {shortThread}`, identity `kind: overflow`
- Seed: empty + existing clone/worktree script, or a snapshot of home if Boat can fork one (confirm before building a copy pipeline). Empty + clone is enough for v1
- Destroy overflow on idle sweep, not at process exit (Boat archival can take up to 5 minutes)
- Watch: home desktop if the chat is on home; overflow desktop if it is on the sibling; never two chats on one screen without saying so
- `keepAlive` / `idle` stay on the lease the turn actually holds (`otto-session-resources.ts`)

E2B / Daytona / Vercel follow the same overflow pattern (pause/snapshot is cheaper than Boat create). Railway overflow must be destroyed when the turn ends, or skipped in favor of in-home process/port isolation.

### Migration

Existing homes stay. `carriedOverWorkspaceId` already maps `bot-<id>` → `botId`. Do not rewrite those hashes.

1. Ship Phase 1 (jail, process group, ports, login hole) on the current key. No migration.
2. Add `kind` to new identity writes; old files default to `home`.
3. Overflow identities are new files. Sweep treats unknown `kind` as home.
4. Do not delete a bot’s home because a chat now has overflow.
5. Changing a bot’s sandbox still retires that bot’s computers, home and overflow.

No user-facing “convert my chats to their own computers” step.

---

## 6. Risks and open questions

- **How often do two working turns of the same bot overlap?** If rarely, Phase 1 plus optional serialize-on-overlap is enough and overflow VMs are YAGNI. Log this before Phase 3.
- **Does Boat support snapshot-fork?** If no, overflow starts empty and re-runs toolbox + clone. That is slower but simple.
- **Watch UX for overflow.** “Watch Ivy’s computer” is wrong if Ivy is on two VMs. Need a line that names the chat.
- **macOS local ports.** No network namespace. Port allocator + prompt is the ceiling unless Local on macOS is not a concurrency target.
- **Intra-turn parallel shells.** Overflow-per-chat does not help. Process group + port allocator + `TMPDIR` in the chat folder does.
- **Railway.** Confirm with whoever pays the bill: overflow VM that cannot pause must die with the turn, or Railway stays home-only.
- **Agent disobedience.** A jail that only *asks* the model to stay in `$OTTO_CHAT_DIR` will keep failing. Phase 1 should make writes outside the chat folder fail, except the allowlisted shared paths.
- **Group chats.** Warm-home TTL is load-bearing. Overflow must not become “every group message gets a VM.”
- **Stale docs.** `docs/user/bots.md` still describes Separate/Shared browsers and Upstash. Ignore it; `sandboxes.md` and DESIGN.md are current.

---

## 7. Phased plan and files

### Phase 0 — measure (no product change)

Log when `workingThreadIds()` has two threads whose `workspaceLeases` point at the same `OttoBotWorkspace`. Include bot id, provider, thread ids, and whether both ran `shell`.

- `apps/server/src/provider/otto-session-resources.ts`
- `apps/server/src/provider/layers/agent-controller.ts`
- `apps/server/src/provider/layers/agent-controller/turn-lifecycle.ts`

Done when a week of real use can answer “how often do we overlap?”

### Phase 1 — make today’s promise real (local + every remote)

No new VMs. Highest leverage.

- Jail: `withCommandEnvironment` / `RemoteSandbox.executeCommand` reject or relocate work whose cwd or write target is outside `chats/<id>` except `repos/` (read + worktree) and `.otto/bin`
- Process group per turn; kill on `computerSetup.end` / `finishTurn`
- Port allocator: `OTTO_PORT` (or a small range) in the turn environment; prompt says use it
- `TMPDIR` under the chat folder
- Close the GitHub login read hole (permissions, or a private mount the other chat cannot open)
- Keep chat folders and worktrees as they are

Files:

- `apps/server/src/provider/tools/otto-workspace-tools.ts`
- `apps/server/src/provider/workspace/remote-sandbox.ts`
- `apps/server/src/provider/bot-computer-setup.ts`
- `apps/server/src/provider/bot-github-login.ts`
- `apps/server/src/provider/otto-agent-instructions.ts`
- `apps/server/src/skills/system/computer-use/SKILL.md`
- tests next to those modules
- `docs/user/sandboxes.md` (say what is enforced, not only asked)

### Phase 2 — Local overlap isolation

When two local turns of the same bot overlap, second turn gets its own `LocalSandbox` under the home root, isolation backend on, shared `repos/` + `.otto/bin`.

Files:

- `apps/server/src/provider/bot-workspace.ts`
- `apps/server/src/provider/bot-workspace-pool.ts` (lease overflow key; do not change home key)
- `apps/server/src/provider/otto-session-resources.ts`
- `apps/server/src/provider/workspace/bot-workspace-lifecycle.ts` (`kind`)
- `apps/server/src/provider/bot-workspace.test.ts`
- `apps/server/src/provider/otto-session-resources.sweep.test.ts`

### Phase 3 — Boat (and other pausable remotes) overflow

Same acquire rule. Sibling VM only while two turns overlap. Destroy on idle. Watch names the chat when the lease is overflow.

Files:

- `apps/server/src/provider/workspace/adapters/boat.ts` (and e2b / daytona / vercel as needed)
- `apps/server/src/provider/bot-workspace.ts` (`connect` name + create)
- `apps/server/src/provider/otto-session-resources.ts` (`idleComputer`, `desktopUrl`, sweep)
- `apps/server/src/provider/layers/agent-controller.ts` (`computerWatch`)
- `apps/web/src/components/roster/watch-computer-button.tsx`
- `packages/client-runtime/src/i18n/catalogs/*/roster.ts`
- `DESIGN.md` (Watch copy if overflow exists)
- `docs/user/sandboxes.md`, `docs/user/computer.md`

Railway: either skip overflow or destroy-with-turn. Do not leave a second always-on VM.

### Phase 4 — only if Phase 0 says overlap is the common case

Revisit standing per-thread computers for Local only, or a user-visible “this chat has its own machine” opt-in. Do not do this for Railway. Do not do this for Boat without a start-quota plan.

Not in scope unless Phase 0 forces it: generic VM pool, snapshot-fork pipeline, nested containers on every provider, redesign of Settings → Computer.

---

## 8. What this is not

This note is not a claim that confined computers are certified, that a worktree is an isolated computer, or that Local isolation equals a remote VM. Those limits stay as they are in `AGENTS.md` and `TESTING.md`.

The smallest change that would *look* like Johan’s ideal — flipping `botRuntimeResourceScope` to always include `threadId` — is the wrong first commit. It is easy, it multiplies cost, and it does not fix the collisions that happen inside one chat.
