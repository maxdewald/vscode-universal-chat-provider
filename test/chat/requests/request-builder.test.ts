import { Buffer } from 'node:buffer'
import { buildPromptCacheKey, buildRequest, convertMessage } from '@src/chat/requests/request-builder'
import { describe, expect, it } from 'vitest'
import {
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from 'vscode'
import { createProviderModel, userTextMessage } from '../../support/chat'

const model = createProviderModel({
  proxyModelId: 'proxy-model',
  maxOutputTokens: 4096,
  reasoningLevels: ['low', 'high'],
  supportsParallelToolCalls: true,
})

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34])

async function convertAll(messages: Parameters<typeof convertMessage>[0][]) {
  return (await Promise.all(messages.map(convertMessage))).flat()
}

describe('response request conversion', () => {
  it('preserves Copilot system messages as Responses API system input', async () => {
    const systemRole = 3 as LanguageModelChatMessageRole
    const messages = [{
      role: systemRole,
      content: [new LanguageModelTextPart('You are a coding agent.')],
      name: undefined,
    }]

    expect(await convertAll(messages)).toEqual([{
      role: 'system',
      content: [{ type: 'input_text', text: 'You are a coding agent.' }],
    }])
    expect(buildPromptCacheKey(model, messages)).toMatch(/^universal-chat-provider-[a-f0-9]{32}$/)
  })

  it('serializes text, image, data, tool calls, and tool results in order', async () => {
    const messages = [
      {
        role: LanguageModelChatMessageRole.Assistant,
        content: [
          new LanguageModelTextPart('answer'),
          new LanguageModelToolCallPart('call-1', 'lookup', { q: 'x' }),
        ],
        name: undefined,
      },
      {
        role: LanguageModelChatMessageRole.User,
        content: [
          new LanguageModelDataPart(PNG_BYTES, 'image/png'),
          LanguageModelDataPart.text('notes', 'text/plain'),
          new LanguageModelToolResultPart('call-1', [
            new LanguageModelTextPart('done'),
            LanguageModelDataPart.text('details'),
            new LanguageModelDataPart(new Uint8Array([3]), 'application/octet-stream'),
            { value: 1 },
          ]),
        ],
        name: undefined,
      },
    ]

    expect(await convertAll(messages)).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'answer' }],
      },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookup',
        arguments: '{"q":"x"}',
      },
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}` },
          { type: 'input_text', text: 'notes' },
        ],
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'done\ndetails\n[application/octet-stream data]\n{"value":1}',
      },
    ])
  })

  it('corrects a mislabelled image mime type from the actual bytes', async () => {
    const messages = [{
      role: LanguageModelChatMessageRole.User,
      content: [new LanguageModelDataPart(PNG_BYTES, 'image/jpeg')],
      name: undefined,
    }]

    expect(await convertAll(messages)).toEqual([{
      role: 'user',
      content: [{ type: 'input_image', image_url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}` }],
    }])
  })

  it('sends recognised non-image binaries as files instead of decoded text', async () => {
    const messages = [{
      role: LanguageModelChatMessageRole.User,
      content: [new LanguageModelDataPart(PDF_BYTES, 'application/pdf')],
      name: undefined,
    }]

    expect(await convertAll(messages)).toEqual([{
      role: 'user',
      content: [{
        type: 'input_file',
        filename: 'document.pdf',
        file_data: `data:application/pdf;base64,${Buffer.from(PDF_BYTES).toString('base64')}`,
      }],
    }])
  })

  it('keeps text-based formats such as svg as readable text', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'
    const messages = [{
      role: LanguageModelChatMessageRole.User,
      content: [new LanguageModelDataPart(new TextEncoder().encode(svg), 'image/svg+xml')],
      name: undefined,
    }]

    expect(await convertAll(messages)).toEqual([{
      role: 'user',
      content: [{ type: 'input_text', text: svg }],
    }])
  })

  it('strips Copilot cache_control marker parts from content and tool results', async () => {
    const messages = [
      {
        role: LanguageModelChatMessageRole.User,
        content: [
          new LanguageModelTextPart('hi'),
          new LanguageModelDataPart(new Uint8Array([1]), 'cache_control'),
          new LanguageModelToolResultPart('call-1', [
            new LanguageModelTextPart('result'),
            new LanguageModelDataPart(new Uint8Array([2]), 'cache_control'),
          ]),
        ],
        name: undefined,
      },
    ]

    expect(await convertAll(messages)).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'function_call_output', call_id: 'call-1', output: 'result' },
    ])
  })

  it('drops empty text parts so Anthropic does not reject the request', async () => {
    const messages = [{
      role: LanguageModelChatMessageRole.User,
      content: [
        new LanguageModelTextPart(''),
        new LanguageModelTextPart('hello'),
        new LanguageModelTextPart(''),
      ],
      name: undefined,
    }]

    expect(await convertAll(messages)).toEqual([{
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    }])
  })

  it('adds supported reasoning and tool options', async () => {
    const request = await buildRequest(
      model,
      [userTextMessage('hello')],
      {
        toolMode: LanguageModelChatToolMode.Required,
        tools: [{
          name: 'lookup',
          description: 'Look up a value',
          inputSchema: {
            $comment: 'tool metadata',
            type: 'object',
            properties: {
              q: {
                type: 'string',
                enumDescriptions: ['Query text'],
              },
            },
          },
        }],
      },
      { reasoningEffort: 'high' },
    )

    expect(request).toEqual({
      model: 'proxy-model',
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      }],
      stream: true,
      max_output_tokens: 4096,
      prompt_cache_key: buildPromptCacheKey(model, [userTextMessage('hello')]),
      reasoning: { effort: 'high', summary: 'detailed' },
      tools: [{
        type: 'function',
        name: 'lookup',
        description: 'Look up a value',
        parameters: {
          $comment: 'tool metadata',
          type: 'object',
          properties: { q: { type: 'string', enumDescriptions: ['Query text'] } },
        },
        strict: false,
      }],
      tool_choice: 'required',
      parallel_tool_calls: true,
    })
  })

  it('adds priority service tier only for Fast variants', async () => {
    const messages = [userTextMessage('hello')]
    const options = { toolMode: LanguageModelChatToolMode.Auto }
    const standard = await buildRequest(model, messages, options)
    const fast = await buildRequest({ ...model, serviceTier: 'priority' }, messages, options)

    expect(standard).not.toHaveProperty('service_tier')
    expect(fast).toHaveProperty('service_tier', 'priority')
    expect(fast.model).toBe('proxy-model')
    expect(fast.prompt_cache_key).toBe(standard.prompt_cache_key)
  })

  it('keeps prompt cache keys stable across turns in the same chat seed', async () => {
    const firstTurn = [userTextMessage('hello')]
    const secondTurn = [
      ...firstTurn,
      {
        role: LanguageModelChatMessageRole.Assistant,
        content: [new LanguageModelTextPart('hi')],
        name: undefined,
      },
      userTextMessage('next'),
    ]

    const key = buildPromptCacheKey(model, firstTurn)

    expect(key).toMatch(/^universal-chat-provider-[a-f0-9]{32}$/)
    expect(buildPromptCacheKey(model, secondTurn)).toBe(key)
    expect((await buildRequest(model, firstTurn, {
      toolMode: LanguageModelChatToolMode.Auto,
    })).prompt_cache_key).toBe(key)
  })

  it('falls back to a supported reasoning level and supplies a default tool schema', async () => {
    const request = await buildRequest(model, [], {
      toolMode: LanguageModelChatToolMode.Auto,
      tools: [{ name: 'empty', description: 'No input' }],
    }, { reasoningEffort: 'medium' })

    expect(request).toHaveProperty('reasoning', { effort: 'low', summary: 'detailed' })
    expect(request).not.toHaveProperty('prompt_cache_key')
    expect(request).toMatchObject({
      tools: [{
        name: 'empty',
        parameters: { type: 'object', properties: {} },
      }],
      tool_choice: 'auto',
    })
  })

  it('omits reasoning for models without reasoning levels', async () => {
    const plainModel = { ...model, reasoningLevels: [] }
    const request = await buildRequest(plainModel, [], { toolMode: LanguageModelChatToolMode.Auto })

    expect(request).not.toHaveProperty('reasoning')
  })

  it('drops every tool field when tools are omitted', async () => {
    const request = await buildRequest(model, [userTextMessage('hello')], {
      toolMode: LanguageModelChatToolMode.Required,
      tools: [{ name: 'lookup', description: 'Look up a value' }],
    }, { reasoningEffort: 'low', omitTools: true })

    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('tool_choice')
    expect(request).not.toHaveProperty('parallel_tool_calls')
    expect(request).toHaveProperty('reasoning', { effort: 'low', summary: 'detailed' })
  })
})
