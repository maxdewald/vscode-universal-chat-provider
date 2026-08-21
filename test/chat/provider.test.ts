import type { StreamCallbacks } from '@src/cliproxy/api/proxy-client'
import type { LanguageModelChatMessageRole, OutputChannel } from 'vscode'
import { UniversalChatProvider, utilityModelId } from '@src/chat/provider'
import { estimateTokens } from '@src/chat/requests/estimate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CancellationTokenSource,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from 'vscode'
import { createProviderModel, decodeJsonDataPart, singleModelDiscovery, userTextMessage } from '../support/chat'
import { createExtensionContext, LanguageModelThinkingPart, resetVSCodeMock, vscodeMock, window } from '../support/vscode'

const clientMocks = vi.hoisted(() => ({
  discover: vi.fn(),
  streamResponse: vi.fn(),
}))

vi.mock('../../src/cliproxy/api/proxy-client', () => ({
  CLIProxyClient: class {
    discover = clientMocks.discover
    streamResponse = clientMocks.streamResponse
  },
}))

vi.mock('../../src/chat/models/catalog', () => ({
  fetchCatalog: vi.fn(async () => ({ router: new Map(), modelsDev: new Map() })),
}))

beforeEach(() => {
  resetVSCodeMock()
  clientMocks.discover.mockReset()
  clientMocks.streamResponse.mockReset()
  vscodeMock.settings.set('universalChatProvider.autoDetectConfig', false)
  vscodeMock.settings.set('universalChatProvider.baseUrl', 'http://proxy/')
})

