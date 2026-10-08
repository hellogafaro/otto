import { createTool, type Tool } from '@mastra/core/tools'
import { SESSION_TOOL_REGISTRY, CallLlmSchema, type SessionToolContext } from '@otto/session-tools-core'

export const MASTRA_SESSION_WRITES = new Set(['set_session_labels', 'set_session_status', 'permissions_edit', 'source_credential_prompt'])

export function createMastraSessionTools(input: {
  context: SessionToolContext
  writesAllowed: boolean
  decideEnabled: boolean
  assertAccess: () => void
  complete: (prompt: string) => Promise<string>
  spawn: (args: { prompt?: string; name?: string; help?: boolean; permissionMode?: 'safe' | 'ask' | 'guarded' | 'allow-all'; model?: string; llmConnection?: string; enabledSourceSlugs?: string[] }) => Promise<unknown>
  testSource: (slug: string, activate: boolean) => Promise<unknown>
}) {
  const tools: Record<string, Tool<any>> = {}
  for (const name of ['get_session_info', 'list_sessions', 'set_session_labels', 'set_session_status', 'permissions_edit', 'mermaid_validate', 'source_credential_prompt', ...(input.decideEnabled ? ['decide'] : [])]) {
    if (!input.writesAllowed && MASTRA_SESSION_WRITES.has(name)) continue
    const def = SESSION_TOOL_REGISTRY.get(name)!
    const id = `mcp__session__${name}`
    tools[id] = createTool({
      id, description: def.description, inputSchema: def.inputSchema,
      execute: async (args) => {
        input.assertAccess()
        if (JSON.stringify(args).length > 64000) throw new Error('The session-tool input exceeds the native limit.')
        const result = await def.handler!(input.context, args)
        input.assertAccess()
        return result
      },
    })
  }
  tools.mcp__session__call_llm = createTool({
    id: 'mcp__session__call_llm', description: 'Ask the current API-key model to process bounded text without tools. Put reference text in prompt; file paths are not accepted.',
    inputSchema: CallLlmSchema.omit({ attachments: true, model: true, systemPrompt: true, thinking: true, thinkingBudget: true, outputFormat: true, outputSchema: true, temperature: true, maxTokens: true }).strict(),
    execute: async ({ prompt }) => { input.assertAccess(); if (Buffer.byteLength(prompt) > 64000) throw new Error('Completion input exceeds the native limit.'); return input.complete(prompt) },
  })
  tools.mcp__session__source_test = createTool({
    id: 'mcp__session__source_test', description: 'Test an existing authorized remote source using its configured bounded test endpoint or MCP discovery. Optionally activate it for the next turn; this does not expand agent source permissions.',
    inputSchema: SESSION_TOOL_REGISTRY.get('source_test')!.inputSchema,
    execute: async (args) => { input.assertAccess(); const parsed = SESSION_TOOL_REGISTRY.get('source_test')!.inputSchema.parse(args) as { sourceSlug: string; autoEnable?: boolean }; return input.testSource(parsed.sourceSlug, parsed.autoEnable !== false) },
  })
  if (input.writesAllowed) tools.mcp__session__spawn_session = createTool({
    id: 'mcp__session__spawn_session', description: 'Create an independent child chat with the same creator and agent. Its permission mode cannot be looser and its authorized sources cannot expand. Tool permissions still apply in the child.',
    inputSchema: SESSION_TOOL_REGISTRY.get('spawn_session')!.inputSchema.omit({ attachments: true, workingDirectory: true, labels: true, thinkingLevel: true }).strict(),
    execute: async (args) => { input.assertAccess(); return input.spawn(args) },
  })
  return tools
}
