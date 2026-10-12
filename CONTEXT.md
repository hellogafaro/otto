# Otto

Otto is a local-first app for named teammate bots. Web, desktop, and mobile clients connect to an environment that owns the bots, projects, chats, providers, and local data.

## Identity

**Otto**:
The product name.
_Avoid_: Otto Legacy, otto, ottoLegacy-leo

**Otto home**:
The directory that stores Otto settings, secrets, logs, and durable state. The default is `~/.otto`, and worktree development uses `.otto`.
_Avoid_: OttoLegacy home, `~/.ottoLegacy`

## Product language

**Bot**:
A named teammate that has a profile, provider, tools, memory, workspaces, and routines.
_Avoid_: Agent when the text refers to the named teammate that the user configures

**Chat**:
The user-facing conversation with a bot. Use chat or conversation in interface copy and user documentation.
_Avoid_: Thread in user-facing text

**Thread**:
The internal durable record that stores one chat and its work history. Use this term only in source identifiers, contracts, architecture documentation, logs, and compatibility paths.
_Avoid_: Thread as a user-facing label

**Turn**:
One user request and the bot work that follows it inside a chat.
_Avoid_: Message when the complete request-to-result cycle is intended

**Project**:
An environment-local record rooted at a directory.
_Avoid_: Repository when the project can exist without Git

**Workspace**:
The files and execution context assigned to bot work. A workspace can be local or provided by a sandbox service.
_Avoid_: Project when the execution context is intended

**Environment**:
One running Otto server and the machine, filesystem, provider credentials, and state that it owns.
_Avoid_: Server when the user is choosing or managing the complete environment

**Provider**:
The bot runtime that Otto connects to, such as Codex, Claude, Grok, Kimi For Coding, or OpenCode.
_Avoid_: Model when the runtime or account connection is intended

**Routine**:
Saved bot work with a procedure and an optional schedule.
_Avoid_: Job, automation, task when the durable configured routine is intended

## Project rules

- Keep the MIT license and credit the Otto Legacy team and contributors for the original codebase.
- Use the `otto` desktop Chromium profile.
- Do not push, publish, or create a GitHub repository unless Leo asks.
