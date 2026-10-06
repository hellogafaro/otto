# Agent computers: one harness, many agents, each with its own computer

Research 6 Oct 2026 (read-only, nothing built). Question: how to get a harness-agnostic setup where every agent has its own computer (shell, files, browser, screenshots) and can run on Claude and ChatGPT subscriptions; Pi, or Mastra plus a subscription proxy? Context: `docs/pi-research.md` 5, `docs/data-architecture.md` (h).

## 1. Comparison

| | A. Pi only | B. Mastra + subscription proxy | C. ACP: CLI agents in the computer | **D. Pi + Claude Code in the computer** |
|---|---|---|---|---|
| Otto builds | box image; Pi tools redirected into it | a rewrite of the harness on Mastra, plus a proxy | an ACP client; drops both current integrations | box image; Pi tools redirected; Claude CLI spawned in the box |
| Simplicity | high (today's code) | low (new framework and proxy) | medium (one protocol, but a rewrite) | high (both harnesses exist today) |
| Power | full Pi; browser through a CLI | workspaces; computer use only on E2B Desktop or Daytona | each vendor's own agent | full Pi plus full Claude Code |
| Claude subscription | **no**: Pi's direct token bills "extra usage" | **no**: against the terms (section 5) | yes (unmodified Claude Code, user's own sign-in) | **yes** (same) |
| ChatGPT subscription | yes (Pi native, already wired) | through the proxy | yes (Codex CLI) | yes (Pi native) |
| Durability | best: harness and transcript on the server | Mastra storage and suspend/resume (new to us) | weak: every transcript lives in the box | Pi best; Claude transcript on the box volume |
| Per-agent computer | tools only in the box, no key in it | good when hosted; no self-hosted computer use | the whole agent and its login in the box | Pi: tools only; Claude: CLI and the user's login in the box |
| Maturity | Pi 1.0.4 | Mastra 1.5x; proxies unofficial | adapters exist for Claude, Codex and Pi | both run in Otto today |

## 2. Recommendation: D, with no proxy

Keep Pi as the default harness on the server and give each agent one Docker container from one `otto-agent` image. Pi's `read/write/edit/bash/grep/find/ls` run inside the container through their `operations` (the plan in data-architecture (h)). For the browser, the agent runs a CLI through `bash` (`agent-browser`, which drives Chromium over CDP) and saves screenshots to files that Pi's `read` hands to the model as images, so no new tool is needed. A user watches the screen through noVNC.

Claude subscriptions run as **Claude Code inside the same container**. The Claude Agent SDK stays on the server and starts the CLI in the box through `spawnClaudeCodeProcess`. The user signs in through Anthropic's own flow inside their box. This is the only route Anthropic's current terms explicitly allow, and it answers the "unverified" Claude question in (h). ChatGPT subscriptions keep going through Pi's native OAuth, which is already wired (`packages/pi-agent-server/src/adapt-credential.ts`).

Drop the "gateway that turns the Claude CLI into an API" from AGENTS.md: Anthropic forbids it (section 5). Don't adopt Mastra as the harness either. It doesn't solve subscriptions, it means rewriting what Pi already does, and its computer use needs hosted E2B Desktop or Daytona. Adopt ACP later, only if a third CLI agent (Codex, Gemini) has to run in the box.

**1-day spike:**
1. Build a Debian image with Chromium, Xvfb, x11vnc, noVNC, `agent-browser`, git and node, and run one container.
2. Point Pi's bash/read/write/edit `operations` at `docker exec` (same pattern as Pi's `examples/extensions/ssh.ts`).
3. Ask the agent to open a page and screenshot it, then look at the image.
4. Watch the same run live in noVNC.
5. Kill the container mid-`bash` and check the turn survives with an error result.
6. With any time left, run `claude` in the box through `spawnClaudeCodeProcess` (`docker exec -i ... claude`; the stdio must be pipes, not a TTY).

## 3. Questions for the owner

