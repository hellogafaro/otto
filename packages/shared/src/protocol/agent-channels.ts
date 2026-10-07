import { RPC_CHANNELS as C } from './channels'

/**
 * The agent channel table (docs/final-plan.md PT): the only RPC channels an agent may call, through the `otto` CLI it
 * runs with bash (`otto <command> [args...]` -> `POST /api/agent/rpc`, `server-core/src/webui/agent-rpc.ts`). Separate
 * from the app's own channel list on purpose: a channel the UI gains is not an agent's until it is added here.
 *
 * Each call runs as the chat's user through the same membership guard, session guard and handler as the app's call,
 * in the chat's workspace: a channel whose first argument is a workspace gets the run's, the agent never names one.
 * The bundled `otto` skill (`apps/electron/resources/docs/otto.md`) is generated from this table.
 *
 * Arguments are positional, as the channel takes them: `<x>` is required, `[x]` optional. An argument that starts
 * with `{` or `[` is JSON, any other is a string, and `-` is read from stdin.
 */
export interface AgentCommand {
  channel: string
  args: readonly string[]
  summary: string
  /** Changes nothing (the Explore-mode bash rules let these through). */
  read?: true
  /** For a channel taking one object: the only keys an agent may set (the rest are dropped). */
  only?: readonly string[]
}

