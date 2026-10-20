import * as Schema from "effect/Schema";

/**
 * The one mention rule. Loaded with the task and Library tools, so a turn that can
 * name one of them is told to paste the tag the tool returned.
 */
export const MENTION_RULE =
  'When you refer to a person, task, project or Library file, paste the mention tag a tool returned. It is `<mention type="task" id="…">Title</mention>`, in the result\'s `mention` field (`projectMention` for the task\'s project). That tag is the only mention. `path` is an in-app address, not a link. Never invent a URL.';

export const OttoToolId = Schema.Literals([
  "shell",
  "read",
  "edit",
  "search",
  "bot_create",
  "delegate_check",
  "delegate_stop",
  "delegate",
  "message_post",
  "connection_search",
  "connection_read",
  "connection_create",
  "connection_update",
  "connection_check",
  "connection_delete",
  "message_react",
  "bot_update",
  "web_search",
  "web_fetch",
  "image_create",
  "audio_transcribe",
  "library_create",
  "library_read",
  "library_update",
  "library_share",
  "library_unshare",
  "skill_read",
  "skill_create",
  "skill_update",
  "task_read",
  "task_create",
  "task_update",
  "task_delete",
  "task_comment_create",
  "task_comment_list",
  "task_comment_update",
  "task_comment_delete",
  "task_time_create",
  "task_time_delete",
  "task_time_list",
]);

export type OttoToolId = typeof OttoToolId.Type;

export const OttoToolApprovalClass = Schema.Literals([
  "none",
  "user-computer",
  "send",
  "pay",
  "delete",
  "production",
  "secrets",
]);

export type OttoToolApprovalClass = typeof OttoToolApprovalClass.Type;

export const OttoProtectedApprovalClass = Schema.Literals([
  "send",
  "pay",
  "delete",
  "production",
  "secrets",
]);

export type OttoProtectedApprovalClass = typeof OttoProtectedApprovalClass.Type;

export const OTTO_PROTECTED_APPROVAL_CLASSES: ReadonlySet<OttoProtectedApprovalClass> = new Set([
  "send",
  "pay",
  "delete",
  "production",
  "secrets",
]);

export const OttoToolCapability = Schema.Literals(["bot-workspace"]);

export type OttoToolCapability = typeof OttoToolCapability.Type;

export const OttoToolWorkspaceType = Schema.Literals(["none", "local", "cloud"]);

export type OttoToolWorkspaceType = typeof OttoToolWorkspaceType.Type;

export type OttoToolWorkspaceRequirement = "none" | "bot-workspace";

export interface OttoToolDefinition {
  readonly id: OttoToolId;
  readonly description: string;
  readonly capability: OttoToolCapability;
  readonly workspace: OttoToolWorkspaceRequirement;
  readonly approval: OttoToolApprovalClass;
  /** One line for the prompt's tool list; a tool without one is left off it. */
  readonly promptSnippet?: string;
  /** Rules the prompt adds while this tool is loaded. */
  readonly promptGuidelines?: ReadonlyArray<string>;
}

const define = (
  id: OttoToolId,
  capability: OttoToolCapability,
  description: string,
  options: Partial<
    Pick<OttoToolDefinition, "workspace" | "approval" | "promptSnippet" | "promptGuidelines">
  > = {},
): OttoToolDefinition => ({
  id,
  capability,
  description,
  workspace: options.workspace ?? "none",
  approval: options.approval ?? "none",
  ...(options.promptSnippet ? { promptSnippet: options.promptSnippet } : {}),
  ...(options.promptGuidelines ? { promptGuidelines: options.promptGuidelines } : {}),
});

