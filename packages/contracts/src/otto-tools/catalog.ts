import * as Schema from "effect/Schema";

export const OttoToolId = Schema.Literals([
  "shell",
  "read",
  "bot_create",
  "delegate_check",
  "MessageAgent",
  "delegate_stop",
  "delegate",
  "message_post",
  "connection_search",
  "GetPlugin",
  "message_react",
  "InstallPlugin",
  "UninstallPlugin",
  "GetMcpServerStatus",
  "TestMcpServer",
  "ReconnectMcpServer",
  "bot_update",
  "AuthenticateMcpServer",
  "RestartMcpServers",
  "web_search",
  "web_fetch",
  "image_create",
  "library_create",
  "ListLibrary",
  "library_read",
  "library_update",
  "ListSkills",
  "skill_read",
  "ListTasks",
  "task_read",
  "task_create",
  "task_update",
  "task_comment",
  "AddMcpServer",
  "UninstallMcpServer",
  "RemoveMcpAccount",
  "RenameMcpAccount",
  "SetMcpInstructions",
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
  define("shell", "bot-workspace", "Run a command in the bot workspace.", {
    workspace: "bot-workspace",
    promptSnippet: "run commands in your workspace",
  }),
  define("read", "bot-workspace", "Read a file in the bot workspace.", {
    workspace: "bot-workspace",
    promptSnippet: "read a file in your workspace",
  }),
  define("bot_create", "bot-workspace", "Create a durable named bot."),
  define(
    "delegate_check",
    "bot-workspace",
    "Inspect a durable named bot and its delegated work. A finished result returned here counts as delivered and is not repeated in your next turn.",
  ),
  define(
    "MessageAgent",
    "bot-workspace",
    "Send bounded work to a durable named bot. Returns a handle at once; the result arrives in your next turn.",
    {
      approval: "send",
    },
  ),
  define("delegate_stop", "bot-workspace", "Cancel a durable bot's delegated work.", {
    approval: "delete",
  }),
  define(
    "delegate",
    "bot-workspace",
    "Delegate a task to another bot. Returns a handle at once; the result arrives in your next turn.",
    {
      approval: "send",
      promptSnippet: "hand work to another bot",
    },
  ),
  define(
    "message_post",
    "bot-workspace",
    "Post a message where you were asked: the chat, or the task's activity when a task woke you. " +
      "Use it for the reply, a progress update or a question people should see; your final text stays private, " +
      "and if you post nothing it is posted for you. Returns the message id.",
    { promptSnippet: "post a reply, update or question where you were asked" },
  ),
  define(
    "connection_search",
    "bot-workspace",
    "Search available plugins and connected integration providers when the user needs a capability that is not installed.",
  ),
  define(
    "GetPlugin",
    "bot-workspace",
    "Inspect a plugin, its connection, permissions, health, and dependents.",
  ),
  define(
    "message_react",
    "bot-workspace",
    "Add or remove an emoji reaction on a visible message.",
    { approval: "send" },
  ),
  define("InstallPlugin", "bot-workspace", "Install a curated plugin after inspecting it.", {
    approval: "production",
  }),
  define("UninstallPlugin", "bot-workspace", "Remove a curated plugin after inspecting it.", {
    approval: "delete",
  }),
  define("GetMcpServerStatus", "bot-workspace", "Inspect an MCP server connection."),
  define("TestMcpServer", "bot-workspace", "Run a real MCP server connection test.", {
    approval: "production",
  }),
  define("ReconnectMcpServer", "bot-workspace", "Reconnect one MCP server.", {
    approval: "production",
  }),
  define("bot_update", "bot-workspace", "Update this bot's public profile."),
  define("AuthenticateMcpServer", "bot-workspace", "Authenticate an MCP server.", {
    approval: "secrets",
  }),
  define("RestartMcpServers", "bot-workspace", "Restart MCP servers.", {
    approval: "production",
  }),
  define("web_search", "bot-workspace", "Search the public web.", {
    promptSnippet: "search the public web",
  }),
  define("web_fetch", "bot-workspace", "Fetch and extract a public URL.", {
    promptSnippet: "read a public web page",
  }),
  define(
    "image_create",
    "bot-workspace",
    "Generate a new image, or edit images from this chat, with the image provider the user configured. " +
      'Use operation "generate" with a prompt, or operation "edit" with a prompt and optional inputImages ' +
      "(attachment ids from this chat; defaults to the images on the latest user message). " +
      "Finished images appear in the chat automatically; do not repeat or describe the file data. " +
      'If the result status is "needs-consent", ask the user before retrying with allowProvider.',
    { approval: "production", promptSnippet: "create or edit images" },
  ),
  define(
    "library_create",
    "bot-workspace",
    "Save an artifact to the Otto Library, the workspace's shared folders and files. " +
      "Pass markdown content to save a .md document (titled after its first # heading unless you give a title), " +
      'text content with a fileName such as "report.csv" for another text file, or attachmentId to save a file from this chat. ' +
      "It goes into this chat's Library folder, which only the chat's people see, unless you pass a folderId from ListLibrary.",
    { promptSnippet: "save a document or file to the Library, the workspace's shared files" },
  ),
  define(
    "ListLibrary",
    "bot-workspace",
    "List the Library folders and files you can see, newest first. Filter by folderId, type " +
      '("document", "image", "pdf" or "file") or a title query.',
    { promptSnippet: "find Library files" },
  ),
  define(
    "library_read",
    "bot-workspace",
    "Read one Library file: its details, and the text of a document or text file up to 1 MB. " +
      "Keep the returned updatedAt to edit a document with library_update.",
  ),
  define(
    "library_update",
    "bot-workspace",
    "Replace a Library document's markdown, and optionally its title. Pass the updatedAt library_read returned; " +
      "if someone changed the document since, the save is rejected, so read it again and merge. Only a document's creator can edit it.",
  ),
  define(
    "ListSkills",
    "bot-workspace",
    "List the skills you can use: reusable instructions people saved in the Library's Skills folder, " +
      "each with a name, a description of when it applies, and its files. " +
      "Check it when a request might match one, then read the skill's SKILL.md with skill_read and follow it.",
  ),
  define(
    "skill_read",
    "bot-workspace",
    "Read a file from a skill ListSkills returned: SKILL.md by default, or a path such as references/guide.md. " +
      "Text files up to 1 MB. Scripts in a skill are references to read; Otto never runs them.",
    {
      promptGuidelines: [
        "When a request matches one of <available_skills>, read its SKILL.md with skill_read first and follow it.",
      ],
    },
  ),
  define(
    "ListTasks",
    "bot-workspace",
    "List the organization's tasks (the Tasks page, not your own subagent work), most recently " +
      'updated first. Filter by projectId, status, assignee ("me" for tasks assigned to you, ' +
      'or a participant key such as "person:…") or a title query. Archived tasks only show when ' +
      "you ask for that status. It also lists every project with its projectId and every person " +
      "with their key, for task_create and task_update.",
    { promptSnippet: "find tasks, people and projects" },
  ),
  define(
    "task_read",
    "bot-workspace",
    "Read one task: its fields, description, links, the people involved with their participant " +
      "keys, and its latest comments and changes.",
  ),
  define(
    "task_create",
    "bot-workspace",
    "Create a task on the Tasks page. It goes into this chat's project unless you pass a " +
      'projectId (ListTasks lists them). Assign it with participant keys from ListTasks, or "me". ' +
      "Only people mark tasks completed, and the owner is left for a person to set.",
    { promptSnippet: "create a task" },
  ),
  define(
    "task_update",
    "bot-workspace",
    "Change a task's title, description, status, due date (null clears it), project or " +
      "assignees; fields you leave out stay as they are. You can't mark a task completed or " +
      "change its owner; ask a person to.",
  ),
  define(
    "task_comment",
    "bot-workspace",
    "Post a comment on a task's activity as yourself, in plain text. Use it to report progress " +
      "or answer someone on the task.",
    { promptSnippet: "comment on a task" },
  ),
  define("AddMcpServer", "bot-workspace", "Add an MCP server account.", { approval: "secrets" }),
  define("UninstallMcpServer", "bot-workspace", "Remove an MCP server.", { approval: "delete" }),
  define("RemoveMcpAccount", "bot-workspace", "Remove an MCP account.", { approval: "delete" }),
  define("RenameMcpAccount", "bot-workspace", "Rename an MCP account.", { approval: "secrets" }),
  define("SetMcpInstructions", "bot-workspace", "Set MCP account instructions.", {
    approval: "secrets",
  }),
] satisfies ReadonlyArray<OttoToolDefinition>;
