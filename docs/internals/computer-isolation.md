# Computer isolation: per-thread compute (revised)

Research and proposal only. No application code was changed for this note.

A bot today has one computer. Its chats share that OS. Git worktrees are already per chat and are not the problem. Johan routinely runs **5–10 chats of the same bot at once**, each building, testing, or running an app (dev servers, test suites, browsers). Those workloads contend for CPU and memory on one machine and slow or break each other.

An earlier draft treated overlap as rare and recommended a shared home plus overflow only when a second turn started. That assumption is wrong for this usage. Overlap is the common case, so overflow-on-second-turn is just a slower way of saying “every chat needs its own compute.”

**Recommendation:** per-thread **compute** is now the right default. Keep a per-bot **home** for the things that should be shared (toolbox, cloned repos, a seed browser profile). Do not put 5–10 full stacks on one OS. Shape differs by provider: Local is sandboxes with cgroup limits on the host; Boat is one VM per chat, slept independently, seeded from a home snapshot. A pool of anonymous machines is the wrong abstraction; a **slot cap** on how many computes may run at once is required.

---

## 1. How it works today (short)

A **thread** is an Otto chat. A **computer** is a Mastra workspace (local directory or remote VM). There is no provider named `box`; the old Ascii Box path is **Boat**.

```
Bot → one Computer (pool key + otto-<hash>)
        └── many chats share that OS
              └── each chat: folder + git worktree + turn GitHub login
```

Keying is in `apps/server/src/provider/bot-workspace-pool.ts`:

- Scope: **bot id** (`botRuntimeResourceScope`). A thread without a bot is already `thread-<id>`.
- Local pool key: `local:no-workspace:<botId>`. Remote: `<provider>:<credentialFingerprint>:<botId>`.
- Durable id: `otto-` + SHA-256 prefix. Railway ignores the credential segment so a token rotate does not mint a second VM.
- Identity: `{stateDir}/bot-workspaces/{id}.json`, not a SQLite table.

`BotWorkspacePool` refcounts that one workspace. Five chats of Ivy = one `OttoBotWorkspace`. After the last lease, sleep waits **5 minutes** (group chats switch bots every message). Boat keep-alive every 2 minutes while *any* turn of that bot works; `idleComputer` will not stop the VM if another chat is still working. With 5–10 concurrent chats the one VM **never idles**. Sweep (startup + every 10 minutes) deletes computers a bot no longer owns.

Chat folders and detached worktrees (`bot-computer-setup.ts`) isolate git. The prompt asks the model to run heavy builds one at a time. There is no CPU, memory, process, or port isolation. Watch is “Watch *bot*’s computer”: one Boat desktop.

---

## 2. What 5–10 concurrent chats actually need

The scarce resource is **host CPU and RAM**, not a git working tree.

One machine running several `next build`s, test suites, dev servers, and headed browsers will oversubscribe. Port clashes and leftover processes are secondary; they fall out of “each chat has its own OS (or cgroup).” Serializing those chats so only one works at a time would make Johan’s workflow wait. Overflow-only-on-the-second-chat is the common path, so key it as the default.

Two other collisions a second computer still does not fix unless you isolate the *turn*:

- Several shells inside one chat (build and test together) still share that chat’s compute.
- Two delegations to the same worker bot need two computes of *that* bot, same as two ordinary chats.

---

## 3. Shape: per-thread compute + bot home

Not a standing anonymous pool. Not 5–10 stacks inside one OS with a polite prompt.

```
Bot
  ├── Home     (durable, rarely running)
  │     toolbox, bare clones, seed browser profile, golden snapshot
  └── Compute  (one per chat, the default lease)
        process / port / CPU / memory / disk of that chat
        worktree, node_modules, that chat’s browser, Watch target
```

**Keying** (do change this):

| Record | Scope | Pool key includes | Role |
| --- | --- | --- | --- |
| Home | `botId` | today’s key + `kind: home` | Seed only. Not the lease for a working turn. |
| Compute | `botId` + `threadId` | `<provider>:…:<botId>:<threadId>` | Default acquire. Sleeps and wakes with that chat. |

`botRuntimeResourceScope` stays as the *bot* name on home. Compute identity is `botWorkspaceIdentity` of a key that also carries `threadId`. Existing `otto-<hash>` files become home (or the first compute plus a home minted from them). `carriedOverWorkspaceId` still maps `bot-<id>` → `botId` for home.

