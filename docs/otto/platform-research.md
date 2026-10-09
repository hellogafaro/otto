# Platform research: is there a better starting point than building Otto from scratch?

## Foundation decision

**Build a fresh Otto app on the already-selected Bun/Hono/React/PostgreSQL
stack** (Drizzle, Better Auth, pg-boss), with selective reuse of Buzz's UI
behavior and ACP/lifecycle lessons at specific integration boundaries only.
Do not fork Buzz or any other platform from this research wholesale. Do not
switch the backend to Rust absent a demonstrated, measured bottleneck. This
closes the fork-vs-fresh-build question the research below raised — the
comparison itself stays as dated supporting evidence, not a reopened
survey. Architecture choice, not a runtime/performance certification.

**Rationale:** Hono, Drizzle, Better Auth, and pg-boss form one selected
server stack; documented integration paths support that choice — Better
Auth mounts on Hono via the standard web Request/Response interface
([Hono + Bun](https://hono.dev/docs/getting-started/bun),
[Better Auth + Hono](https://better-auth.com/docs/integrations/hono)),
[pg-boss](https://github.com/timgit/pg-boss) is a plain JS library, not a
service to replace — while their **combined behavior under Otto's actual
code remains unverified**; these sources document the integration paths,
not Otto's own completed integration. Swapping backend language changes
those integration boundaries with no measured need shown to justify it.
Performance raised in discussion — React rendering, database reads,
agent-control delivery — depends on actual architecture and workload, not
backend language alone; native coding-harness execution and compute
isolation are already a separate boundary from the web-server runtime per
[the plan](plan.md). Buzz reuse applies only at specific boundaries, with
licenses checked before any code is copied. No generic plugin system, no
placeholder Rust service.

**Proposed implementation-acceptance baseline — unmeasured, configurable,
not an invented result:**

- Record the actual device/data/concurrency profile any check runs under
  alongside its numbers; a number without that context isn't comparable.
- Target p95 typing feedback ≤50ms and local UI interactions ≤100ms, as
  something to measure against, not a guarantee.
- No multi-agent stream may starve another connection's Stop/steer control.
- Measure server-acknowledgement latency separately from a provider's own
  Stop-completion or agent-token latency, so a provider's response time is
  never attributed to Otto's server.
- List/detail views stay indexed and paginated; streamed output uses
  bounded batching, backpressure, and capture limits, per the plan's
  existing bounded-resource rule.
- The plan's own first proof — two isolated agents, Stop, deadline
  handling, server-loss recovery, reconnect, and access checks — remains
  the actual acceptance gate, not a number in this list.
- Backend language alone guarantees none of the above, and no fixed
  provider response deadline should read as an Otto guarantee — provider
  latency is outside Otto's control.

**Revisit Rust only** for a specific, demonstrated CPU-bound hot path,
after simpler fixes (query shape, rendering, buffering) have been tried and
shown insufficient. This decision makes no commitment to a future service
rewrite.

---

## Original research (historical — the comparison that informed the decision above)

Research only, checked 2 October 2026 against live primary sources (each
candidate's own repository/README/docs/manifest files, commit pins noted
where checked at a specific commit). No selection was made at research
time — the decision above was recorded afterward. [The plan](plan.md) and
[the stack options](stack-options.md) are otherwise unchanged. Finite,
honest market scan, not a claim of having found every candidate that
exists.

**Hard filter:** React frontend only (Svelte/Vue/Angular/Flutter listed as
explicitly excluded, not scored). Backend language (Go, Python) and
license (AGPL/BSL/FSL) are **tradeoffs to weigh, not automatic
rejections**. Bun/Hono/Drizzle/Better Auth are the human's already-selected
planning choices per [the stack options](stack-options.md) — settled, not
an open question this research reopens — though their actual runtime
compatibility remains unverified per that same document. Closeness to that
stack (useAgent, Wemux) is a point in a candidate's favor; this research can
still fairly surface Python/Go alternatives as genuine tradeoffs to weigh
against revisiting that selection, without implying the selection itself
is undecided. At research time, continuing the from-scratch plan was one
option among several; the decision at the top of this document has since
settled that question for the fork-vs-fresh-build axis specifically.

GitHub star/fork/commit counts below are quoted as **raw repository
statistics observed at check time**, for reference only — not a maturity,
correctness, or comparative-ranking claim across candidates.

## Top shortlist — one page

No candidate is a clean drop-in. Pick the axis that matters most: **stack
match** (useAgent, Wemux), **broad native-engine support with a published
source tree** (Paperclip), or **documented isolation rigor** (OtoDock).
Agor leads on multiplayer UX at the cost of a stricter license and a
lighter default sandbox mode.

| | [useAgent](#useagent) | [Paperclip](#paperclip) | [OtoDock](#otodock) | [Agor](#agor) | [Wemux](#wemux) |
| --- | --- | --- | --- | --- | --- |
| Frontend / Backend | React19/Next16 / Bun+Hono+Drizzle | React / Express5+Better Auth+Drizzle+Pino+ws | React / FastAPI (Python) | React19/Vite / FeathersJS (Node) | React/Vite/TanStack / Hono (Node) |
| DB | Postgres | Postgres | Postgres | Postgres or LibSQL | Postgres (Drizzle) |
| Knowledge/docs surface | Wiki pages + team memory + versioned document/artifact exports (README-stated) | "Documents and work products" output (README-stated); not independently confirmed as a Notion-like collaborative editor | Personal/shared knowledge, docs, workspace outputs (README-stated) | Teammate knowledge base (README-stated) | Not stated |
| Isolation | Daytona or self-hosted CubeSandbox, **provisioned per thread** (not per standing agent) | Rust Runner, self-host default; per-agent filesystem home is structural default, but Codex login credentials are host-seeded/shared by default within it (below) | Per-session kernel + network namespace (most explicit) | Three modes: simple (local), sandbox (fail-closed), delegated (external) | Unverified |
| Native subscription | Codex: documented managed ChatGPT/ Codex app-server account flow. Claude Code/OpenCode: native provider driver confirmed, specific login/billing mode not detailed in this doc. **Not ACP** — own canonical protocol. | Native Claude Code/Codex/OpenClaw/Cursor/Gemini CLI listed; per-provider login mode not independently re-verified beyond Codex (above) | Stated directly (Claude/Codex, "working on your subscriptions") | SDK-based, 6 providers; per-provider login mode not independently verified | **BYOK stated in README**; production compose alone doesn't confirm or rule out a subscription mode |
| License | AGPL-3.0 + commercial | MIT | FSL-1.1-Apache-2.0 (free to 5 users, seats beyond) | BSL-1.1 → Apache-2.0 (2029) | Apache-2.0 |
| Repo stats (2 Oct 2026) | 368★, repo created 29 Aug 2026 | 95.8k★ (GitHub's own count) | 187★, 48 commits | 1.4k★, 2,701 commits | 157★, 78 commits |
| Official demo | [63-sec tour, useagent.org/#demo](https://useagent.org/#demo) | README references a `full-tour.webm` and [paperclip.ing](https://paperclip.ing) | [2-min tour, otodock.io](https://otodock.io) | [13-min unscripted demo, YouTube](https://www.youtube.com/watch?v=3in0qh7ZH0g) | None found |

## Decision questions (historical — question 1 is resolved by the decision above)

1. ~~**Fork one of the five, or continue the from-scratch Bun/Hono/Drizzle
   plan?**~~ **Resolved: continue the from-scratch plan** (see
   [Foundation decision](#foundation-decision) at top). Kept below for the
   reasoning trail; every finalist traded something, none was "just use
   this."
2. **Which axis wins** — stack proximity, broadest native-engine coverage,
   or isolation rigor? Those point at different projects.
3. **Credential architecture needs a deliberate decision, not just
   configuration**, on at least two finalists: useAgent's canonical
   protocol is explicitly not ACP, and its Codex path keeps the managed
   ChatGPT OAuth session on the trusted backend, issuing a **one-use,
   run-bound relay capability** to the sandbox (not copying OAuth state
   into it) — a different shape from letting login live inside the agent's
   own Environment. Paperclip's per-agent `CODEX_HOME` is a private
   filesystem home by structural default, but the **login credential inside
   it is host-seeded via a shared symlink by default** unless a per-agent
   API key or an external self-managed `CODEX_HOME` is configured —
   private storage and shared credentials are two different things, and
   conflating them would overstate the isolation.
4. **Is "per-agent dedicated isolated computer" a hard filter, and by
   what definition?** Multica's and open-tag's local-daemon/shared-root
   defaults are an **adaptation and proof gap**, not an architectural
   dead end — a daemon can be pointed at one operator-provisioned isolated
   machine per agent, it just isn't automatic out of the box the way
   useAgent's or OtoDock's per-session provisioning is. Otto's own plan
   does not mandate VMs specifically — any backend that proves isolation
   and lifecycle qualifies — so Agor's non-VM "sandbox" mode is a thing to
   verify (fail-closed how, exactly?), not a disqualifier by definition.
5. **The owner/assignee split is schema-specific, not uniformly absent.**
   [Paperclip's `issues.ts`](https://github.com/paperclipai/paperclip/blob/c9cde69299aeb70350223ac3f6e1f9afd8138478/packages/db/src/schema/issues.ts)
   has a separate `responsibleUserId` column alongside
   `assigneeAgentId`/`assigneeUserId` — a real split, directly comparable to
   Otto's owner/assignee shape. The column lacks a database-level NOT NULL
   constraint; whether application code still enforces a human owner on
   every Task is unverified either way from the schema alone. The other
   four finalists' schemas were not checked at this same depth — verify
   each directly rather than assuming an outcome.
6. **License terms differ by what "use" means**, and none grants
   unrestricted internal use as a blanket fact: OtoDock's FSL caps free
   self-hosting at 5 users before seat licensing applies even for purely
   internal use; AGPL-3.0 (useAgent) and BSL-1.1 (Agor) mainly constrain
   redistribution/competing-product scenarios, which matters only if Otto
   is ever distributed or offered externally. Treat each license's actual
   text as the source, not this summary.
7. **A Notion-like collaborative document editor was not established by
   this review for any finalist** — useAgent and Paperclip both claim
   document/work-product *outputs*, which reads as different from
   real-time co-editing of a shared doc, but that distinction needs direct
   confirmation, not inference. Built fresh regardless of base, or does
   that push toward a reference like Docmost's or AFFiNE's editor (subject
   to their own license terms)?

---

## Finalist detail

### useAgent

[useagenthq/useagent](https://github.com/useagenthq/useagent), pinned
`e36925a`.
[`frontend/package.json`](https://github.com/useagenthq/useagent/blob/e36925acb7a96b85505e9eba5806a80636958fc4/frontend/package.json):
React 19, Next 16, Tailwind 4.
[`backend/package.json`](https://github.com/useagenthq/useagent/blob/e36925acb7a96b85505e9eba5806a80636958fc4/backend/package.json):
Bun, Hono, Drizzle, Better Auth, Postgres, Claude SDK — close to a
library-for-library match to Otto's own stack.
[`compose.prod.yaml`](https://github.com/useagenthq/useagent/blob/e36925acb7a96b85505e9eba5806a80636958fc4/compose.prod.yaml)
runs backend/gateway/frontend as 3 services (external Postgres/sandbox
infra separate; the frontend service runs a Node healthcheck, so "the
whole runtime is Bun" would overstate it). Pluggable **Daytona** (managed)
or self-hosted **CubeSandbox**.

**Knowledge/output features**, per the
[README](https://github.com/useagenthq/useagent/blob/e36925acb7a96b85505e9eba5806a80636958fc4/README.md):
wiki pages and optional team memory kept beside the work, with
personal/org memory kept separate and inspectable; saved documents,
spreadsheets, presentations, and other files with revisioned edits and
native-format exports.

**Isolation is per thread, not per standing agent** — the README describes
"a computer for every thread." Per
[`docs-site/docs/concepts/engines-and-adapters.mdx`](https://github.com/useagenthq/useagent/blob/e36925acb7a96b85505e9eba5806a80636958fc4/docs-site/docs/concepts/engines-and-adapters.mdx)
(same pin): every engine (Codex, Claude Code, OpenCode, Pi) always runs its
own provider-native driver and session lifecycle, with the sandbox
provider swappable independently of which engine is selected. The doc
states plainly that useAgent's canonical event/client contract is **not
ACP** and there is no generic ACP execution engine registered. For Codex
specifically, a connected ChatGPT/Codex account's session stays on the
trusted backend, which hosts the Codex app-server and hands the sandbox a
**one-use, run-bound relay capability** rather than copying OAuth state
into it. Claude Code and OpenCode are confirmed to use their own native
drivers in the same document, but their specific login/billing mechanics
aren't spelled out there the way Codex's is — don't assume the same
relay-capability detail applies to them without checking their own adapter
docs.

**Gaps:** repo created 29 Aug 2026, README marked alpha. Conversations read
as directing one coworker per thread, not an explicit multi-human team-chat
model.

### Paperclip

[paperclipai/paperclip](https://github.com/paperclipai/paperclip). 95.8k★
per GitHub's own count. MIT. React frontend; `server/package.json` at
pinned `c9cde69` confirms **Express 5, Better Auth, Drizzle, Pino, and ws**
— the backend framework is not unconfirmed, it's Express. Postgres
(embedded by default, external for production); an optional native Rust
"Paperclip Runner" ships as the self-hosted default execution path. Native
Claude Code, Codex, OpenClaw, Cursor, Gemini CLI. Documents/work products
are a stated output type, distinct from a collaborative editor — not
independently confirmed to be Notion-like co-editing.

**Owner/assignee schema, directly checked**:
[`packages/db/src/schema/issues.ts`](https://github.com/paperclipai/paperclip/blob/c9cde69299aeb70350223ac3f6e1f9afd8138478/packages/db/src/schema/issues.ts)
(pinned `c9cde69`) has a separate `responsibleUserId` column — the issue/
task's responsible human — alongside `assigneeAgentId`/`assigneeUserId`: a
real owner/assignee split, comparable to Otto's own Task shape. The column
is **nullable at the database level**; that only means Postgres itself
doesn't enforce a value, not that application code allows a Task to go
without one — whether Paperclip's own write path enforces a human owner is
unverified here, not established either way.

**Codex credential architecture**, from
[`docs/adapters/codex-local.md`](https://github.com/paperclipai/paperclip/blob/c9cde69299aeb70350223ac3f6e1f9afd8138478/docs/adapters/codex-local.md)
(pinned `c9cde69`): a **private per-agent `CODEX_HOME` is the structural
default** — "pins each agent to a per-agent home
(`<instance>/companies/<companyId>/agents/<agentId>/codex-home`)." Within
that private home, though, **the login credential is shared by default**:
"managed homes are always seeded: the ChatGPT-subscription `auth.json` is
symlinked from the host Codex home" unless a per-agent `OPENAI_API_KEY` is
set. An external, self-managed `CODEX_HOME` outside the Paperclip company
tree is "never seeded or overwritten" — the override path, not the
default. Private filesystem isolation and shared login credentials are two
different axes; this project has the first by default and not the second.

**Gaps:** README has reportedly grown quickly (skills, routines,
"agentchat") — re-read fresh at adoption time.

### OtoDock

[OtoDock/oto-dock](https://github.com/OtoDock/oto-dock). React dashboard;
FastAPI (Python) core; Postgres. Explicitly "built on Claude Code & Codex,
working on your Anthropic and OpenAI subscriptions," with **each user
connecting their own subscription** and the run engine changeable per
chat, per the README. README also establishes personal/shared
knowledge/docs/workspace outputs — this is not a docs-absent candidate.
Isolation story is the most explicit in this scan on paper: per-session
mount/process namespace, network isolation blocking private ranges and
cloud metadata endpoints by default, credentials encrypted at rest and
injected per session — **documented, not independently runtime-certified**
in this research. Platform roles (Admin/Creator/Member) plus per-agent
roles; SSO/OIDC and 2FA documented.

**License is two separate things**: the FSL-1.1-Apache-2.0 grant itself
permits internal use broadly and restricts only competing commercially
with OtoDock; the **5-free-user cap is OtoDock's own product/business
policy layered on top of that grant**, not a term the license itself
imposes — worth knowing which one would need re-negotiating if it mattered
(the business policy, most likely, not the open-source grant).

**Gaps:** Python/FastAPI is a stack delta from Hono/Bun/Drizzle. The
5-user ceiling is a real cost the moment a team running OtoDock itself
grows past it.

### Agor

[preset-io/agor](https://github.com/preset-io/agor), pinned `7859cb6`.
[`apps/agor-ui`](https://github.com/preset-io/agor/tree/7859cb6db18fcad494e5d862162574648205908c/apps/agor-ui):
React 19, Vite, Ant Design, React Flow, Zustand. Daemon:
FeathersJS/Express/Socket.IO on Node. Postgres or LibSQL via Drizzle.
Native SDK support for Claude Code, Codex, Gemini, OpenCode, Copilot,
Cursor. README states **three explicit execution modes: simple (local),
sandbox (fail-closed), and delegated (external execution)** — the exact
isolation mechanics behind "fail-closed sandbox" are not detailed in the
README itself and would need a direct source check before relying on it.
Isolated git branches are the unit of work; multiplayer features (live
cursors, comments, shared sessions) and session genealogy (fork/spawn
subsessions with per-prompt cost accounting) are genuinely distinctive.
Branch-scoped RBAC/ACLs with per-user credentials. Official demo: a
[13-minute unscripted walkthrough on YouTube](https://www.youtube.com/watch?v=3in0qh7ZH0g).

**License**: Business Source License 1.1, converting to Apache-2.0 on
15 Jan 2029; the restriction targets selling a competing
agent-orchestration product, separate from internal self-hosted use.

**Gaps:** "sandbox" mode's actual isolation boundary needs its own direct
check, not assumed from the label. FeathersJS is a bigger backend delta
from Hono than useAgent's or Wemux's.

### Wemux

[wemux-ai/wemux](https://github.com/wemux-ai/wemux), pinned `8517455`.
Root [`package.json`](https://github.com/wemux-ai/wemux/blob/85174555b1d0452e685912e36357b5da09f10068/package.json)
confirms React 19, Vite 8, Hono, Drizzle, Better Auth, and the full
TanStack Start/Query/Router set — the closest raw library match to Otto's
own stack of every candidate here, confirmed at the manifest level.
[`deploy/docker/docker-compose.production.yml`](https://github.com/wemux-ai/wemux/blob/85174555b1d0452e685912e36357b5da09f10068/deploy/docker/docker-compose.production.yml)
is the actual footprint: **Postgres 16, MinIO (S3-compatible storage), and
one combined web+server "control-plane" image with an autoheal sidecar** — the
worker process is explicitly *not* containerized; it installs separately on
a target machine and points at the control plane (per the compose file's
own comments and `docs/SELF-HOSTING.md`). Kanban tasks, realtime sessions,
group chat with agents. Native runtime support listed for OpenCode, Claude
Code, Codex — but the compose file alone, like the README's BYOK framing
("no built-in API keys are shipped"), does not confirm or rule out a
subscription-login runtime mode; that needs a direct check of the worker's
own auth code.

**Gaps:** 157★/78 commits — the smallest observed sample of the five.
Isolation model for the (separately-installed) worker's agent execution
not detailed in the compose file.

---

## Broader scan: more agent-team platforms, checked but not shortlisted

| Project | Stack | License | Isolation | Why not top 5 |
| --- | --- | --- | --- | --- |
| [multica-ai/multica](https://github.com/multica-ai/multica) | React/Next.js 16, Go+Chi+sqlc, Postgres 17 | Custom license: full Apache-2.0 text plus additional hosting/commercial-embedding/branding conditions — not plain Apache-2.0/OSS | Local daemon on the operator's own machine by default; **can be pointed at one dedicated machine per agent, but that provisioning is manual, not automatic** the way useAgent's/OtoDock's per-session sandboxing is | This is an adaptation/proof gap, not an architectural wall — but it is a real gap against "dedicated isolated computer" as currently scoped. 51.8k★/5,537 commits. |
| [fancyboi999/open-tag](https://github.com/fancyboi999/open-tag) | React/Vite, Node, Drizzle | Apache-2.0 | Agents run against shared host filesystem roots by default — same manual-provisioning gap as Multica | README **does claim** data never leaves the network; that claim does not account for model inference itself going to a cloud provider, which is a real gap between the marketing claim and the architecture, not something to repeat uncritically or silently drop. Channels/DMs/shared-tasks is the closest "Conversation" shape of any candidate here. 201★/571 commits. |
| [Team-Commonly/commonly](https://github.com/Team-Commonly/commonly), pinned `beb43c5` | React/MUI, Node/Express, dual MongoDB + Postgres, LiteLLM for native multi-provider routing | Apache-2.0 | Scoped runtime tokens, capability grants; depth not detailed | The dual-database footprint is a **deployment/migration tradeoff** — running two databases to adopt this whole — not a universal inability to keep Otto's own domain rules Postgres-authoritative if specific modules were harvested instead. Offers both local Compose and a Helm chart, plus BYO-vs-managed-seat tiers. 1.4k★/2,408 commits. |
| [Chorus-AIDLC/Chorus](https://github.com/Chorus-AIDLC/Chorus), pinned `a994ef4` (v0.20) | React 19, Next.js 15, Tailwind 4, shadcn, Prisma 7, Postgres 16, optional Redis | AGPL-3.0 | Not detailed | Native agent integration confirmed (v0.20 moved to Claude stream-JSON, Codex App Server, Pi RPC directly, not MCP-only). PGlite for a local-only starter; external Postgres required for multi-agent/production. Its Idea→Proposal→Doc+Task-DAG→Execute→Verify pipeline is a **structural mismatch** against Otto's flat-Task preference — a different model, not a missing feature. 1.2k★/944 commits. |
| [OneMana-Soft/OneCamp](https://github.com/OneMana-Soft/OneCamp), pinned `c668e0e` | Go 1.25 backend; Next.js frontend (separate `OneCamp-fe` repo — note its README calling the backend "unpublished" is **stale and contradicted** by this now-public server repo) | AGPL-3.0 (full source build); a separate free ready-made license covers up to 25 users | Not assessed — native CLI/subscription/computer model unverified at this snapshot | Large, newly-public footprint: Postgres, Dgraph, Redis, MinIO, OpenSearch, EMQX, LiveKit, web, and proxy services; ~8GB RAM/40GB disk stated. Good breadth of existing chat/docs/tasks/calendar collaboration (source tree includes business logic and an AI-agent implementation with tests), but the server was only published 1 Oct 2026 — too new to call proven, and the agent/subscription/isolation model specifically needs its own direct check. [Official no-signup demo](https://onemana.dev). |
| [zosmaai/zosma-cowork](https://github.com/zosmaai/zosma-cowork) | Next.js, React Native/Expo, Tauri; Hono | MIT | Local-first; OAuth broker planned, not shipped | Own README distinguishes shipped (Pi runtime only) from planned (Claude Code, Codex, ACP) — the multi-provider native-subscription story is a roadmap item. 122★/627 commits. |
| [agentrq/agentrq](https://github.com/agentrq/agentrq) | **Vue 3**, Go+Fiber, SQLite | AGPL-3.0 + commercial | MCP-mediated human-in-loop review delay | **Excluded by the React requirement.** Its delay-before-delivery human-review pattern is worth borrowing independent of the framework. |

## General-purpose all-in-one suites: a genuine route, conditional on priorities

Mature team products. None was confirmed to have Otto's specific
native-CLI-subscription, per-agent-isolated-computer model — but several
do claim some form of AI/agent feature (Mattermost's README states AI
integration, Twenty's current docs describe agents/workflows, AFFiNE's
README mentions an AI assistant), so "no agents at all" would overstate
the gap; what's actually unestablished is whether any of them match Otto's
specific execution model, not whether they touch AI features at all. **If
the priority is a proven, feature-complete collaboration product and the
native-CLI/isolated-computer agent layer is treated as a build-on-top
project, one of these is a genuine full-product adoption route**, not just
a module-harvest source — the tradeoff is accepting a mature PM/chat/docs
foundation now in exchange for building or adapting that specific agent
model yourself on top of someone else's code and data. If the agent layer
is the priority instead, the shortlist above fits better. Either way, any
module reuse (not full adoption) is **subject to that project's actual
license terms**, checked per project below, not promised.

| Project | Stack | License | What it has | Missing for Otto |
| --- | --- | --- | --- | --- |
| [makeplane/plane](https://github.com/makeplane/plane) | React/Next.js, Django, Postgres, Redis | AGPL-3.0 (Community) | Mature PM + wiki, 60k+★; [Plane Agents](https://plane.so/blog/agents-are-now-live-in-plane) (announced Sept 2026) run natively on triage/summarization/spec-writing, and [self-host env vars](https://developers.plane.so/self-hosting/govern/environment-variables) document a configurable "Plane Intelligence" AI service (`PI_API_REPLICAS`, LLM provider keys) | No chat. Agent *existence* is established; exact availability in which self-host edition/tier, and fit with Otto's native-subscription/per-agent-isolated-computer model, are **not** established by these sources — the announcement doesn't state cloud-vs-self-host scope directly, and the env vars describe a server-side AI service, not a native-CLI-subscription agent runtime |
| [twentyhq/twenty](https://github.com/twentyhq/twenty) | React, NestJS, Postgres, Redis | AGPL-3.0 | CRM object/permission model; current docs describe agents/workflows | CRM-shaped, not PM; no docs/chat; native-CLI/isolated-computer model not established |
| [docmost/docmost](https://github.com/docmost/docmost) | React, NestJS, Postgres, Redis | AGPL-3.0 core; enterprise features separate | Real-time collaborative editor | No tasks/chat/agent |
| [outline/outline](https://github.com/outline/outline), pinned `d410db1` | React 19, Koa 3, Sequelize, Postgres, ioredis, Yjs | **BSL-1.1** — prohibits a competing commercial "Document Service" offering; converts to Apache-2.0 on 2030-09-09, or 4 years after a given version's first publication, whichever governs | Mature real-time wiki/reference editor (Yjs-based) | No tasks/chat/agent |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE), pinned `b71bb7c` | React (BlockSuite editor); backend is [NestJS 11 + Express 5 + Prisma + ioredis](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/backend/server/package.json) with some Rust-native components, not Rust alone | Root/rest MIT; the CE-distributed backend is MPL-2.0; [`packages/backend/server/LICENSE`](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/backend/server/LICENSE) covers specific Enterprise-Edition *extensions* only, not the whole backend — don't read this as "the whole server needs a paid subscription" | Docs/wiki/canvas/tables, local-first multiplayer editing, and a README-stated AI assistant — a capable general editor surface | No tasks/chat; which parts are MPL-2.0 vs. EE-only needs checking per module before reuse |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) | React (Fuselage), Meteor, MongoDB | MIT | Mature chat | Mongo not Postgres; no tasks/docs/agent |
| [mattermost/mattermost](https://github.com/mattermost/mattermost) | React, Go | Source AGPL-3.0; monthly compiled binaries MIT | Chat + boards + playbooks; README states AI integration | Native-CLI/isolated-computer agent model not established; license nuance if building from source |
| [plankanban/planka](https://github.com/plankanban/planka) | React, Sails.js, Postgres | Fair-code (proprietary, not OSI-approved) | Simple polished kanban | Not OSI-open; no docs/chat/agent |

## Model-driven application frameworks (not scaffolds, not agent-team products)

A third category distinct from both the agent-team shortlist and the lean
starter scaffolds: frameworks that ship a real data-model/permission/admin
layer and expect an application to be built on top, rather than a blank
boilerplate or a finished team product.

- **[NocoBase](https://github.com/nocobase/nocobase)** — React + Umi + Ant
  Design frontend, Node.js/Koa backend, Sequelize ORM (Postgres-capable).
  Apache-2.0. 24.4k★/18,200 commits. README claims "AI employee" features
  executing business tasks via Claude Code/Cursor/Codex/OpenCode CLI access
  and skills, on top of its own data models, permissions, workflows, and
  audit logs. This is a genuinely richer, plugin-based platform than a lean
  Otto build — adopting it trades Otto's own simpler domain model for
  NocoBase's no-code/low-code configuration layer and whatever complexity
  that inherits, in exchange for built-in data modeling and an
  already-wired agent-execution story worth checking in more depth before
  ruling in or out.
- **[Payload](https://github.com/payloadcms/payload)** — Next.js/React/
  TypeScript, a Postgres adapter, its own auth system, granular field/
  document-level access control and hooks, a React admin UI, and the
  Lexical rich-text editor. MIT. 45,000+★/15,999 commits. Frames itself as
  a full application framework, not a headless add-on — installable
  directly into an existing `/app` folder, owning backend, auth, admin,
  and database access together. Adopting it as Otto's foundation would mean
  accepting Payload's own auth, admin, and storage layer **before** Otto's
  own runtime choices — a different stack than Bun/Hono/Better Auth/Tiptap,
  not a drop-in alongside them.
- **[appsmithorg/appsmith](https://github.com/appsmithorg/appsmith)** — React frontend,
  Java backend, MongoDB + Redis. Apache-2.0 (Community Edition). Brief
  reference only: an internal-tool/admin-panel builder, not a
  project/task/conversation product and not agent-team-oriented — noted for
  completeness, not a serious candidate for Otto's shape.

## Already-known internal options (user is specifically weighing these)

- **Buzz** (this repository) — a Nostr relay with its own Stream/Forum/DM
  surfaces per [VISION.md](https://github.com/block/buzz/blob/main/VISION.md); already has real project-adjacent
  collaboration primitives. Extending it directly is the option
  [the plan](plan.md) already considered and explicitly declined: *"This
  intentionally differs from Buzz's Nostr relay and self-hosted forge
  direction without changing Buzz itself"* — relisted here because the
  question is being reopened, not because that decision record changed.
- **BB** ([get-bb/bb](https://github.com/get-bb/bb)) — already covered as a
  harness/environment-lifecycle reference at
  [references.md](references.md#bb--getbb). It is an agent-thread execution
  tool, not a team project/task/doc product in its own right — relevant as
  a component to reuse (environment lifecycle), not as a full-product
  foundation.

## Excluded by the React requirement

- **Huly** ([hcengineering/platform](https://github.com/hcengineering/platform)) —
  **Svelte**, per the project's own stated stack. The *application* source
  repo's historical data layer is MongoDB; the **current self-hosted
  deployment** ([hcengineering/huly-selfhost](https://github.com/hcengineering/huly-selfhost)
  `compose.yml`, checked directly) runs **CockroachDB, Redpanda,
  Elasticsearch, and a MinIO-compatible storage image (`pgsty/silo`)** by
  default, with Mongo/Redis present only as commented-out/optional
  services — do not cite Mongo as the current self-host default. Excluded
  on the Svelte requirement alone, not on this backend or its feature set.
  A hybrid route — Huly's backend behind a freshly written React frontend
  — is technically conceivable but is not itself a React product to adopt:
  it would mean keeping Huly's own client/protocol and operational
  footprint (CockroachDB/Redpanda/Elasticsearch/S3-compatible storage)
  while writing a new frontend against them from scratch. Noted as a
  benchmark for a genuinely mature collaboration feature set, not scored as
  an adoption path. [Platform-Collective/platform](https://github.com/Platform-Collective/platform)
  is the current fork successor — fuller assessment at
  [references.md](references.md#huly--platform-collective).
- **Zulip** — web client is custom, non-React; mobile is React Native, which
  does not satisfy the web-first React requirement here.
- **AppFlowy** — Flutter + Rust.
- **Vikunja** — Vue. **OpenProject** — Angular. **Taiga** — AngularJS.
- **Open WebUI** — Svelte.
- **AgentRQ** — Vue (its human-review-delay idea noted above regardless).

## Agent runtimes / harnesses (complementary reuse, not full team apps)

Already in [references.md](references.md): T3 Code, Craft Agents, Mastra,
Pi. Also checked for this scan: **OpenHands** (React frontend, Python
backend — single-developer coding-agent execution, not a team product).
**LibreChat, Dify, Flowise, LobeHub** are genuinely multi-user/team
products in their own right (shared workspaces, team chat) — the actual
gap against Otto is their lack of a native-CLI-subscription/isolated-computer
agent-execution model and a Task/Project data shape, not that they are
single-agent or team-incapable in general.

## Lean starting scaffolds (if continuing the from-scratch plan)

Boilerplates matching Otto's stack, not products to adopt:
[kriasoft/react-starter-kit](https://github.com/kriasoft/react-starter-kit),
[JuanPabloGilA/hono-react-boilerplate](https://github.com/JuanPabloGilA/hono-react-boilerplate),
[sahilmondal/react-hono-betterauth-monorepo](https://github.com/sahilmondal/react-hono-betterauth-monorepo),
official [Better-T-Stack](https://better-t-stack.dev/). Confirmed as
scaffolds only, not evaluated further.

## Shallow-reject / discontinued appendix

- [stacks-task-manager/stacks](https://github.com/stacks-task-manager/stacks) —
  React/Expo, Hono, Postgres+Sequelize, AGPL/commercial. Personal
  local-first PM app with a bolted-on chat assistant, not agent execution.
  7★/105 commits.
- [Morelitea/initiative](https://github.com/Morelitea/initiative) — React
  19/Vite/shadcn, FastAPI (Python), Postgres, AGPL-3.0. Small-group PM tool
  with an MCP server for read access, not native agent execution. Useful
  only as an RLS permission-model reference.
- [Vibe Kanban](https://www.vibekanban.com/) — React/Rust source. The
  vendor announced company shutdown on 10 Apr 2026
  ([shutdown post](https://www.vibekanban.com/blog/shutdown)); hosted/remote
  services were sunset within 30 days of that post, local workspace use
  continues, and the project is now open-source/community-maintained
  rather than vendor-maintained. **Do not present this as an actively
  vendor-supported foundation** — the source may still be a useful
  reference, the company behind it is not operating.

## Checks and limits

- Checked 2 October 2026 against each project's own source; useAgent,
  Agor, Paperclip, Commonly, Chorus, Outline, AFFiNE, OneCamp, and Wemux's
  production compose were each checked at a specific pinned commit, noted
  inline, during this session (including cross-verification via the
  GitHub API directly where a doc path moved).
- Repository statistics (stars/forks/commits) are raw counts from each
  project's own page, reported for reference only — not
  translated into "proven," "most adopted," or similar maturity language
  anywhere above.
- **No runtime was installed, run, or exercised for any candidate.** Every
  isolation/auth/agent-behavior claim is read from that project's own
  documentation or manifest files, not observed operating.
- License summaries are read from each project's own license file/README
  at check time; seat caps, conversion dates, and non-compete scope all
  vary by project and by version, so cite the linked source directly for
  any decision that turns on exact terms.
- Finite, time-boxed scan — not an exhaustive survey; credible candidates
  beyond this list likely exist.
- No app code, dependency install, secret, benchmark, or deployment
  touched. `plan.md` and `stack-options.md` unchanged.
