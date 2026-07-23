import type { OutputChannel } from 'vscode'
import type { StreamCallbacks } from '../../src/cliproxy/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CancellationTokenSource,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from 'vscode'
import { estimateTokens } from '../../src/chat/estimate'
import { UniversalChatProvider } from '../../src/chat/provider'
import { createProviderModel, decodeJsonDataPart, singleModelDiscovery, userTextMessage } from '../support/chat'
import { createExtensionContext, LanguageModelThinkingPart, resetVSCodeMock, vscodeMock } from '../support/vscode'

const clientMocks = vi.hoisted(() => ({
  discover: vi.fn(),
  streamResponse: vi.fn(),
}))

vi.mock('../../src/cliproxy/client', () => ({
  CLIProxyClient: class {
    discover = clientMocks.discover
    streamResponse = clientMocks.streamResponse
  },
}))

vi.mock('../../src/chat/catalog', () => ({
  fetchCatalog: vi.fn(async () => new Map()),
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

  it('uses stored utility effort only for core utility requests', async () => {
    const provider = createProvider('secret')
    await provider.updateUtilityEffort('model-a', 'high')
    clientMocks.streamResponse.mockResolvedValue(undefined)
    const message = [userTextMessage('hello')]

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high'], reasoningEffort: 'low' },
      message,
      { ...options(), requestInitiator: 'core' } as ReturnType<typeof options>,
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )
    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high'], reasoningEffort: 'low' },
      message,
      options(),
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ reasoning: { effort: 'high', summary: 'detailed' } }),
    )
    expect(clientMocks.streamResponse.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ reasoning: { effort: 'low', summary: 'detailed' } }),
    )
  })

  it('falls back to the lowest effort for core utility requests with stale stored effort', async () => {
    const provider = createProvider('secret')
    await provider.updateUtilityEffort('model-a', 'stale')
    clientMocks.streamResponse.mockResolvedValue(undefined)

    await provider.provideLanguageModelChatResponse(
      { ...model(), reasoningLevels: ['low', 'high'], reasoningEffort: 'high' },
      [userTextMessage('hello')],
      { ...options(), requestInitiator: 'core' } as ReturnType<typeof options>,
      { report: vi.fn() },
      new CancellationTokenSource().token,
    )

    expect(clientMocks.streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: 'low', summary: 'detailed' } }),
      expect.any(Object),
      expect.any(AbortSignal),
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
      windows: [{ key: 'extra_usage', label: 'Extra Usage', remainingPercent: 75, remainingBalance: { amount: 15, currency: 'EUR' } }],
    }])

    expect(provider.quotaSections()).toEqual([
      { title: 'Claude', entries: [{ name: 'Extra Usage', remainingPercent: 75, remainingBalance: { amount: 15, currency: 'EUR' } }] },
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

function createProvider(apiKey?: string, onSignIn?: () => Promise<void>): UniversalChatProvider {
  if (apiKey !== undefined)
    vscodeMock.secrets.set('universalChatProvider.apiKey', apiKey)
  return new UniversalChatProvider(
    createExtensionContext({ globalState: vscodeMock.settings }),
    vscodeMock.output as unknown as OutputChannel,
    { ensureReady: async () => {}, baseUrl: () => 'http://127.0.0.1:8317' },
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
  return singleModelDiscovery()
}