1. Do Claude-subscription agents run as Claude Code (its own tools, its transcript on the box volume), with Claude in Pi on an API key only? If yes, AGENTS.md's gateway line changes.
2. How many computers: one per agent (what you described), one per workspace (plan (h)), or one per account shared by all agents (what Grok Bot does)?
3. For hosted: Docker on our own hosts first, or a hosted sandbox (E2B)? Note that running Claude Code in hosted sandboxes requires accepting Anthropic's Commercial Terms.

## 4. What "GrokBot" is, and who uses which harness

**Grok Bot** is xAI's product, launched 11 Aug 2026 ([x.ai](https://x.ai/news/introducing-grok-bot)): always-on agents that "sign in and work across apps, tools, and websites" on "a computer of their own in the cloud". It is closed source, cloud only, and bundled with SuperGrok and Cursor plans as separate usage. Its harness is **not disclosed**. One guide reports that "All of your Bots use the same persistent cloud computer", one Linux VM per account with no isolation between bots ([continuum, 22 Aug 2026](https://continuumcode.ai/guides/grok-bot-alternatives/)); that is second-hand.

| Project | Harness | Computer | Subscriptions |
|---|---|---|---|
| [OpenClaw](https://docs.openclaw.ai/gateway/sandboxing.md) (MIT) | own runtime, **derived from Pi** (embedded Pi's SDK early on; its TUI still uses Pi) | gateway on the host, **only tools in the sandbox** (Docker, SSH, OpenShell); scope per session, per agent or shared; sandbox browser with CDP and noVNC | Claude: API key, setup-token, or a "Claude CLI backend" that reuses the installed `claude` login ([docs](https://docs.openclaw.ai/providers/anthropic)); ChatGPT: a Sign in with ChatGPT partner |
| [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (Apache-2.0, 4.1k stars) | own server; bots **run the `claude`, `codex` and `grok` CLIs** | Boat cloud desktops or local VMs; Cua Driver | "your existing logins and subscriptions ... no proxy in the middle" |
| [OpenBot](https://github.com/jccrump/openbot) (MIT, alpha) | own harness; experimental Codex harness | one Firecracker microVM per agent; Chromium, Xvfb, noVNC; versioned rootfs; "No snapshots, restore, or pause/resume" | API keys only |
| [OpenHands](https://docs.openhands.dev/openhands/usage/sandboxes/docker.md) (MIT) | own Python SDK | agent-server in a Docker container: bash, Jupyter, Playwright Chromium, VNC | API keys |

So the open projects are split. The closest ones (OpenClaw, OpenMausBot) do what D does: their own or Pi-derived harness on the host with tools in the sandbox, and the vendor's CLI for Claude subscriptions.

## 5. Subscriptions: facts, not legal advice

- **Anthropic** ([legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance), read 6 Oct 2026):
  - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."
  - Developers "may not collect, store, or intermediate Claude.ai credentials or session tokens".
  - It does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". A platform doing this must accept the Commercial Terms, must not modify the binary, and must not pay for or resell the usage.
- **In practice:** since 4 Apr 2026, third-party apps using Claude OAuth tokens draw from "extra usage", not plan limits. Pi hits this ([pi#3012](https://github.com/earendil-works/pi/issues/3012), [pi#3372](https://github.com/earendil-works/pi/issues/3372)). A separate Agent SDK credit announced for 15 Jun 2026 was cancelled the day it was due. OpenClaw's docs say SDK and `claude -p` usage "still draw from the signed-in subscription's usage limits" ([docs](https://docs.openclaw.ai/providers/anthropic)).
- **OpenAI:** "Sign in with ChatGPT" (DevDay, 29-30 Sep 2026) lets partner apps bill a user's Plus or Pro plan. It launched with 16 partners, including OpenClaw and OpenCode but not Pi. It is "currently open to open-source projects, locally running apps and selected partners", and commercial providers join through a waitlist ([trendingtopics](https://www.trendingtopics.eu/sign-in-with-chatgpt-tokens-other-apps/)). Otto would need to apply.
- **Proxies:**
  - [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT, 54k stars) reuses the CLIs' OAuth tokens directly against the provider APIs (Claude, Codex, Gemini, Grok), with multi-account round robin. For Claude, that is exactly the routing the terms forbid.
  - [claude-code-openai-wrapper](https://github.com/RichardAtCT/claude-code-openai-wrapper) (MIT) and `claude-max-api-proxy` drive the real CLI or Agent SDK behind an OpenAI-shaped endpoint. That is intermediation when it serves other users.
  - Mastra Code's own Claude Max OAuth carries the same warning ([docs](https://code.mastra.ai/configuration)).

## 6. Mastra, briefly

[mastra-ai/mastra](https://github.com/mastra-ai/mastra): Apache-2.0 core with an enterprise `/ee/` folder, 28.6k stars, `@mastra/core` 1.51. It covers agents, graph workflows with suspend/resume, memory, MCP, and a model router for 40+ providers.

- **Workspaces** ([docs](https://mastra.ai/docs/workspace/overview)): a filesystem plus a sandbox with `execute_command` and process tools, on 12 backends (Local, Docker, E2B, E2B Desktop, Daytona, Modal, Vercel, Cloudflare and others). Lifecycle (snapshot, pause, destroy) arrived 3 Sep 2026; "Persistence is provider-specific".
- **Computer use** (2 Sep 2026, [blog](https://mastra.ai/blog/introducing-sandbox-computer-use)): 11 `computer_*` tools and a `streamUrl()` to watch live, on **E2B Desktop and Daytona only**. Separately, `@mastra/agent-browser` (Playwright) provides a browser.
- **ACP** ([docs](https://mastra.ai/docs/agents/acp)): an `AcpAgent` can delegate to Claude Code, Codex or Amp.
- **Compared with Pi:** Mastra is a broad app framework built on the Vercel AI SDK; Pi is a lean coding harness with tool `operations` and a durable path (`pi-durable`). Mastra gives no new route to subscriptions; it would reach them through the same proxies or ACP agents. Switching means rewriting `pi-agent-server`, and AGENTS.md rules out a framework for one use.

## 7. Sandboxes for the computer

| Option | Open, self-host | Gives | Notes |
|---|---|---|---|
| Docker + Xvfb/noVNC + Chromium (pattern of Anthropic's computer-use demo, OpenClaw, OpenBot) | yes | shell, files, desktop, CDP, VNC; volume persistence | simplest; container isolation only |
| [E2B](https://e2b.dev/docs/sandbox/persistence) | Apache-2.0, self-host with Terraform | Firecracker microVM; Desktop sandbox with VNC; pause/resume **with memory** | best hosted step later; Mastra supports it |
| Daytona | **repo archived 3 Oct 2026**, development moved private in Jun 2026 ([repo](https://github.com/daytonaio/daytona)); fork "Nightona" | was snapshots and computer use | avoid for self-host |
| [Cua](https://cua.ai/docs/cua/reference/desktop-sandbox/linux-container) | MIT | Docker Linux desktops with a computer-server HTTP API; macOS/Windows VMs | useful if we need a non-Linux desktop |
| Modal, Fly Machines, Browserbase | no (hosted) | snapshots or volumes; Browserbase is a browser only | pay per use; lock-in |

Shape for D. The server holds the harness, the transcripts, the secrets and the MCP pool. The box holds `bash`, files on a volume (the workspace cache), Chromium on `:99` with CDP on localhost, noVNC behind the server's auth proxy, the `otto` CLI with a scoped run token, and, only for Claude agents, Claude Code and that user's own Claude login. Egress is open by default, with an allow-list option later. Desktop local mode keeps tools on the host.

Not verified: `agent-browser` inside Xvfb in our image; `spawnClaudeCodeProcess` with `docker exec` (only documented for VMs, [Freestyle guide](https://www.freestyle.sh/docs/guides/run-claude-code-in-a-sandbox)); that Anthropic counts the Agent SDK spawning the unmodified binary as the "unmodified Claude Code binary" case; Grok Bot internals.