A **slot cap** (permits, not anonymous VMs) limits how many computes of one bot may be awake: default something like 8, visible in Settings. Extra chats wait for a slot. That is the only “pool.”

Containers inside one bigger home machine are the right *Local* implementation (the host is already the big machine). They are the wrong *Boat* default: we do not have a nested-container API, and one Boat VM still has one RAM budget unless it is sized ~10× (not in this adapter).

---

## 4. Local vs Boat

### Local — per-thread sandbox + cgroups on the host

You cannot run 5–10 VMs on the environment machine. Share the host; isolate the chat.

- One bot home directory: `{stateDir}/bot-workspaces/{homeId}/` with `repos/` (bare clones) and `.otto/bin`.
- One `LocalSandbox` per chat, `workingDirectory = chats/<id>/`, Mastra isolation on (`sandbox-exec` / `bubblewrap`). Bind or share `repos/` and `.otto/bin` read-only.
- **cgroup CPU and memory** on Linux so one build cannot starve the others. Fair shares, plus a hard memory cap per chat. `LocalSandbox` today has no resource limits; this is new (bubblewrap can take cgroup controllers).
- Port allocator + `TMPDIR` under the chat folder + process group killed at turn end (still required *inside* the sandbox).
- Slot cap on the host (RAM-aware). Ten headed browsers plus ten node processes may not fit a laptop; queue rather than thrash.
- macOS `sandbox-exec` has no cgroups and no network namespace. Local concurrency on a Mac is a documented ceiling: ports + process groups only, or run the server on Linux / use Boat.
- Watch: still none.

### Boat — per-thread VM, seeded from home

Boat’s API is already one Linux VM per sandbox, snapshot on stop, resume later, limited **creates**. That matches per-thread compute if we stop collapsing chats onto one VM.

- **Home VM** (or a snapshot with no long-running VM): toolbox, `apt` once, `repos/` cloned, optional seed browser profile. Named `{botId} home`. Stopped except when seeding or when someone is installing a tool for every chat.
- **Compute VM per chat:** create/resume with `idempotencyKey`, `ttlSeconds: 300`, name `{botId} {shortThread}`. Identity `kind: compute`, `threadId` set. First create copies from home (snapshot-fork if Boat ever offers it; otherwise toolbox + clone, then that chat’s disk is the cache).
- **Independent sleep.** Chat 3 waiting on a person archives *its* VM. Chats 1–2 keep their dev servers. Today the shared VM cannot do that.
- **Resume, don’t recreate.** After the first create, the same chat wakes the same VM. `node_modules`, that feature’s build cache, and that chat’s cookies survive. This is how we avoid spending a start on every message.
- Slot cap = start-quota safety valve (see §6).
- Watch becomes **this chat’s desktop**. Two buttons, two VMs. Correct once ten chats run ten browsers.

E2B / Daytona / Vercel follow Boat (they can pause or snapshot). Railway does not; see §6.

---

## 5. Shared state when each chat has compute

| State | Handle |
| --- | --- |
| **Toolbox** (`gh`, apt, desktop tools) | Install once on home. Seed every new compute from that snapshot (or copy `.otto/bin`). Do not `apt-get` ten times per morning. |
| **Cloned repos** | Home holds `repos/`. Local: bind into each sandbox, worktree per chat (already). Boat: snapshot-fork or one clone per new compute, then that VM keeps the clone. Worktrees stay per chat. |
| **Browser logins** | Seed profile from home at *create* only. After that, each compute has its own profile. Do not mount one live profile on ten VMs (cookie races). GitHub turn tokens stay per-chat files; on separate VMs the current “other chat can read the login folder” hole goes away. Sites the person signed into via Watch on home are copied once; they go stale and need a refresh on that chat’s desktop. |
| **Watch / desktop** | Per-chat. Copy: “Watch this chat’s computer.” Owner can open any chat’s desktop; others only while that chat is working (today’s rule, scoped to the chat’s VM). No desktop on Local. Home is not the Watch target unless the person is installing something on home. |
| **node_modules, build caches, running servers** | Per-chat disk and processes. That is the point: different features / different apps. |
| **Otto Memory, Library, chat history** | Unchanged. Not on the computer. |
| **MCP** | Already per thread. |

