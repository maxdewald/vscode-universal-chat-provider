import type { ProxyRequestBody } from '@src/chat/requests/request-builder'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const emptyBody = {} as ProxyRequestBody

beforeEach(() => {
  vi.resetModules()
})

describe('cLIProxyClient', () => {
  it('discovers models and tolerates optional metadata failure', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.url === 'http://proxy/v1/models')
        return Response.json({ data: [{ id: 'model-a' }] })
      if (request.url.includes('client_version'))
        return new Response('optional unavailable', { status: 503 })
      throw new Error(`Unexpected URL ${request.url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const client = new CLIProxyClient('http://proxy', 'secret')

    const result = await client.discover()

    expect(result.available).toEqual([{ id: 'model-a' }])
    expect(result.metadata).toEqual([])
    const modelsRequest = fetchMock.mock.calls.find(([request]) => request.url === 'http://proxy/v1/models')?.[0]
    expect(modelsRequest?.method).toBe('GET')
    expect(modelsRequest?.headers.get('authorization')).toBe('Bearer secret')
    expect(modelsRequest?.headers.get('content-type')).toBe('application/json')
  })

  it('reports JSON and plain-text HTTP errors', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.url.includes('client_version'))
        return Response.json({ models: [] })
      return Response.json({ error: { message: 'bad key' } }, { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const { ProxyHttpError } = await import('@src/cliproxy/api/errors')
    const client = new CLIProxyClient('http://proxy', 'key')

    await expect(client.discover()).rejects.toMatchObject({
      message: 'bad key',
      status: 401,
    })

    fetchMock.mockResolvedValueOnce(new Response('proxy unavailable', { status: 503 }))
    await expect(client.streamResponse(emptyBody, callbacks(), new AbortController().signal))
      .rejects
      .toEqual(new ProxyHttpError('proxy unavailable', 503))
  })

  it('streams text, thinking, usage, and assembled tool calls exactly once', async () => {
    const events = [
      event({ type: 'response.output_text.delta', delta: 'hello' }),
      'data: not-json\n\n',
      event({ type: 'response.reasoning_summary_text.delta', delta: 'think' }),
      event({
        type: 'response.output_item.added',
        item_id: 'item-1',
        item: { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"q":' },
      }),
      event({ type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '"x"}' }),
      event({
        type: 'response.output_item.done',
        item_id: 'item-1',
        item: { type: 'function_call', call_id: 'call-1', name: 'lookup' },
      }),
      event({
        type: 'response.completed',
        response: {
          error: null,
          incomplete_details: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      }),
      'data: [DONE]\n\n',
      event({
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'ignored', name: 'late', arguments: '{}' },
      }),
    ].join('')
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(new Response(events, {
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()
    const signal = new AbortController().signal

    await new CLIProxyClient('http://proxy', 'key').streamResponse({ model: 'x' } as ProxyRequestBody, handlers, signal)

    const request = fetchMock.mock.calls[0]![0]
    expect(request.url).toBe('http://proxy/v1/responses')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe('Bearer key')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(handlers.onText).toHaveBeenCalledWith('hello')
    expect(handlers.onThinking).toHaveBeenCalledWith('think')
    expect(handlers.onToolCall).toHaveBeenCalledTimes(1)
    expect(handlers.onToolCall).toHaveBeenCalledWith('call-1', 'lookup', { q: 'x' })
    expect(handlers.onUsage).toHaveBeenCalledWith({ input_tokens: 10, output_tokens: 2 })
  })

  it.each([
    {
      name: 'drops a trailing empty-summary sentinel',
      deltas: ['**Checking settings**\n\n<!-- -->'],
      expected: '**Checking settings**\n\n',
    },
    {
      name: 'drops a sentinel split across deltas',
      deltas: ['**Checking settings**\n\n<!-', '- -->'],
      expected: '**Checking settings**\n\n',
    },
    {
      name: 'preserves a literal sentinel in prose',
      deltas: ['**Plan**\n\nUse `<!-- -->` in JSX.'],
      expected: '**Plan**\n\nUse `<!-- -->` in JSX.',
    },
  ])('$name', async ({ deltas, expected }) => {
    const body = [
      ...deltas.map(delta => event({ type: 'response.reasoning_summary_text.delta', delta })),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.completed' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onThinking.mock.calls.flat().join('')).toBe(expected)
  })

  it('streams full reasoning_text deltas as thinking', async () => {
    const body = [
      event({ type: 'response.reasoning_text.delta', delta: 'step one ' }),
      event({ type: 'response.reasoning_text.delta', delta: 'step two' }),
      event({ type: 'response.reasoning_text.done' }),
      event({ type: 'response.completed' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onThinking.mock.calls.flat().join('')).toBe('step one step two')
  })

  it('keeps consecutive reasoning headings streaming without sentinels between them', async () => {
    const body = [
      event({ type: 'response.reasoning_summary_text.delta', delta: '**First**\n\n<!-- -->' }),
      event({ type: 'response.reasoning_summary_text.done' }),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.reasoning_summary_text.delta', delta: '**Second**\n\n<!-- -->' }),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.completed' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onThinking.mock.calls.flat().join('')).toBe('**First**\n\n**Second**\n\n')
  })

  it('separates reasoning sections with an empty thinking boundary', async () => {
    const body = [
      event({ type: 'response.reasoning_summary_text.delta', delta: 'Planning status line restructuring' }),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.reasoning_summary_text.delta', delta: 'Refining status header formatting' }),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.completed' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onThinking.mock.calls.flat()).toEqual([
      'Planning status line restructuring',
      '',
      'Refining status header formatting',
      '',
    ])
  })

  it('does not emit an empty thinking block for a sentinel-only part', async () => {
    const body = [
      event({ type: 'response.reasoning_summary_text.delta', delta: '<!-- -->' }),
      event({ type: 'response.reasoning_summary_part.done' }),
      event({ type: 'response.completed' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onThinking).not.toHaveBeenCalled()
  })

  it('forwards prompt cache keys in the request body without a redundant session header', async () => {
    let requestBody: unknown
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>()
      .mockImplementation(async (request) => {
        requestBody = await request.clone().json()
        return new Response(event({ type: 'response.completed' }))
      })
    vi.stubGlobal('fetch', fetchMock)
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')

    await new CLIProxyClient('http://proxy', 'key').streamResponse({ model: 'x', prompt_cache_key: 'universal-chat-provider-cache-key' } as ProxyRequestBody, callbacks(), new AbortController().signal)

    const request = fetchMock.mock.calls[0]![0]
    const { headers } = request
    expect(headers.get('authorization')).toBe('Bearer key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('session-id')).toBeNull()
    expect(headers.get('session_id')).toBeNull()
    expect(requestBody).toMatchObject({
      prompt_cache_key: 'universal-chat-provider-cache-key',
    })
  })

  it('emits completed pending calls and preserves invalid or scalar arguments', async () => {
    const body = [
      event({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', call_id: 'raw', name: 'raw_tool', arguments: '{bad' },
      }),
      event({
        type: 'response.output_item.done',
        output_index: 1,
        item: { type: 'function_call', call_id: 'scalar', name: 'scalar_tool', arguments: '42' },
      }),
      event({ type: 'response.completed', response: {} }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const handlers = callbacks()

    await new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, handlers, new AbortController().signal)

    expect(handlers.onToolCall).toHaveBeenCalledWith('scalar', 'scalar_tool', { value: 42 })
    expect(handlers.onToolCall).toHaveBeenCalledWith('raw', 'raw_tool', { raw: '{bad' })
  })

  it('preserves partial output and usage when the maximum output token limit is reached', async () => {
    const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    const body = [
      event({ type: 'response.output_text.delta', delta: 'partial answer' }),
      event({ type: 'response.reasoning_summary_text.delta', delta: 'final thought' }),
      event({
        type: 'response.output_item.added',
        item_id: 'partial-item',
        item: { type: 'function_call', call_id: 'partial-call', name: 'partial_tool', arguments: '{"value":' },
      }),
      event({
        type: 'response.output_item.done',
        item_id: 'partial-item',
        item: { type: 'function_call', status: 'incomplete', call_id: 'partial-call', name: 'partial_tool', arguments: '{"value":' },
      }),
      event({
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'max_output_tokens' }, usage },
      }),
    ].join('')
    const handlers = callbacks()

    await expect(stream(body, handlers))
      .resolves
      .toBeUndefined()

    expect(handlers.onText).toHaveBeenCalledWith('partial answer')
    expect(handlers.onThinking.mock.calls.flat()).toEqual(['final thought', ''])
    expect(handlers.onUsage).toHaveBeenCalledWith(usage)
    expect(handlers.onToolCall).not.toHaveBeenCalled()
  })

  it('reports usage and rejects content-filtered responses without flushing pending calls', async () => {
    const usage = { input_tokens: 8, output_tokens: 3, total_tokens: 11 }
    const body = [
      event({ type: 'response.output_text.delta', delta: 'visible prefix' }),
      event({
        type: 'response.output_item.done',
        item: { type: 'function_call', status: 'completed', call_id: 'complete-call', name: 'complete_tool', arguments: '{}' },
      }),
      event({
        type: 'response.output_item.added',
        item_id: 'pending-item',
        item: { type: 'function_call', call_id: 'pending-call', name: 'pending_tool', arguments: '{' },
      }),
      event({
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'content_filter' }, usage },
      }),
    ].join('')
    const handlers = callbacks()

    await expect(stream(body, handlers))
      .rejects
      .toThrow('blocked the response with its content filter')

    expect(handlers.onText).toHaveBeenCalledWith('visible prefix')
    expect(handlers.onUsage).toHaveBeenCalledWith(usage)
    expect(handlers.onToolCall).toHaveBeenCalledTimes(1)
    expect(handlers.onToolCall).toHaveBeenCalledWith('complete-call', 'complete_tool', {})
  })

  it.each([
    ['unknown reason', { reason: 'safety_policy' }, 'incomplete response: safety_policy'],
    ['missing reason', {}, 'incomplete response without a reason'],
  ])('rejects an incomplete response with an %s', async (_name, incompleteDetails, message) => {
    await expect(stream(event({
      type: 'response.incomplete',
      response: { incomplete_details: incompleteDetails },
    })))
      .rejects
      .toThrow(message)
  })

  it('rejects empty streaming bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
    const client = new CLIProxyClient('http://proxy', 'key')

    await expect(client.streamResponse(emptyBody, callbacks(), new AbortController().signal))
      .rejects
      .toThrow('empty streaming response')
  })

  it.each([
    ['nested error', { type: 'error', error: { message: 'too long' } }, 'too long'],
    ['failed response', { type: 'response.failed', response: { error: { message: 'generation failed' } } }, 'generation failed'],
    ['top-level error', { type: 'error', message: 'upstream failed' }, 'upstream failed'],
  ])('surfaces the %s message', async (_name, payload, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(event(payload))))
    const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')

    await expect(new CLIProxyClient('http://proxy', 'key')
      .streamResponse(emptyBody, callbacks(), new AbortController().signal))
      .rejects
      .toThrow(message)
  })
})

function callbacks() {
  return {
    onText: vi.fn(),
    onThinking: vi.fn(),
    onToolCall: vi.fn(),
    onUsage: vi.fn(),
  }
}

async function stream(body: string, handlers = callbacks()): Promise<void> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  const { CLIProxyClient } = await import('@src/cliproxy/api/proxy-client')
  return new CLIProxyClient('http://proxy', 'key').streamResponse(emptyBody, handlers, new AbortController().signal)
}

function event(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}