describe('language model provider', () => {
  it('requires credentials and returns zero for cancelled token counting', async () => {
    const provider = createProvider()
    const token = new CancellationTokenSource()

    await expect(provider.provideLanguageModelChatResponse(
      model(),
      [],
      options(),
      { report: vi.fn() },
      token.token,
    )).rejects.toMatchObject({ code: 'NoPermissions' })

    token.cancel()
    await expect(provider.provideTokenCount(model(), 'hello', token.token)).resolves.toBe(0)
    await expect(provider.provideLanguageModelChatInformation({ silent: true }, token.token)).resolves.toEqual([])
  })

  it('translates streaming callbacks into VS Code response parts and usage logs', async () => {
    const provider = createProvider('secret')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onThinking?.('thinking')
      callbacks.onText('text')
      callbacks.onToolCall('call', 'lookup', { q: 'x' })
      callbacks.onUsage?.({ output_tokens: 3 })
    })
    const report = vi.fn()

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningEffort: 'high' },
      [userTextMessage('hello')],
      options(),
      { report },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'model-a',
        reasoning: { effort: 'high', summary: 'detailed' },
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    const thinkingPart = report.mock.calls[0]?.[0] as LanguageModelThinkingPart
    expect(thinkingPart).toBeInstanceOf(LanguageModelThinkingPart)
    expect(thinkingPart.value).toBe('thinking')
    expect(thinkingPart.id).toBeUndefined()
    expect(report.mock.calls[1]?.[0]).toEqual(new LanguageModelTextPart('text'))
    expect(report.mock.calls[2]?.[0]).toEqual(new LanguageModelToolCallPart('call', 'lookup', { q: 'x' }))
    const usagePart = report.mock.calls[3]?.[0] as LanguageModelDataPart
    expect(usagePart).toBeInstanceOf(LanguageModelDataPart)
    expect(usagePart.mimeType).toBe('usage')
    expect(decodeJsonDataPart(usagePart)).toEqual({
      prompt_tokens: 0,
      completion_tokens: 3,
      total_tokens: 3,
    })
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      '[usage] model-a: effort=high input=0 cached=n/a write=0 output=3 hit=n/a raw={"output_tokens":3}',
    )
  })

  it('sends the effort picked from the model-config dropdown and logs it', async () => {
    const provider = createProvider('secret')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onUsage?.({ output_tokens: 1 })
    })

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high', 'xhigh'], reasoningEffort: 'low' },
      [userTextMessage('hello')],
      { ...options(), modelConfiguration: { reasoningEffort: 'xhigh' } } as ReturnType<typeof options>,
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: 'xhigh', summary: 'detailed' } }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      '[usage] model-a: effort=xhigh input=0 cached=n/a write=0 output=1 hit=n/a raw={"output_tokens":1}',
    )
  })

  it('reports missing Codex usage as unavailable without emitting a usage part', async () => {
    const provider = createProvider('secret')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onText('text')
      callbacks.onUsage?.(undefined)
    })
    const report = vi.fn()

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningEffort: 'xhigh' },
      [userTextMessage('hello')],
      options(),
      { report },
      new CancellationTokenSource().token,
    )

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(new LanguageModelTextPart('text'))
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      '[usage] model-a: effort=xhigh input=n/a cached=n/a write=n/a output=n/a hit=n/a (unavailable)',
    )
  })

  it('publishes a hidden utility alias that pins effort and reports failures', async () => {
    const provider = createProvider('secret')
    clientMocks.discover.mockResolvedValueOnce({
      available: [{ id: 'model-a', owned_by: 'openai', context_length: 128_000, max_completion_tokens: 20 }],
      metadata: [{
        slug: 'model-a',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
        default_reasoning_level: 'medium',
      }],
    })
    clientMocks.streamResponse.mockResolvedValue(undefined)
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true },
      new CancellationTokenSource().token,
    )
    const alias = models.find(model => model.id === utilityModelId('model-a', 'low'))!

    await provider.provideLanguageModelChatResponse(
      alias,
      [userTextMessage('hello')],
      { ...options(), modelConfiguration: { reasoningEffort: 'medium' } } as ReturnType<typeof options>,
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ reasoning: { effort: 'low', summary: 'detailed' } }),
    )
    expect(models.map(model => ({ id: model.id, selectable: (model as { isUserSelectable?: boolean }).isUserSelectable }))).toEqual([
      { id: 'model-a', selectable: undefined },
      { id: 'model-a:utility-low', selectable: false },
      { id: 'model-a:utility-medium', selectable: false },
    ])

    const failure = new Error('provider unavailable')
    clientMocks.streamResponse.mockRejectedValueOnce(failure)
    await expect(provider.provideLanguageModelChatResponse(
      alias,
      [userTextMessage('hello')],
      options(),
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )).rejects.toBe(failure)
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Utility model request failed: provider unavailable',
    )
  })

  it('refreshes models on startup when credentials are stored', async () => {
    const provider = createProvider('secret')
    clientMocks.discover.mockResolvedValueOnce(discovery())

    await provider.initialize()

    expect(clientMocks.discover).toHaveBeenCalledTimes(1)
  })

  it('opens sign-in on an interactive resolve, then resolves models', async () => {
    const onSignIn = vi.fn(async () => {})
    const provider = createProvider('secret', onSignIn)
    clientMocks.discover.mockResolvedValueOnce(discovery())

    const models = await provider.provideLanguageModelChatInformation(
      { silent: false },
      new CancellationTokenSource().token,
    )

    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(models).toHaveLength(1)
  })

  it('does not prompt sign-in for a silent resolve', async () => {
    const onSignIn = vi.fn(async () => {})
    const provider = createProvider('secret', onSignIn)
    clientMocks.discover.mockResolvedValueOnce({ available: [], metadata: [] })

    await provider.provideLanguageModelChatInformation(
      { silent: true },
      new CancellationTokenSource().token,
    )

    expect(onSignIn).not.toHaveBeenCalled()
  })

  it('counts tokens locally without querying the proxy', async () => {
    const provider = createProvider('secret')

    await expect(provider.provideTokenCount(
      model(),
      'hello',
      new CancellationTokenSource().token,
    )).resolves.toBe(estimateTokens('hello'))
    expect(clientMocks.streamResponse).not.toHaveBeenCalled()
  })

  it('keeps the last successful Claude quota until newer values arrive', () => {
    const provider = createProvider()
    provider.setQuotas([{
      provider: 'claude',
      windows: [{ key: 'five_hour', label: '5h Quota', remainingPercent: 80 }],
    }])

    provider.setQuotas([{ provider: 'claude', windows: [], error: 'HTTP 401' }])
    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: '5h Quota', remainingPercent: 80 }] },
    ])
    provider.setQuotas([{
      provider: 'claude',
      windows: [{ key: 'five_hour', label: '5h Quota', remainingPercent: 65 }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: '5h Quota', remainingPercent: 65 }] },
    ])
  })

  it('keeps a pending row for an account whose quota has not loaded yet', () => {
    const provider = createProvider()
    provider.setQuotas([{ provider: 'claude', windows: [] }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: 'Quota', remainingPercent: undefined }] },
    ])
  })

  it('threads resetsAt through quotaSections for account-window providers', () => {
    const provider = createProvider()
    provider.setQuotas([{ provider: 'grok', windows: [{ label: 'Credits', remainingPercent: 75 }] }])
    expect(provider.quotaSections()).toEqual([
      { title: 'Grok', entries: [{ name: 'Credits', remainingPercent: 75 }] },
    ])

    provider.setQuotas([{
      provider: 'grok',
      windows: [{ label: 'Credits', remainingPercent: 60, resetsAt: 1_800_000_000_000 }],
    }, {
      provider: 'claude',
      windows: [{ key: 'five_hour', label: '5h Quota', remainingPercent: 80 }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: '5h Quota', remainingPercent: 80 }] },
      { title: 'Grok', entries: [{ name: 'Credits', remainingPercent: 60, resetsAt: 1_800_000_000_000 }] },
    ])
  })

  it('threads the remaining Claude extra-usage balance through quotaSections', () => {
    const provider = createProvider()
    provider.setQuotas([{
      provider: 'claude',
      windows: [{ key: 'extra_usage', label: 'Extra Usage', remainingPercent: 75, balance: { amount: 15, currency: 'EUR', suffix: 'left' } }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: 'Extra Usage', remainingPercent: 75, balance: { amount: 15, currency: 'EUR', suffix: 'left' } }] },
    ])
  })

  it('shows windows for every account when a provider has more than one', () => {
    const provider = createProvider()
    provider.setQuotas([{
      provider: 'codex',
      account: { authIndex: '0', label: 'a@example.com' },
      windows: [{ label: '5h Quota', remainingPercent: 90 }, { label: '7d Quota', remainingPercent: 50 }],
    }, {
      provider: 'codex',
      account: { authIndex: '1', label: 'b@example.com' },
      windows: [{ label: '5h Quota', remainingPercent: 30 }, { label: '7d Quota', remainingPercent: 10 }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Codex (a@example.com)', entries: [
        { name: '5h Quota', remainingPercent: 90 },
        { name: '7d Quota', remainingPercent: 50 },
      ] },
      { title: 'Codex (b@example.com)', entries: [
        { name: '5h Quota', remainingPercent: 30 },
        { name: '7d Quota', remainingPercent: 10 },
      ] },
    ])
  })

  it('omits the account label when a provider has a single account', () => {
    const provider = createProvider()
    provider.setQuotas([{
      provider: 'codex',
      account: { authIndex: '0', label: 'a@example.com' },
      windows: [{ label: '5h Quota', remainingPercent: 90 }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 90 }] },
    ])
  })
})

