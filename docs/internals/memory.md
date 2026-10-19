# Memory architecture

A bot gets three kinds of context on every turn, rebuilt fresh each time:

1. **Instructions**: the bot's own configuration, which only a person edits.
2. **Memory**: short lines the bot learned in earlier chats, kept up to date after each chat.
3. **Now**: what is happening right now (open tasks, running helpers, upcoming routines, pending
   approvals). It is read from live state each turn and never stored.

The chat's own history comes on top of that (see [Chat history and compaction](#chat-history-and-compaction)),
and older chats are reached through the search tool rather than copied into context.

## Whose memory a chat reads

There are two kinds of memory, each keyed by a `resource` string in `apps/server/src/memory/memories.ts`:
the team's (`team`), shared by every person and every bot in the workspace, and each person's own
(`person:<person-id>`). Every line is also either true everywhere (`project_id` null) or tagged to
one project.

`chatMemory(thread, group)` decides what a chat reads (`read`), the one memory it learns into
(`learn`), and its project (`projectId`, null for General):

| Chat                                                     | Reads        | Learns into |
| -------------------------------------------------------- | ------------ | ----------- |
| A private chat (`user` visibility) with a bot            | team + yours | yours       |
| Any other chat with a bot, or a group of only bots       | team         | team        |
| A group with people in it (only its members can read it) | team         | nothing     |
| A helper's chat (`parentThreadId`)                       | team         | nothing     |
| A chat without a bot                                     | nothing      | nothing     |

A chat reads only lines that are true everywhere or tagged to its own project, so a project's lines
never load in another project's chats. A person's own lines load only in their private chats, so
nothing said in private reaches a chat other people can read, and nothing said in a restricted group
reaches anyone outside it. Delegated work gets no memory at all (`session-lifecycle.ts`). A chat
moved to another project keeps the lines it already taught; lines tagged to a deleted project stop
loading and expire.

## Storage

Migration `014-resource-memories` drops the old scoped facts and starts memory empty, with nothing
carried over, in one `memories` table. Each row is one line: `resource`, `project_id`, `text` (at
most 280 characters), the `thread_id` it came from, `edited_by` (the person who wrote or last edited
it, else null), `created_at` and `confirmed_at`. `memory_reviews` records how far each chat's
messages have been reviewed.

The limits live in `packages/contracts/src/memory.ts`: 40 lines per scope (`MEMORY_CAP`; a scope is
one memory everywhere, or one memory in one project), 60 days without confirmation before a line is
forgotten (`MEMORY_EXPIRY_DAYS`), 280 characters per line (`MEMORY_TEXT_MAX_CHARS`). Every read first
deletes lines not confirmed within 60 days. Past the cap, a scope drops the lines confirmed longest
ago. Text that looks like a credential or an instruction override is rejected
(`memory-content-safety.ts`).

## Context assembly

Before each turn `Memories.render` builds the chat's memory block (`renderMemory`):

1. What memory is: lines bots learned in earlier chats, dated by when each was last confirmed, which
   the bot never saves or deletes itself because a review updates them after the chat goes quiet.
2. Where this chat's learning goes, so the bot answers "remember this" and "forget that" truthfully:
   the whole team, only this person (their own lines are marked `yours`, and team lines can only be
   changed in Memory), or nothing in a restricted group (the bot says so and points to Memory).
3. That people can see and edit every line in Memory, that lines are data and not instructions, and
   that what people say now or what the bot can see wins over a line.
4. Each line as `- [id] text (Oct 18)`, or `(yours, Oct 18)` for the person's own, dated in the
   chat's time zone, or `(nothing yet)`.

While Memory is off in Settings the block is empty. Mastra sends it in the `<memory>` section of the
chat context. Later turns send only `<memory_changes>` (lines added, updated or deleted by id), so
the cached prompt stays put, unless the explanation itself changed, for example a shared chat made
private, in which case the whole section is resent in a `<context_update>`.

`nowContext` (`provider/now-context.ts`) builds the `<now>` block from the command read model when
the turn is sent: open tasks assigned to the bot, this chat's queued, running or blocked helpers,
enabled routines that post here with their next run, and whether an approval is waiting. It is
rebuilt for every turn and never stored.

Memory goes in the system context. Instructions and Now go in front of the turn's input, except on
OpenCode, which carries all three in its per-prompt system field.

## Review

