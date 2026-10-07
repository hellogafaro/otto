import { describe, expect, it } from 'bun:test'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import type { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider-v5'
import { z } from 'zod'
import type { AgentEvent } from '@otto/core/types'
import { createMastraChatModel, streamMastraChat } from './mastra-chat.ts'

const usage = { inputTokens: 12, outputTokens: 4, totalTokens: 16 }

function fixtureModel(parts: (call: number) => LanguageModelV2StreamPart[]): LanguageModelV2 {
  let calls = 0
  return {
    specificationVersion: 'v2',
    provider: 'controlled-fixture',
    modelId: 'fixture',
    supportedUrls: {},
    doGenerate: async () => { throw new Error('stream only') },
    doStream: async () => ({ stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        for (const part of parts(calls++)) controller.enqueue(part)
        controller.close()
      },
    }) }),
  }
}

describe('native Mastra on Bun, controlled model fixtures', () => {
  it('streams existing UI events and reports usage without a memory store', async () => {
    const events: AgentEvent[] = []
    for await (const event of streamMastraChat({
      agentId: 'agentaaaaaaa', name: 'Scout', instructions: 'Be brief.',
      messages: [{ role: 'user', content: 'Draft a brief.' }], signal: new AbortController().signal,
      model: fixtureModel(() => [
        { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'A project brief.' },
        { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop', usage },
      ]),
    })) events.push(event)
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'text_complete', 'complete'])
    expect(events[1]).toMatchObject({ text: 'A project brief.' })
    expect(events[2]).toMatchObject({ usage: { inputTokens: 12, outputTokens: 4 } })
  })

  it('executes a native schema-validated tool and continues the model loop', async () => {
    const writes: string[] = []
    const agent = new Agent({
      id: 'agentbbbbbbb', name: 'Writer', instructions: 'Draft a brief.',
      model: fixtureModel((call) => call === 0 ? [
        { type: 'tool-call', toolCallId: 'call1', toolName: 'save_brief', input: JSON.stringify({ title: 'Launch brief' }) },
        { type: 'finish', finishReason: 'tool-calls', usage },
      ] : [
        { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Saved.' },
        { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop', usage },
      ]),
      tools: { save_brief: createTool({
        id: 'save_brief', description: 'Save a brief.', inputSchema: z.object({ title: z.string() }),
        execute: async ({ title }) => { writes.push(title); return { saved: title } },
      }) },
    })
    const output = await agent.stream('Write the brief.', { maxSteps: 2 })
    await output.consumeStream()
    expect(writes).toEqual(['Launch brief'])
    expect(await output.text).toBe('Saved.')
  })

  it('keeps commentary, tool activity and the final response in step order', async () => {
    const events: AgentEvent[] = []
    const tools = { save_brief: createTool({
      id: 'save_brief', description: 'Save the brief.', inputSchema: z.object({ title: z.string() }),
      execute: async () => ({ id: 'document0001' }),
    }) }
    for await (const event of streamMastraChat({
      agentId: 'agentaaaaaaa', name: 'Scout', instructions: '', messages: [{ role: 'user', content: 'Draft a brief.' }],
      signal: new AbortController().signal, tools,
      model: fixtureModel((call) => call === 0 ? [
        { type: 'text-start', id: 'commentary' }, { type: 'text-delta', id: 'commentary', delta: "I'll draft it." }, { type: 'text-end', id: 'commentary' },
        { type: 'tool-call', toolCallId: 'call1', toolName: 'save_brief', input: JSON.stringify({ title: 'Brief' }) },
        { type: 'finish', finishReason: 'tool-calls', usage },
      ] : [
        { type: 'text-start', id: 'final' }, { type: 'text-delta', id: 'final', delta: 'Saved.' }, { type: 'text-end', id: 'final' },
        { type: 'finish', finishReason: 'stop', usage },
      ]),
    })) events.push(event)
    const commentary = events.findIndex((event) => event.type === 'text_complete' && event.isIntermediate === true)
    const tool = events.findIndex((event) => event.type === 'tool_start')
    const result = events.findIndex((event) => event.type === 'tool_result')
    const final = events.findIndex((event) => event.type === 'text_complete' && !event.isIntermediate)
    expect(commentary).toBeLessThan(tool)
    expect(tool).toBeLessThan(result)
    expect(result).toBeLessThan(final)
    expect(events[commentary]).toMatchObject({ text: "I'll draft it.", isIntermediate: true })
    expect(events[final]).toMatchObject({ text: 'Saved.' })
    const before = events[commentary]
    const after = events[final]
    if (before.type !== 'text_complete' || after.type !== 'text_complete') throw new Error('Missing text boundaries')
    expect(before.turnId).not.toBe(after.turnId)
  })

  it('discards partial text when a provider reports an error', async () => {
    const events: AgentEvent[] = []
    const stream = streamMastraChat({
      agentId: 'agentaaaaaaa', name: 'Scout', instructions: '', messages: [{ role: 'user', content: 'Hi' }],
      signal: new AbortController().signal,
      model: fixtureModel(() => [{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'unfinished' }, { type: 'error', error: new Error('fixture failure') }]),
    })
    await expect((async () => { for await (const event of stream) events.push(event) })()).rejects.toThrow()
    expect(events.some((event) => event.type === 'text_complete')).toBe(false)
    expect(events.at(-1)?.type).toBe('text_discard')
  })

  it('honors cancellation before publishing a completed message', async () => {
    const abort = new AbortController()
    const stream = streamMastraChat({
      agentId: 'agentaaaaaaa', name: 'Scout', instructions: '', messages: [{ role: 'user', content: 'Hi' }],
      signal: abort.signal, model: fixtureModel(() => [{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'unfinished' }, { type: 'finish', finishReason: 'stop', usage }]),
    })
    expect((await stream.next()).value).toMatchObject({ type: 'text_delta' })
    abort.abort()
    await expect(stream.next()).rejects.toThrow()
  })

  it('never treats subscription OAuth as a normal API provider', () => {
    expect(() => createMastraChatModel({ provider: 'openai-codex', model: 'fixture', apiKey: 'fixture-not-a-key' })).toThrow('OpenAI API-key')
    expect(() => createMastraChatModel({ provider: 'claude-code', model: 'fixture', apiKey: 'fixture-not-a-key' })).toThrow('OpenAI API-key')
  })
})