describe('conversation compaction', () => {
  it('logs the real utility model error when compaction fails', async () => {
    const provider = createProvider('secret')
    const message = 'Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.'
    const failure = new Error(message)
    clientMocks.streamResponse.mockRejectedValueOnce(failure)

    await expect(provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['minimal', 'high'], reasoningEffort: 'high' },
      compactionMessages(),
      options(),
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )).rejects.toBe(failure)

    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      `[request] failed model=model-a effort=minimal error=${message}`,
    )
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      `Utility model request failed: ${message}`,
    )
  })

  it('runs compaction on the utility model at the lowest effort without tools', async () => {
    const provider = createProvider('secret')
    clientMocks.discover.mockResolvedValue({
      available: [
        { id: 'model-a', owned_by: 'openai', context_length: 128_000, max_completion_tokens: 20 },
        { id: 'cheap', owned_by: 'openai', context_length: 200_000, max_completion_tokens: 20 },
      ],
      metadata: [{
        slug: 'cheap',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
        default_reasoning_level: 'high',
      }],
    })
    await provider.getModels(false)
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/cheap')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onUsage?.({ output_tokens: 1 })
    })

    const expandableModel = createProviderModel({
      maxInputTokens: 500_000,
      reasoningLevels: ['low', 'high'],
      reasoningEffort: 'high',
      configurationSchema: {
        properties: {
          contextSize: {
            type: 'number',
            enum: [100_000, 500_000],
            enumItemLabels: ['100K', '500K'],
            default: 100_000,
            description: 'Context Size',
            group: 'tokens',
          },
        },
      },
    })

    await provider.provideLanguageModelChatResponse(
      expandableModel,
      compactionMessages(),
      { ...options(), tools: [{ name: 'lookup', description: 'Look up' }] },
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'cheap',
        reasoning: { effort: 'low', summary: 'detailed' },
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(requestBody()).not.toHaveProperty('tools')
    expect(requestBody()).not.toHaveProperty('tool_choice')

    clientMocks.streamResponse.mockClear()
    await provider.provideLanguageModelChatResponse(
      expandableModel,
      compactionMessages(),
      { ...options(), modelConfiguration: { contextSize: 500_000 } } as ReturnType<typeof options>,
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'model-a',
        reasoning: { effort: 'low', summary: 'detailed' },
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
  })

  it('keeps the current model at the lowest effort when no utility model is set', async () => {
    const provider = createProvider('secret')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onUsage?.({ output_tokens: 1 })
    })

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high'], reasoningEffort: 'high' },
      compactionMessages(),
      { ...options(), tools: [{ name: 'lookup', description: 'Look up' }] },
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'model-a',
        reasoning: { effort: 'low', summary: 'detailed' },
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(requestBody()).not.toHaveProperty('tools')
  })

  it('leaves ordinary requests on the selected model with tools intact', async () => {
    const provider = createProvider('secret')
    vscodeMock.settings.set('chat.utilityModel', 'universal-chat-provider/cheap')
    clientMocks.streamResponse.mockImplementation(async (_body: unknown, callbacks: StreamCallbacks) => {
      callbacks.onUsage?.({ output_tokens: 1 })
    })

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high'], reasoningEffort: 'high' },
      [userTextMessage('hello')],
      { ...options(), tools: [{ name: 'lookup', description: 'Look up' }] },
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'model-a',
        reasoning: { effort: 'high', summary: 'detailed' },
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(requestBody()).toHaveProperty('tools')
  })
})

function requestBody(): object {
  return clientMocks.streamResponse.mock.calls[0]?.[0] as object
}

function compactionMessages() {
  return [
    {
      role: 3 as LanguageModelChatMessageRole,
      content: [new LanguageModelTextPart('Your task is to create a comprehensive, detailed summary of the entire conversation')],
      name: undefined,
    },
    userTextMessage('Summarize the conversation history so far, paying special attention to the most recent agent commands and tool results.'),
  ]
}

function createProvider(apiKey?: string, onSignIn?: () => Promise<void>): UniversalChatProvider {
  if (apiKey !== undefined)
    vscodeMock.secrets.set('universalChatProvider.apiKey', apiKey)
  return new UniversalChatProvider(
    createExtensionContext({ globalState: vscodeMock.settings }),
    vscodeMock.output as unknown as OutputChannel,
    { ensureReady: async () => {}, baseUrl: () => 'http://127.0.0.1:8317', acquireRequest: async () => () => {} },
    onSignIn,
  )
}

function model() {
  return createProviderModel()
}

function options() {
  return {
    toolMode: LanguageModelChatToolMode.Auto,
  }
}

function discovery() {
  return singleModelDiscovery({ owned_by: 'openai' })
}