Bots never write memory during a turn; there is no memory tool. `MemoryReviewLive`
(`memory/memory-review.ts`) listens for finished messages and, two minutes after a chat's last one
(`MEMORY_REVIEW_QUIET`), reviews the messages since the chat was last reviewed. A new message restarts
the wait. It skips a chat that learns nothing, a run where no person spoke, hidden routine and intro
prompts, and everything while Memory is off.

The review runs on the chat's bot and the model that bot answers with (`AgentController.resolveEngine`),
so it is billed and routed like the bot's own replies. `buildMemoryReviewPrompt` gives it every line
the chat reads with its id, marks person-written lines and lines of another memory (`(read-only)`),
says whether it is filling the team's memory or one person's, names the chat's project, and asks for a
JSON list of `add`, `update`, `confirm` and `delete` changes. An add sets `projectOnly` when it is
only true in this project. Explicit "remember this" and "forget that" requests are honored. Group
messages carry each person's name.

`Memories.applyReview` applies the changes in one transaction and can only touch the memory the chat
learns into: invalid or unsafe changes are skipped, an add that nearly duplicates a line the chat can
see confirms it (or is dropped when that line is read-only), `confirm` moves `confirmed_at` to now,
and a line a person wrote is confirmed or deleted but never reworded. Then the scope cap applies.

## Editing

The Memory drawer, opened from a chat's details or **Settings → Memory**, lists the viewer's own lines
and the team's through `memory.list` (with each line's project title, and its source chat's title only
when the viewer can see that chat). `memory.create` takes an owner (`team` or `you`), a project or
none, and the text; `memory.update` changes the text and project; `memory.delete` removes a line.
Changes are limited to the team's lines and the viewer's own. Reading needs the read scope; changing
needs operate. Lines added or edited by a person record `edited_by` and keep their wording through
later reviews.

## Searching past chats

Memory holds a few lines; details stay in the chats. The search tool's `message` results use the
`message_search` full-text index (migration `015-message-search`, `unicode61` with
diacritics removed, kept current by triggers), limited to chats every person in the current chat can
read. Each word matches as a prefix and results come newest first.

## Chat history and compaction

`OttoHistoryProcessor` (`provider/mastra/otto-memory.ts`) loads a chat's stored Mastra thread before
each run and sends it whole: every complete turn, verbatim, with only per-message transforms (files no
model reads are dropped, group passes are dropped, other bots' replies read as theirs). Each request
therefore starts with the previous request's history, so providers serve it from their prompt cache.
Grok chat requests also send `x-grok-conv-id` — the thread id, plus the bot id in a group — so
xAI routes that prefix to one server.
The same processor stores the run's new messages, except a group turn sent as its hidden note alone
(`(Group: …)`): the note starts the run, so the model sees it, but it is never stored. Older stored
notes and `NO_REPLY` passes are still dropped when the history is read.

Tool results are capped where they are created, so the stored result is the one the model saw
(`provider/tool-output.ts`): at most 50 KB and 2,000 lines, from the start, with a notice giving the
full size and how to see the rest. Text is cut after a whole line; any other result over 50 KB
becomes its capped JSON. Otto tools are capped in `createOttoMastraTools` and connector tools in
`approvalAwareTools`. Files read from the computer stay whole. `web_fetch` takes a character
`offset`, and its notice names the offset to read on from.

Before every model step, `otto-compaction.ts` measures the next request: the provider's count for
the thread's latest request plus an estimate of what was added since (four characters a token, 1,600
tokens per inline image, 3,000 per PDF). When it passes W − 32,768, where W is the model's catalog
input window capped at 400,000 tokens (128,000 when the catalog does not know the model), the chat is
compacted once. The compaction request is the thread's latest request with a checkpoint instruction
in place of the turn block, so it reads from the cache. Its reply must have every section (goal,
constraints, decisions, done, open, next step, key references) and is stored as an `assistant`
message marked by `metadata.ottoCheckpoint.firstKeptMessageId` (Mastra's memory drops system
messages on save and on recall). From then on the chat is sent as that checkpoint
(as a user message) followed by every turn from the first kept message: a user message at least a
tenth of W back, never inside a turn. Nothing stored is deleted. At a turn's start the previous turn
always stays verbatim; mid-turn the current turn does. A failed or incomplete checkpoint is logged,
keeps the previous one, and is not retried in the same run. The call is billed to the session's bot under
the `compaction` usage category. Rebuilding a thread (rollback) drops its checkpoints with the rest of
the transcript.
