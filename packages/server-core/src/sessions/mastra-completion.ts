import { createMastraChatModel, streamMastraChat } from './mastra-chat'

export async function runMastraCompletion(input: {
  apiKey: string
  provider?: string
  api?: string
  model: string
  baseUrl?: string
  prompt: string
  signal?: AbortSignal
  assertAccess?: () => void
}): Promise<string> {
  let text = ''
  input.assertAccess?.()
  if (Buffer.byteLength(input.prompt) > 64000) throw new Error('Native completion input exceeds 64 KiB.')
  for await (const event of streamMastraChat({
    agentId: 'completion',
    name: 'Completion',
    instructions: 'Return only the requested result.',
    messages: [{ role: 'user', content: input.prompt }],
    model: createMastraChatModel({
      provider: input.provider ?? 'openai',
      api: input.api,
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    }),
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  }))
    if (event.type === 'text_complete' && !event.isIntermediate)
      text = event.text
  input.assertAccess?.()
  if (!text.trim()) throw new Error('Native completion returned no result.')
  return text.trim()
}
