---
name: otto
description: Use the app from bash with the `otto` command (tasks, projects, comments, library, chats, labels, statuses, agents, routines, notifications, search).
---

# The `otto` command

`otto` is how you use the app itself: its tasks, projects, comments, library, chats, labels, statuses, agents, routines, notifications and search. Run it with your bash tool; it prints JSON, so it composes with pipes.

Every call runs as the person you work for, in this chat's workspace, with exactly their rights: what they cannot do in the app, `otto` refuses too. It works only during your turn (its token ends with the turn), and it never reaches connections, secrets or settings.

## Usage

```bash
otto help                          # every command with its arguments
otto <command> [args...]
```

- Arguments are positional: `<x>` is required, `[x]` optional.
- An argument that starts with `{` or `[` is JSON (put it in single quotes); any other is a plain string.
- `-` reads that argument from stdin, for long text: `otto comments create task:abc123 - < notes.txt`.
- Success prints the result and exits 0. A refused or failed call prints `{"error": {"code", "message"}}` and exits 1. Codes: `unauthorized` (no valid token), `forbidden` (the person may not), `not_found`, `invalid` (bad arguments), `conflict` (changed since you read it: read again, then retry with the new `updatedAt` as `expectedUpdatedAt`), `rate_limited` (at most 120 calls a minute).

## Examples

```bash
otto tasks list '{"status":"todo"}'
otto tasks create '{"projectId":"p1a2b3c4d5e6","title":"Write the brief","assignees":["agent:a1b2c3d4e5f6"]}'
otto tasks set-status t1a2b3c4d5e6 done
otto tasks get t1a2b3c4d5e6   # then send its resources plus the new link (the list is replaced):
otto tasks update t1a2b3c4d5e6 '{"resources":[{"type":"url","title":"Spec","ref":"https://example.com/spec"}]}'
otto comments list task:t1a2b3c4d5e6   # its comments and activity events, oldest first
otto library create - <<'EOF'
{"title":"Weekly notes","mime":"text/markdown","content":{"encoding":"utf8","data":"# Weekly notes\n\n- shipped the brief"}}
EOF
otto chats create '{"name":"Research","agentId":"a1b2c3d4e5f6"}'
otto chats send c1a2b3c4d5e6 'Summarize the three newest library documents'
otto search 'quarterly plan'
```

## Notes