export const AGENT_COMMANDS = {
  'tasks list': { channel: C.tasks.LIST, args: ['[filter]'], read: true, summary: 'Tasks, newest change first. filter: {projectId?, status? ("todo"|"doing"|"done"|"archived", or a list), assignee? ("user:<id>"|"agent:<id>")}' },
  'tasks get': { channel: C.tasks.GET, args: ['<id>'], read: true, summary: 'One task, or null.' },
  'tasks create': { channel: C.tasks.CREATE, args: ['<task>'], summary: 'task: {projectId, title, description?, dueAt? (ms), assignees? (actors), resources? ([{type: "url"|"library"|"chat", title, ref}])}' },
  'tasks update': { channel: C.tasks.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {projectId, title, description, dueAt (ms|null), assignees (actors), resources, expectedUpdatedAt}. resources REPLACES the list: to add or remove a link, `otto tasks get <id>` and send its resources with the link added ({type: "url"|"library"|"chat", title, ref}) or removed.' },
  'tasks set-status': { channel: C.tasks.SET_STATUS, args: ['<id>', '<status>'], summary: 'status: todo, doing, done, archived or deleted.' },

  'projects list': { channel: C.projects.LIST, args: ['[filter]'], read: true, summary: 'Projects. filter: {status? ("active" by default, "archived", or a list)}' },
  'projects get': { channel: C.projects.GET, args: ['<id>'], read: true, summary: 'One project, or null.' },
  'projects create': { channel: C.projects.CREATE, args: ['<project>'], summary: 'project: {title, description?, resources?}' },
  'projects update': { channel: C.projects.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {title, description, resources, expectedUpdatedAt}. resources REPLACES the list: to add or remove a link, `otto projects get <id>` and send its resources with the link added ({type: "url"|"library"|"chat", title, ref}) or removed.' },

  'comments list': { channel: C.comments.GET, args: ['<entity>', '[page]'], read: true, summary: 'An entity\'s ("task:<id>", "project:<id>", ...) comments and activity events, oldest first: {items, more} (more = older items remain). An item\'s type is "comment" | "event"; an event has event = {kind, ...}. page: {before? (an item id), limit? (max 500)}' },
  'comments create': { channel: C.comments.CREATE, args: ['<entity>', '<content>'], summary: 'Adds a comment as you. A "user:<id>" token in the content notifies that member.' },

  'library list': { channel: C.library.LIST, args: ['[filter]'], read: true, summary: 'Library items (files, documents, folders). filter: {parentId? (a folder, null = the top), type? ("file"|"document"|"folder"), createdBy?}' },
  'library get': { channel: C.library.GET, args: ['<id>'], read: true, summary: 'One item\'s fields, or null.' },
  'library read': { channel: C.library.READ, args: ['<id>'], read: true, summary: 'An item with its content: {item, content: {encoding: "utf8" (documents) | "base64", data}}' },
  'library create': { channel: C.library.CREATE, args: ['<item>'], summary: 'item: {title, mime ("text/markdown" makes a document), content: {encoding: "utf8"|"base64", data}, parentId?}' },
  'library update': { channel: C.library.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {title, parentId, content}; replacing content needs expectedUpdatedAt (the item\'s updatedAt).' },

  'chats list': { channel: C.sessions.GET, args: [], read: true, summary: 'Your chats in this workspace (chats are private to their creator).' },
  'chats get': { channel: C.sessions.GET_MESSAGES, args: ['<id>', '[page]'], read: true, summary: 'A chat with a page of its messages. page: {limit? (max 500), beforeId?}' },
  'chats create': { channel: C.sessions.CREATE, args: ['[options]'], only: ['name', 'agentId', 'projectId', 'labels', 'sessionStatus', 'isFlagged'], summary: 'A new chat of yours. options: {name?, agentId? (default agent if left out), projectId?, labels?, sessionStatus?, isFlagged?}' },
  'chats send': { channel: C.sessions.SEND_MESSAGE, args: ['<id>', '<message>'], summary: 'Sends a message to another chat of yours (not this one); its agent answers there. Returns once the message is saved.' },
  'chats search': { channel: C.sessions.SEARCH_CONTENT, args: ['<query>'], read: true, summary: 'Your chats whose messages match the words.' },

  'labels list': { channel: C.labels.LIST, args: [], read: true, summary: 'The label tree (members read; owners change labels).' },
  'labels create': { channel: C.labels.CREATE, args: ['<label>'], summary: 'label: {name, color?, parentId?, valueType? ("string"|"number"|"date"|"link"), autoRules?}. See labels.md.' },
  'labels update': { channel: C.labels.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {name, color, valueType ("" = none), autoRules ([] = none)}; the id never changes.' },
  'labels move': { channel: C.labels.MOVE, args: ['<id>', '[parentId]'], summary: 'Moves a label under another (no parent = the top level).' },
  'labels reorder': { channel: C.labels.REORDER, args: ['<ids>', '[parentId]'], summary: 'Orders the children of one parent: ids is the JSON list of all of them.' },
  'labels delete': { channel: C.labels.DELETE, args: ['<id>'], summary: 'Deletes a label, its children and every chat\'s use of them.' },

  'statuses list': { channel: C.statuses.LIST, args: [], read: true, summary: 'The chat statuses (members read; owners change them).' },
  'statuses create': { channel: C.statuses.CREATE, args: ['<status>'], summary: 'status: {label, category ("open"|"closed"), color?, icon? (emoji or image data URL)}. See statuses.md.' },
  'statuses update': { channel: C.statuses.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {label, color, icon, category}.' },
  'statuses delete': { channel: C.statuses.DELETE, args: ['<id>'], summary: 'Deletes a status; its chats move to todo. todo, done, cancelled, archived and the default cannot go.' },
  'statuses reorder': { channel: C.statuses.REORDER, args: ['<ids>'], summary: 'ids: the JSON list of every status id in the new order.' },
  'statuses set-default': { channel: C.statuses.SET_DEFAULT, args: ['<id>'], summary: 'The status new chats get.' },

  'agents list': { channel: C.agents.LIST, args: [], read: true, summary: 'The workspace\'s agents; the oldest is the default.' },
  'agents get': { channel: C.agents.GET, args: ['<id>'], read: true, summary: 'One agent with its instructions, or null.' },
  'agents create': { channel: C.agents.CREATE, args: ['<agent>'], summary: 'agent: {title, instructions?, provider?, model?, thinkingLevel? ("off"|"low"|"medium"|"high"|"xhigh"|"max"), skills?, sources? ([] = all), avatar?}' },
  'agents update': { channel: C.agents.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of the create fields (lists replace). Its creator or a workspace owner only.' },
  'agents delete': { channel: C.agents.DELETE, args: ['<id>'], summary: 'Its chats move to the default agent; the last agent cannot go. Its creator or an owner only.' },

  'routines list': { channel: C.routines.LIST, args: [], read: true, summary: 'The workspace\'s routines with their recent runs.' },
  'routines get': { channel: C.routines.GET, args: ['<id>'], read: true, summary: 'One routine, or null.' },
  'routines create': { channel: C.routines.CREATE, args: ['<routine>'], summary: 'routine: {title, config, agentId?, paused?}. Read routines.md for config first.' },
  'routines update': { channel: C.routines.UPDATE, args: ['<id>', '<patch>'], summary: 'patch: any of {title, config (replaces it), agentId, paused}. A change makes the routine yours.' },
  'routines pause': { channel: C.routines.PAUSE, args: ['<id>'], summary: 'Stops it firing.' },
  'routines resume': { channel: C.routines.RESUME, args: ['<id>'], summary: 'Lets it fire again.' },
  'routines run': { channel: C.routines.RUN, args: ['<id>'], summary: 'One run now, as you, in the background; returns the run.' },
  'routines delete': { channel: C.routines.DELETE, args: ['<id>'], summary: 'Deletes it and its runs.' },

  'notifications list': { channel: C.notifications.GET, args: [], read: true, summary: 'Your notifications: mentions and assignments, newest first.' },
  'notifications count': { channel: C.notifications.GET_UNREAD_COUNT, args: [], read: true, summary: 'How many are unread.' },

  'search': { channel: C.search.RUN, args: ['<query>'], read: true, summary: 'One search over tasks, projects, comments, library documents and your chats.' },
} as const satisfies Record<string, AgentCommand>

export type AgentCommandName = keyof typeof AGENT_COMMANDS

/** The command an argv starts with (two words, else one) and the arguments after it, or null. */
export function getAgentCommand(argv: readonly string[]): { name: AgentCommandName; command: AgentCommand; args: string[] } | null {
  for (const words of [2, 1]) {
    const name = argv.slice(0, words).join(' ')
    if (argv.length >= words && Object.hasOwn(AGENT_COMMANDS, name)) {
      return { name: name as AgentCommandName, command: AGENT_COMMANDS[name as AgentCommandName], args: argv.slice(words) }
    }
  }
  return null
}

/** One usage line per command: what `otto help` prints and the skill lists. */
export function formatAgentCommands(): string {
  return Object.entries(AGENT_COMMANDS as Record<string, AgentCommand>)
    .map(([name, command]) => `otto ${[name, ...command.args].join(' ')}\n    ${command.summary}`)
    .join('\n')
}
