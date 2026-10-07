# Routines

A routine runs actions on a schedule or when something happens in the workspace: it starts a chat with a prompt, calls a webhook, or runs a workspace-local script. Each run is recorded (the newest 20 per routine).

Routines live in the workspace database, not in files: `automations.json` is no longer read (an old one was imported once). Read and change them with the `otto routines` commands (see `otto.md` for all of them). Any member can list and create routines; only a routine's creator or a workspace owner can change, pause, resume, run or delete it.

A routine runs as its creator: the chats its prompts start are theirs, on their own connections. So a change by anyone else (a workspace owner) makes the routine theirs, and **Run now** runs as the person who asked.

## Commands

| Command | Arguments |
|---------|-----------|
| `otto routines list` | none |
| `otto routines get <id>` | with its recent runs |
| `otto routines create <routine>` | `{ title, config, agentId?, paused? }` |
| `otto routines update <id> <patch>` | any of `title`, `config` (replaces the whole config), `agentId`, `paused` |
| `otto routines pause <id>` / `resume <id>` | |
| `otto routines run <id>` | one run now, in the background (its result shows in the routine's runs) |
| `otto routines delete <id>` | its runs go with it |

`agentId` is the agent the routine's chats talk to; leave it out (or `null`) for the workspace's default agent.

Example:

```bash
otto routines create '{"title":"Morning briefing","config":{
  "type":"schedule","schedule":{"cron":"0 9 * * 1-5","timezone":"Europe/Budapest"},
  "actions":[{"type":"prompt","prompt":"Give me a morning briefing"}]}}'
```

## Config

| Field | Description |
|-------|-------------|
| `type` | `schedule` or `event` (`webhook` routines are made in the Routines page, which holds their secret) |
| `schedule` | `{ cron, timezone? }`: a 5-field cron expression and an IANA timezone (schedule routines) |
| `event` | The event that starts it (event routines, see below) |
| `matcher` | A regular expression on the event's match value (a label id, a status, a tool name...) |
| `conditions` | Filters that all have to pass before the actions run (see below) |
| `semanticCondition` | `{ question, threshold? }`: a yes/no question the decision model answers before prompt actions run; inert when the decision model is off |
| `permissionMode` | `safe`, `ask`, `guarded` or `allow-all` for the chats it starts |
| `telegramTopic` | A forum topic of the workspace's paired Telegram group for its chats |
| `actions` | 1 to 20 actions, run in order |

### Events

App events: `LabelAdd`, `LabelRemove` (match value: the label id), `LabelConfigChange`, `PermissionModeChange` (the new mode), `FlagChange` (`true`/`false`), `SessionStatusChange` (the new status). Agent events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (the tool name), `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`. A schedule is a `schedule` routine, not an event.

A routine never runs for an event about a chat it started itself, and a chain of routine-started chats stops at 3 deep.

### Actions

- **Prompt:** `{ type: "prompt", prompt, labels?, projectId?, llmConnection?, model?, thinkingLevel? }` starts a chat. `@mentions` of sources and skills work; `$OTTO_*` variables are expanded.
- **Webhook:** `{ type: "webhook", url, method?, headers?, bodyFormat? ("json" | "form" | "raw"), body?, captureResponse? }`. Only `http(s)` URLs. Credentials are a secret the Routines page sets (`secretId`), never written in the config.
- **Script:** `{ type: "script", script, args?, runtime? ("bun" | "node" | "python3"), timeoutMs? }` runs a script by its path relative to the workspace root (no shell, no `..`).

Variables (`$VAR` or `${VAR}`) in prompts, webhooks and scripts: `$OTTO_EVENT`, `$OTTO_EVENT_DATA` (the payload as JSON), `$OTTO_SESSION_ID`, `$OTTO_SESSION_NAME`, `$OTTO_WORKSPACE_ID`; per event `$OTTO_LABEL`, `$OTTO_OLD_MODE`/`$OTTO_NEW_MODE`, `$OTTO_IS_FLAGGED`, `$OTTO_OLD_STATE`/`$OTTO_NEW_STATE`; for schedules `$OTTO_LOCAL_TIME`, `$OTTO_LOCAL_DATE`. Webhooks also see `OTTO_WH_*` variables of the server's environment, nothing else.

### Conditions

- **Time:** `{ condition: "time", after?: "HH:MM", before?: "HH:MM", weekday?: ["mon", ...], timezone? }` (an `after` later than `before` wraps midnight).
- **State:** `{ condition: "state", field, value? | from? / to? | contains? | not_value? }` on the event's payload (`permissionMode`, `sessionStatus`, `labels`, `isFlagged`).
- **Logical:** `{ condition: "and" | "or" | "not", conditions: [...] }`, at most 8 levels deep.

An invalid config is refused with the reason; nothing is written.
