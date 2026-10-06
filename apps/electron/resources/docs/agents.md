# Agents

An agent is who a chat talks to: a name, instructions, the provider and model that run it, and the skills and sources it may use. Each workspace has at least one; the oldest is the default, which chats use when they name none.

Agents live in the workspace database, not in files. Read and change them with the `agents_edit` tool (this tool will be replaced by the Python `otto` CLI, `otto agents`). Any member can list and create agents; only an agent's creator or a workspace owner can update or delete it.

## The `agents_edit` Tool

| Action | Arguments |
|--------|-----------|
| `list` | none (instructions are left out; use `get`) |
| `get` | `id` |
| `create` | `title`, optional `instructions`, `provider`, `model`, `thinkingLevel`, `skills`, `sources`, `avatar` |
| `update` | `id`, any of the fields above (`skills` and `sources` replace their lists) |
| `delete` | `id` (its chats move to the default agent; the last agent cannot be deleted) |

Example: `agents_edit({ action: "create", title: "Researcher", instructions: "Answer with sources.", thinkingLevel: "high" })`.

## Fields

- `title`: the name, at most 80 characters. Titles may repeat; the `id` is what identifies an agent.
- `instructions`: at most 20,000 characters, added to the model's system prompt after the workspace's instructions, in its own group.
- `provider` and `model`: which provider's connection runs it. Each person's chats use their own connection of that provider; a `null` model means the connection's default.
- `thinkingLevel`: `off`, `low`, `medium`, `high`, `xhigh` or `max`.
- `skills` and `sources`: lists of ids it may use; `[]` means all of them.
- `avatar`: empty for a generated avatar (derived from the agent's id), or `library:<id>` for an image uploaded to the library.

The workspace's own instructions (the `instructions` setting of the workspace) apply to every agent in it and are changed by workspace owners.
