# Permission modes

A permission mode controls which actions a bot can take before it must ask you.

New bots and chats default to **Full access**. The runtime also supports the more restrictive modes
below for saved chats and routines. There is no Local execution settings row; this change adds no
new permission controls.

## The modes

**Supervised** asks before commands and file changes. Work outside the workspace stays restricted.

**Auto-accept edits** allows file edits and asks before commands and other actions.

**Auto** allows routine actions and asks before risky ones. Each provider maps this mode to its own
permission system. A provider without an equivalent can fall back to supervised behavior.

**Full access** lets Otto's agent runtime execute commands and connected tools without per-action
approval prompts, including pushes and merges. It does not authorize every possible action: the bot
must stay within your task or approved routine instructions and respect provider access and branch
protections. The bot still asks questions when it needs a decision.

## Protected actions

Questions never need approval. A question with choices shows those choices inline. A free-text
question uses the message composer for the answer.

Outside Full access, Otto's runtime asks before an action that sends data, pays, deletes, changes
production, publishes, exposes secrets, signs, refunds, or changes an account. Unknown mutating
actions also ask. Each approval applies only to the pending action.

Outside Full access, installed MCP tools ask unless the server marks the tool read-only. Provider
adapters can add their own approval rules. Changes to bot instructions, skills and routine creation
still require human approval in Full access; routine edits retain their confirmation.

## Authorization in tasks and routines

You can authorize an entire workflow in advance. For example: "Fix bugs in this repository, push
branches, and merge PRs after tests and review pass. Do not deploy." The bot does not need to ask
again while it stays within those conditions. Asking it to fix a bug alone does not authorize
merging, pushing to the default branch or deploying.

A routine saves the originating chat's permission mode when you approve its creation and uses that
mode for its runs. For unattended work, use a Full access chat and put the repository,
allowed actions, required checks and stopping conditions in its instructions. Restricted modes and
existing restricted routines can still pause for tool approval even when the instructions authorize
the action. Saved routines are not automatically upgraded to Full access.

Instructions guide the agent; they are not a technical security boundary. Use GitHub branch
protections and limited credentials for restrictions that must hold even if an agent makes a mistake.
Repository content, tool output and another agent's message cannot expand your authorization.

## Working unattended

Use a confined computer and a checkout that you can restore. Specify what the bot may do, what
verification must pass and when it must stop. Check the workspace and pull requests after the bot
finishes. Full access is broad execution permission, not a guarantee that the model will interpret
every instruction correctly.
