import { createMastraChatModel, streamMastraChat } from './mastra-chat'

export async function runMastraCompletion(input: {
  apiKey: string
  model: string
  baseUrl?: string
  prompt: string
}): Promise<string> {
  let text = ''
  for await (const event of streamMastraChat({
    agentId: 'completion',
    name: 'Completion',
    instructions: 'Return only the requested result.',
    messages: [{ role: 'user', content: input.prompt }],
    model: createMastraChatModel({
      provider: 'openai',
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    }),
    signal: AbortSignal.timeout(20000),
  }))
    if (event.type === 'text_complete' && !event.isIntermediate)
      text = event.text
  if (!text.trim()) throw new Error('Native completion returned no result.')
  return text.trim()
}
