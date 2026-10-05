type CatalogEntry = {
  id: string
  title: string
  category: 'ai'
  auth: 'api-key' | 'oauth-code' | 'oauth-device' | 'none'
  baseUrl?: string
}

/** The connection types Otto supports; `baseUrl` is the default endpoint. */
export const CONNECTION_CATALOG = [
  { id: 'anthropic', title: 'Anthropic', category: 'ai', auth: 'api-key', baseUrl: 'https://api.anthropic.com' },
  { id: 'claude', title: 'Claude subscription', category: 'ai', auth: 'oauth-code' },
  { id: 'openai', title: 'OpenAI', category: 'ai', auth: 'api-key', baseUrl: 'https://api.openai.com/v1' },
  { id: 'chatgpt', title: 'ChatGPT', category: 'ai', auth: 'oauth-device' },
  { id: 'copilot', title: 'GitHub Copilot', category: 'ai', auth: 'oauth-device' },
  { id: 'openrouter', title: 'OpenRouter', category: 'ai', auth: 'api-key', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', title: 'Ollama', category: 'ai', auth: 'none', baseUrl: 'http://localhost:11434' },
  { id: 'custom', title: 'Custom endpoint', category: 'ai', auth: 'api-key' },
] as const satisfies readonly CatalogEntry[]

export type ConnectionType = (typeof CONNECTION_CATALOG)[number]['id']

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return CONNECTION_CATALOG.find((entry) => entry.id === type)
}