- People and agents are actors: `user:<id>` and `agent:<id>` (assignees, members, `createdBy`).
- Chats are private: you see only the person's own chats, and `chats send` goes to another chat, never this one.
- Labels and statuses: members read them, workspace owners change them. Fields, colors and auto-apply rules: `labels.md` and `statuses.md` in this folder.
- Routines: read `routines.md` in this folder before you create one (the `config` shape, events, actions, conditions).
- Agents: `title` (at most 80 characters, may repeat), `instructions` (at most 20,000 characters, added after the workspace's instructions), `provider` and `model` (each person's chats use their own connection of that provider; a null model is the connection's default), `thinkingLevel`, `skills` and `sources` (ids; `[]` means all), `avatar` (empty for a generated one, or `library:<id>`). Any member creates one; only its creator or a workspace owner changes or deletes it.
- The workspace's Explore-mode permission rules are not here: use the `permissions_edit` tool (see `permissions.md`).

## Commands

<!-- commands:start (generated from AGENT_COMMANDS in packages/shared/src/protocol/agent-channels.ts) -->
```
otto tasks list [filter]
    Tasks, newest change first. filter: {projectId?, status? ("todo"|"doing"|"done"|"archived", or a list), assignee? ("user:<id>"|"agent:<id>")}
otto tasks get <id>
    One task, or null.
otto tasks create <task>
    task: {projectId, title, description?, dueAt? (ms), assignees? (actors), resources? ([{type: "url"|"library"|"chat", title, ref}])}
otto tasks update <id> <patch>
    patch: any of {projectId, title, description, dueAt (ms|null), assignees (actors), resources, expectedUpdatedAt}. resources REPLACES the list: to add or remove a link, `otto tasks get <id>` and send its resources with the link added ({type: "url"|"library"|"chat", title, ref}) or removed.
otto tasks set-status <id> <status>
    status: todo, doing, done, archived or deleted.
otto projects list [filter]
    Projects. filter: {status? ("active" by default, "archived", or a list)}
otto projects get <id>
    One project, or null.
otto projects create <project>
    project: {title, description?, resources?}
otto projects update <id> <patch>
    patch: any of {title, description, resources, expectedUpdatedAt}. resources REPLACES the list: to add or remove a link, `otto projects get <id>` and send its resources with the link added ({type: "url"|"library"|"chat", title, ref}) or removed.
otto comments list <entity> [page]
    An entity's ("task:<id>", "project:<id>", ...) comments and activity events, oldest first: {items, more, earlier} (more = older items remain, earlier = how many). An item's type is "comment" | "event"; an event has event = {kind, ...}. page: {before? (an item id), limit? (max 500)}
otto comments create <entity> <content>
    Adds a comment as you. A "user:<id>" token in the content notifies that member.
otto library list [filter]
    Library items (files, documents, folders). filter: {parentId? (a folder, null = the top), type? ("file"|"document"|"folder"), createdBy?}
otto library get <id>
    One item's fields, or null.
otto library read <id>
    An item with its content: {item, content: {encoding: "utf8" (documents) | "base64", data}}
otto library create <item>
    item: {title, mime ("text/markdown" makes a document), content: {encoding: "utf8"|"base64", data}, parentId?}
otto library update <id> <patch>
    patch: any of {title, parentId, content}; replacing content needs expectedUpdatedAt (the item's updatedAt).
otto chats list
    The chats you are a member of in this workspace (chats are seen by their members only).
otto chats get <id> [page]
    A chat with a page of its messages. page: {limit? (max 500), beforeId?}
otto chats create [options]
    A new chat of yours. options: {name?, agentId? (default agent if left out), projectId?, labels?, sessionStatus?, isFlagged?}
otto chats send <id> <message>
    Sends a message to another chat you are in (not this one); it is answered as if you typed it (its agent, or the agents it mentions in a shared chat). Returns once the message is saved.
otto chats search <query>
    Your chats whose messages match the words.
otto labels list
    The label tree (members read; owners change labels).
otto labels create <label>
    label: {name, color?, parentId?, valueType? ("string"|"number"|"date"|"link"), autoRules?}. See labels.md.
otto labels update <id> <patch>
    patch: any of {name, color, valueType ("" = none), autoRules ([] = none)}; the id never changes.
otto labels move <id> [parentId]
    Moves a label under another (no parent = the top level).
otto labels reorder <ids> [parentId]
    Orders the children of one parent: ids is the JSON list of all of them.
otto labels delete <id>
    Deletes a label, its children and every chat's use of them.
otto statuses list
    The chat statuses (members read; owners change them).
otto statuses create <status>
    status: {label, category ("open"|"closed"), color?, icon? (emoji or image data URL)}. See statuses.md.
otto statuses update <id> <patch>
    patch: any of {label, color, icon, category}.
otto statuses delete <id>
    Deletes a status; its chats move to todo. todo, done, cancelled, archived and the default cannot go.
otto statuses reorder <ids>
    ids: the JSON list of every status id in the new order.
otto statuses set-default <id>
    The status new chats get.
otto agents list
    The workspace's agents; the oldest is the default.
otto agents get <id>
    One agent with its instructions, or null.
otto agents create <agent>
    agent: {title, instructions?, provider?, model?, thinkingLevel? ("off"|"low"|"medium"|"high"|"xhigh"|"max"), skills?, sources? ([] = all), avatar?}
otto agents update <id> <patch>
    patch: any of the create fields (lists replace). Its creator or a workspace owner only.
otto agents delete <id>
    Its chats move to the default agent; the last agent cannot go. Its creator or an owner only.
otto routines list
    The workspace's routines with their recent runs.
otto routines get <id>
    One routine, or null.
otto routines create <routine>
    routine: {title, config, agentId?, paused?}. Read routines.md for config first.
otto routines update <id> <patch>
    patch: any of {title, config (replaces it), agentId, paused}. A change makes the routine yours.
otto routines pause <id>
    Stops it firing.
otto routines resume <id>
    Lets it fire again.
otto routines run <id>
    One run now, as you, in the background; returns the run.
otto routines delete <id>
    Deletes it and its runs.
otto notifications list
    Your notifications: mentions and assignments, newest first.
otto notifications count
    How many are unread.
otto search <query>
    One search over tasks, projects, comments, library documents and your chats.
```
<!-- commands:end -->