The product line becomes: the bot has a home; each working chat has a computer. DESIGN.md’s “every bot always gets its own computer (files and browser logins)” stays true for *home* and for “never share with another bot.” Chats of one bot no longer share one live OS.

---

## 6. Cost at 5–10 concurrent chats

Compute you actually use cannot be free. Today you pay for **one** machine that cannot do the work. The bill you want is **N running computes**, where N is chats *working now*, plus cheap sleep for the rest.

| Provider | 5–10 working chats | Idle chats of the same bot | Starts / quota |
| --- | --- | --- | --- |
| **Local** | Same host CPU/RAM, split by cgroup. Ten browsers may not fit; slot cap queues. No extra vendor bill. | Sandboxes stop; disk stays under the bot home. | None. |
| **Boat** | 5–10 running VMs (10× running-minutes vs today). Each has its own CPU/RAM, so they do not thrash each other. | Archive independently (snapshot). A waiting chat does not hold the others up and does not hold a running VM. | **Create** once per chat that ever needed a computer. After that, **resume** (already the keep-alive path). Ten first-time creates on a Monday can hit a start quota; ten resumes on Tuesday should not. Slot cap + “reuse this chat’s VM” are the quota plan. Keep-alive every 2 minutes × 10 VMs is cheap API traffic. |
| **E2B / Daytona / Vercel** | Same shape as Boat if pause/snapshot works: N running, rest paused. | Paused/snapshotted per chat. | Provider-specific; treat like Boat (persist identity, resume). |
| **Railway** | No pause. 5–10 VMs **keep billing** even when the chat is waiting. Disconnect still does not destroy VMs (`docs/user/railway-sandboxes.md`). Ten leftovers is ten times today’s footgun. | Standing per-thread Railway VMs are a billing incident. | N/A (no start quota; continuous charge). |

**Railway recommendation:** do not make per-thread VMs the default. Keep today’s one VM and tell the user it is the wrong provider for 5–10 concurrent stacks, **or** require an explicit “Railway per-chat (bills until you destroy it)” opt-in with a hard cap (2) and sweep that actually deletes. Do not silently mint ten always-on Railway VMs.

**Boat start quota (unknown exact number, code calls it limited):**

- Worst: destroy compute on every idle → 5–10 creates per session cycle → will exhaust quota.
- Right: persist per-chat identity; sleep/archive; resume. Creates grow with *new chats*, not with *turns*.
- Cap awake computes (e.g. 8). A 9th chat waits or the least-recently-working compute is archived to free a slot.
- Home should almost never be running; seeding from a stored snapshot avoids a create for home every time.

Group-chat bot switching (the reason for the 5 minute home TTL) must not create a VM per message. Compute is keyed by **chat**, not by “who spoke last.” The same group thread of bot Ivy keeps Ivy’s compute for that thread.

---

## 7. Lifecycle

1. **First turn of a chat.** Acquire compute for `botId+threadId`. If none, seed from home (create home first if missing). Count against the slot cap; wait if full.
2. **Later turns of that chat.** Resume the same compute. Toolbox/clone skipped if `.otto/setup` / worktrees exist (today’s logic, per VM).
3. **Turn ends, chat idle.** That compute’s idle TTL (Boat: 2 minutes) then sleep/archive. Other chats unaffected.
4. **Person answers.** Wake that chat’s compute only.
5. **Bot deleted or sandbox changed.** Sweep deletes home and every compute of that bot (extend today’s `sweepComputers` grouping).
6. **Home updates** (new tool on the image). Next *new* compute seeds from the new home. Existing computes keep their disk until the person asks to rebuild, or we add an explicit “reset this chat’s computer.”

The pool still never deletes; sweep does. `replaced` must mean “newer home” or “newer compute for this *thread*,” not “newer computer for this bot” (that rule would delete nine chats when the tenth starts).

---

## 8. Risks and open questions