export const OTTO_TOOL_CATALOG = [
  define(
    "shell",
    "bot-workspace",
    "Run a bash command in your computer, a sandbox that keeps files between chats but can be wiped. " +
      "Use it for code, files, git, CLIs, installs and driving a browser. Returns the exit code and output.",
    {
      workspace: "bot-workspace",
      promptSnippet: "run bash in your computer, including a browser CLI",
    },
  ),
  define(
    "read",
    "bot-workspace",
    "Read a file in your computer: text with line numbers, or an image you can see. " +
      "Read-only; use offset and limit for long files.",
    { workspace: "bot-workspace", promptSnippet: "read a file, or see an image, in your computer" },
  ),
  define(
    "edit",
    "bot-workspace",
    "Change a file in your computer by replacing exact text: each oldText must match once, including whitespace. " +
      "Use it for code and config edits; write new files with shell. " +
      "Returns the changed line ranges, or which oldText did not match and how often.",
    { workspace: "bot-workspace", promptSnippet: "replace exact text in a file in your computer" },
  ),
  define(
    "search",
    "bot-workspace",
    "Find or list tasks, Library files, chat messages and your routines: by words, ranked best first, " +
      "or with no words, newest first. Filters narrow tasks (status, assignee, project, due) and files (folder). " +
      "Read-only; returns type, title, snippet and id for what you and everyone in this chat may see.",
    { promptSnippet: "find or list tasks, files, messages and your routines" },
  ),
  define("bot_create", "bot-workspace", "Create a new named bot. Returns its botId."),
  define(
    "delegate_check",
    "bot-workspace",
    "Status of the work you handed a bot: running, done with its result, failed or stopped. " +
      "A finished result read here counts as delivered and is not repeated in your next turn.",
  ),
  define("delegate_stop", "bot-workspace", "Stop the work you handed a bot. It ends as stopped."),
  define(
    "delegate",
    "bot-workspace",
    "Hand bounded work to another bot, which runs it with its own tools and settings. " +
      "The result arrives in your next turn; follow it with delegate_check.",
    {
      promptSnippet: "hand work to another bot",
      promptGuidelines: [
        "Brief it like a teammate: the bounded goal, what done looks like, how to prove it, and what not to touch.",
      ],
    },
  ),
  define(
    "message_post",
    "bot-workspace",
    "Post a message where you were asked: the chat, or the task's activity when a task woke you. " +
      "Use it for a short reply, a one-line status, or a question people should see. " +
      "If you post an update, post the result before you stop. If you post nothing, the closing text is posted for you. " +
      "A closing answer left unposted after an update is still sent when the turn completes. " +
      "Attach any file from your computer by path (images, videos, PDFs, office files, archives), up to 100 MB each. " +
      "Returns the message id.",
    { promptSnippet: "post a reply, update or question where you were asked" },
  ),
  define(
    "connection_search",
    "bot-workspace",
    "Search the plugin catalog and connected providers for a capability you lack. " +
      "Read-only, and it needs a query. It does not ask the person to connect anything.",
  ),
  define(
    "connection_read",
    "bot-workspace",
    "Show one plugin or MCP server by id: connection, permissions, health and dependents. Read-only.",
  ),
  define(
    "connection_create",
    "bot-workspace",
    "Install a catalog plugin by pluginId, or add a remote MCP server by url and title. " +
      "A person approves it. Returns the new connection and any sign-in step.",
    { approval: "secrets" },
  ),
  define(
    "connection_update",
    "bot-workspace",
    "Rename an MCP server or replace its instructions for bots; null keeps a field. A person approves it.",
    { approval: "secrets" },
  ),
  define(
    "connection_check",
    "bot-workspace",
    'Test a connection, reconnect it, or start sign-in with action "authenticate". ' +
      "Returns its status and any authorization link to give the person.",
  ),
  define(
    "connection_delete",
    "bot-workspace",
    "Remove a plugin or MCP server and its account. A person approves it.",
    { approval: "delete" },
  ),
  define("message_react", "bot-workspace", "Add or remove an emoji reaction on a visible message."),
  define(
    "bot_update",
    "bot-workspace",
    "Change your name, title, description or instructions; null keeps a field. " +
      "Instructions change only after a person in the chat approves them.",
  ),
  define("web_search", "bot-workspace", "Search the public web.", {
    promptSnippet: "search the public web",
  }),
  define(
    "web_fetch",
    "bot-workspace",
    "Fetch the text of a public URL. A long page comes in parts; pass offset to read on.",
    { promptSnippet: "read a public web page" },
  ),
  define(
    "image_create",
    "bot-workspace",
    "Generate a new image, or edit images from this chat, with the image provider the user configured. " +
      'Use operation "generate" with a prompt, or operation "edit" with a prompt and optional inputImages ' +
      "(attachment ids from this chat; defaults to the images on the latest user message). " +
      "Finished images appear in the chat automatically; do not repeat or describe the file data. " +
      'If the result status is "needs-consent", ask the user before retrying with allowProvider.',
    { promptSnippet: "create or edit images" },
  ),
  define(
    "audio_transcribe",
    "bot-workspace",
    "Transcribe an audio or video file, by path on your computer or Library fileId, with the workspace's " +
      "transcription provider. Optional language is an ISO-639-1 code. Saves the full transcript as <name>.txt " +
      "beside the source and returns its path or fileId with the text.",
    { promptSnippet: "transcribe audio or video files" },
  ),
  define(
    "library_create",
    "bot-workspace",
    "Save an artifact to the Otto Library, the workspace's shared folders and files. " +
      "Pass markdown content to save a .md document (titled after its first # heading unless you give a title), " +
      'text content with a fileName such as "report.csv" for another text file, or attachmentId to save a file from this chat. ' +
      "It goes into this chat's Library folder, which only the chat's people see, unless you pass a folderId from search.",
    {
      promptSnippet: "save a document or file to the Library, the workspace's shared files",
      promptGuidelines: [MENTION_RULE],
    },
  ),
  define(
    "library_read",
    "bot-workspace",
    "Read one Library file: its details, and the text of a document or text file up to 1 MB. " +
      "Keep the returned updatedAt to edit a document with library_update.",
    { promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "library_update",
    "bot-workspace",
    "Replace a Library document's markdown, and optionally its title. Pass the updatedAt library_read returned; " +
      "if someone changed the document since, the save is rejected, so read it again and merge. Only a document's creator can edit it.",
    { promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "library_share",
    "bot-workspace",
    "Publish a Library file you created at a public link anyone can open without signing in, and return the link. " +
      "The link serves a copy frozen now; after editing the file, share it again to update that copy at the same link. " +
      "Only share when a person asks to make the file public.",
    { approval: "send", promptSnippet: "share a Library file at a public link" },
  ),
  define(
    "library_unshare",
    "bot-workspace",
    "Remove a Library file's public link: its frozen copy is deleted and the link stops working.",
  ),
  define(
    "skill_read",
    "bot-workspace",
    "Read a file from a skill in <available_skills>, by name for a built-in skill or by skillId: " +
      "SKILL.md by default, or a path such as references/guide.md. " +
      "Text files up to 1 MB. Scripts in a skill are references to read; Otto never runs them.",
    {
      promptGuidelines: [
        "When a request matches one of <available_skills>, or a loaded skill would do the job better, read its SKILL.md with skill_read first and follow it. That includes a visual or a long text. Never invent a skill name.",
        "For heavy or long work of any kind, run the loop: investigate or research, the skill that does the work, verify, review, then deliver.",
      ],
    },
  ),
  define(
    "skill_create",
    "bot-workspace",
    "Propose a new skill, a repeatable procedure for you and other bots. Use it when the same kind of " +
      "request has come up two or three times, when a routine's instructions hold a procedure, or when " +
      "asked; not for one-off work, facts (memory) or secrets. A person approves it in the chat. " +
      "Returns the skill id, or why it was not saved.",
  ),
  define(
    "skill_update",
    "bot-workspace",
    "Propose a fix to a Library skill in <available_skills> when a step was wrong, outdated or corrected " +
      "by a person. Built-in skills can't be changed. Pass the updatedAt skill_read returned for its " +
      "SKILL.md. A person approves it in the chat.",
  ),
  define(
    "task_read",
    "bot-workspace",
    "Read one task: every field, its links, the people involved with their participant keys, " +
      "its latest 10 comments with commentCount, its latest 10 time entries with totalMinutes, " +
      "and its latest changes. Use task_comment_list and task_time_list for the rest.",
    {
      promptGuidelines: [
        "When a task wakes you, <task> and <task-update> show that task as it is now, and the text in <comment> is that person's own words; use task_read for other tasks. Your final reply in a task's chat is posted on the task as your comment, so write it for the people on the task and don't post it again with task_comment_create.",
        MENTION_RULE,
      ],
    },
  ),
  define(
    "task_create",
    "bot-workspace",
    "Create a task on the Tasks page. It goes into this chat's project unless you pass a " +
      'projectId. Assign it with the people keys from your workspace context, or "me". ' +
      "Any field can be set, including completed status and the owner, who must be a person. " +
      "If anything is invalid, nothing is created and the error lists each invalid field.",
    { promptSnippet: "create a task", promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "task_update",
    "bot-workspace",
    "Change any field of a task. Leaving a field out keeps its current value. Passing null " +
      "clears it, where allowed. The call applies every change or none of them; if anything is " +
      "invalid, the error lists each invalid field and nothing changes.",
    { promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "task_delete",
    "bot-workspace",
    "Permanently delete a task with its comments, time entries and history. This can't be " +
      "undone; to keep the record, set status to cancelled or archived instead. Library files " +
      "it links to stay in the Library, and other tasks lose their link to it. Returns the " +
      "deleted taskIds.",
  ),
  define(
    "task_comment_create",
    "bot-workspace",
    "Post a comment on a task as yourself. Use it to report progress or answer someone on the " +
      "task.",
    { promptSnippet: "comment on a task", promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "task_comment_list",
    "bot-workspace",
    "List every comment on a task, with pagination. Use cursor to read past the first page.",
    { promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "task_comment_update",
    "bot-workspace",
    "Replace the text of a comment you wrote. You can't edit anyone else's comment. The task " +
      "history keeps the previous text.",
    { promptGuidelines: [MENTION_RULE] },
  ),
  define(
    "task_comment_delete",
    "bot-workspace",
    "Delete any comment on a task, whoever wrote it. The task history keeps its text.",
  ),
  define(
    "task_time_create",
    "bot-workspace",
    "Log time on a task for a person. Entries can't be edited; to fix one, delete it with " +
      "task_time_delete and create it again.",
  ),
  define(
    "task_time_delete",
    "bot-workspace",
    "Permanently delete one time entry. The task history records who deleted it and what it said.",
  ),
  define(
    "task_time_list",
    "bot-workspace",
    "List time entries, newest first, with totalMinutes across every matching entry. Give a " +
      "taskId for one task, or a person and dates to build a timesheet across tasks.",
  ),
] satisfies ReadonlyArray<OttoToolDefinition>;

/**
 * Tools a bot needs now and then. Models with a native tool search load them on demand;
 * the prompt lists each family in one line on every model.
 */
export const OTTO_TOOL_FAMILIES = [
  {
    name: "connections",
    description: "Find, add, check and remove the apps and MCP servers this bot can use.",
    tools: [
      "connection_search",
      "connection_read",
      "connection_create",
      "connection_update",
      "connection_check",
      "connection_delete",
    ],
  },
  {
    name: "images",
    description: "Create images, or new images from images in this chat.",
    tools: ["image_create"],
  },
  {
    name: "audio",
    description: "Transcribe audio and video files.",
    tools: ["audio_transcribe"],
  },
  {
    name: "delegation",
    description: "Hand work to another bot and follow it.",
    tools: ["delegate", "delegate_check", "delegate_stop"],
  },
  {
    name: "tasks",
    description:
      "Delete tasks, list, edit and delete their comments, and log, list and delete time.",
    tools: [
      "task_delete",
      "task_comment_list",
      "task_comment_update",
      "task_comment_delete",
      "task_time_create",
      "task_time_delete",
      "task_time_list",
    ],
  },
  {
    name: "bot",
    description:
      "Change your own profile or instructions, create a bot, react to a message, or propose a skill.",
    tools: ["bot_update", "bot_create", "message_react", "skill_create", "skill_update"],
  },
] as const satisfies ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly tools: ReadonlyArray<OttoToolId>;
}>;