- **Exact Boat start quota and VM size.** Confirm before shipping Phase 2. If creates are tens per day, persist/resume is mandatory and destroy-on-idle is forbidden.
- **Snapshot-fork.** If Boat cannot fork home into a new VM, first turn of a new chat pays toolbox+clone (minutes). Still better than sharing one OS.
- **Host RAM on Local.** Ten browsers is a laptop limit, not a software one. Slot cap must be real.
- **macOS Local.** No cgroups. Either document “use Linux or Boat for 5–10 concurrent,” or do not promise fair CPU there.
- **Watch copy and DESIGN.md.** “Watch *bot*’s computer” becomes per-chat. Owner-anytime vs others-while-working stays, scoped to that VM.
- **Intra-chat parallel shells.** Still one compute. Process group + cgroup covers the blast radius.
- **Stale `docs/user/bots.md`.** Ignore Separate/Shared / Upstash. `sandboxes.md` and DESIGN.md are current until this ships.

---

## 9. Phased plan and files

Acceptance scenario for every phase: **one bot, 8 chats, each running a build or a dev server at the same time**, without sharing a PID namespace or an unconstrained CPU.

### Phase 1 — Local default: per-thread sandbox + shared home

Change the acquire key so Local compute is `botId+threadId`. Home directory holds `repos/` and `.otto/bin`. Each chat gets its own `LocalSandbox` + isolation. Linux cgroups for CPU/memory. Slot cap. Jail writes to the chat folder; process group; `OTTO_PORT`; `TMPDIR` in the chat folder. GitHub login hole goes away on separate sandboxes; still lock down the files.

Files:

- `apps/server/src/provider/bot-workspace-pool.ts` — compute key includes `threadId`; home key stays bot-scoped
- `apps/server/src/provider/bot-workspace.ts` — per-thread `LocalSandbox`, shared home root
- `apps/server/src/provider/workspace/bot-workspace-lifecycle.ts` — `kind: home | compute`, `threadId`
- `apps/server/src/provider/otto-session-resources.ts` — acquire compute by default; sweep groups by bot+thread; slot cap
- `apps/server/src/provider/layers/agent-controller/session-lifecycle.ts`
- `apps/server/src/orchestration/layers/provider-command/session.ts` — same keying
- `apps/server/src/provider/tools/otto-workspace-tools.ts` — jail + env
- `apps/server/src/provider/bot-computer-setup.ts` / `bot-github-login.ts`
- `apps/server/src/provider/otto-agent-instructions.ts` — drop “your other chats share this computer”
- tests beside those modules
- `docs/user/sandboxes.md`

Boat/Railway still share one VM in this phase so remotes do not suddenly multiply.

### Phase 2 — Boat default: per-thread VM from home

Same keying on Boat. Home snapshot seeds new computes. Persist compute identity; sleep/archive per chat; resume on the next turn. Slot cap tied to start quota. Watch is this chat’s desktop.

Files:

- `apps/server/src/provider/workspace/adapters/boat.ts` — name, TTL, seed/resume
- `apps/server/src/provider/bot-workspace.ts` — `connect` create/reattach per compute
- `apps/server/src/provider/otto-session-resources.ts` — `idleComputer` / `keepAlive` / `desktopUrl` per lease (no “sibling still working on this VM”)
- `apps/server/src/provider/layers/agent-controller.ts` — `computerWatch`
- `apps/web/src/components/roster/watch-computer-button.tsx`
- `packages/client-runtime/src/i18n/catalogs/*/roster.ts`
- `DESIGN.md` (Watch + Computer cards)
- `docs/user/sandboxes.md`, `docs/user/computer.md`

### Phase 3 — Other remotes

E2B / Daytona / Vercel: same as Boat (pause/snapshot per chat). Railway: stay one VM **or** explicit opt-in with cap 2 and sweep that deletes. Do not default Railway to 5–10 always-on VMs.

Files: `adapters/{e2b,daytona,vercel,railway}.ts`, Railway disconnect warning in settings UI, `docs/user/railway-sandboxes.md`.

### Phase 4 — only after 1–2 hold

Home snapshot-fork if the provider adds it. User-visible slot cap. Optional “reset this chat’s computer.” Intra-chat parallel shells stay on one compute.

---

## 10. What this is not

Not a claim that Local cgroups equal a remote VM, or that a worktree is an isolated computer. Those limits stay as in `AGENTS.md` and `TESTING.md`.

Not “flip `botRuntimeResourceScope` and walk away.” The keying change is small; cgroups, Boat seeding, Watch, sweep’s `replaced` rule, and Railway’s billing story are the work.
