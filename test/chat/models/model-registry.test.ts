import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelRegistry } from '../../../src/chat/models/model-registry'
import { ProxyHttpError } from '../../../src/cliproxy/api/errors'
import { singleModelDiscovery } from '../../support/chat'
import { resetVSCodeMock, vscodeMock, window } from '../../support/vscode'

const clientMocks = vi.hoisted(() => ({
  discover: vi.fn(),
}))

const catalogMocks = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
}))

vi.mock('../../../src/cliproxy/api/proxy-client', () => ({
  CLIProxyClient: class {
    discover = clientMocks.discover
  },
}))

vi.mock('../../../src/chat/models/catalog', () => ({
  fetchCatalog: catalogMocks.fetchCatalog,
}))

beforeEach(() => {
  resetVSCodeMock()
  clientMocks.discover.mockReset()
  catalogMocks.fetchCatalog.mockReset().mockResolvedValue(new Map())
})

describe('model registry', () => {
  it('deduplicates refreshes, caches models, and fires only when data changes', async () => {
    const registry = createRegistry('secret')
    let resolveDiscovery!: (value: ReturnType<typeof discovery>) => void
    clientMocks.discover.mockReturnValueOnce(new Promise(resolve => resolveDiscovery = resolve))
    const changes = vi.fn()
    registry.onDidChange(changes)

    const first = registry.refresh(true)
    const second = registry.refresh(false)
    await vi.waitFor(() => expect(clientMocks.discover).toHaveBeenCalledTimes(1))
    resolveDiscovery(discovery())

    await expect(first).resolves.toHaveLength(1)
    await expect(second).resolves.toHaveLength(1)
    expect(changes).toHaveBeenCalledTimes(1)

    await registry.refresh(false)
    expect(clientMocks.discover).toHaveBeenCalledTimes(1)

    clientMocks.discover.mockResolvedValueOnce(discovery())
    await registry.forceRefresh(false)
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('runs one follow-up when forced refreshes arrive during discovery', async () => {
    const registry = createRegistry('secret')
    const firstDiscovery = deferredDiscovery()
    const secondDiscovery = deferredDiscovery()
    clientMocks.discover
      .mockReturnValueOnce(firstDiscovery.promise)
      .mockReturnValueOnce(secondDiscovery.promise)

    const first = registry.forceRefresh(false)
    await vi.waitFor(() => expect(clientMocks.discover).toHaveBeenCalledTimes(1))
    const second = registry.forceRefresh(false)
    const third = registry.forceRefresh(false)

    firstDiscovery.resolve(discovery())
    await vi.waitFor(() => expect(clientMocks.discover).toHaveBeenCalledTimes(2))
    secondDiscovery.resolve(discovery())

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    ])
    expect(clientMocks.discover).toHaveBeenCalledTimes(2)
  })

  it('does not let an active passive refresh absorb a forced invalidation', async () => {
    const registry = createRegistry('secret')
    const firstDiscovery = deferredDiscovery()
    clientMocks.discover
      .mockReturnValueOnce(firstDiscovery.promise)
      .mockResolvedValueOnce(discovery())

    const passive = registry.refresh(false)
    await vi.waitFor(() => expect(clientMocks.discover).toHaveBeenCalledTimes(1))
    const forced = registry.forceRefresh(false)
    firstDiscovery.resolve(discovery())

    await expect(passive).resolves.toHaveLength(1)
    await expect(forced).resolves.toHaveLength(1)
    expect(clientMocks.discover).toHaveBeenCalledTimes(2)
  })

  it('retries discovery until expected proxy models are visible', async () => {
    const registry = createRegistry('secret')
    clientMocks.discover
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(singleModelDiscovery({
        id: 'codegate/gpt-5.6-sol',
        owned_by: 'openai',
      }))

    const models = await registry.forceRefresh(false, ['codegate/gpt-5.6-sol'])

    expect(models.map(model => model.proxyModelId)).toContain('codegate/gpt-5.6-sol')
    expect(clientMocks.discover).toHaveBeenCalledTimes(2)
  })

  it('logs collisions only when they enter the current collision set', async () => {
    const registry = createRegistry('secret')
    const message = 'Model display collision for Test "Model": model-a, model-b; showing full IDs.'

    clientMocks.discover.mockResolvedValue(collidingDiscovery())
    await registry.forceRefresh(false)
    expect(outputMessages(message)).toHaveLength(1)

    await registry.forceRefresh(false)
    expect(outputMessages(message)).toHaveLength(1)

    registry.reset()
    await registry.forceRefresh(false)
    expect(outputMessages(message)).toHaveLength(2)

    clientMocks.discover.mockResolvedValueOnce(discovery())
    await registry.forceRefresh(false)
    expect(outputMessages(message)).toHaveLength(2)

    await registry.forceRefresh(false)
    expect(outputMessages(message)).toHaveLength(3)
  })

  it('retains cached models on discovery failure and reports interactive errors', async () => {
    const registry = createRegistry('secret')
    clientMocks.discover.mockResolvedValueOnce(discovery())
    await registry.forceRefresh(false)
    clientMocks.discover.mockRejectedValueOnce(new Error('offline'))

    await expect(registry.forceRefresh(true)).resolves.toHaveLength(1)
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'CLIProxyAPI model discovery failed: offline',
    )
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith('Model discovery failed: offline')
  })

  it('handles rejected credentials without a generic error prompt', async () => {
    const rejected = vi.fn()
    const registry = createRegistry('secret', { onCredentialsRejected: rejected })
    clientMocks.discover.mockRejectedValueOnce(new ProxyHttpError('bad key', 401))

    await expect(registry.forceRefresh(true)).resolves.toEqual([])
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(window.showErrorMessage).not.toHaveBeenCalled()
  })

  it('enriches openai-compatible thinking levels once before discovery', async () => {
    const enrich = vi.fn(async () => true)
    const registry = createRegistry('secret', {}, {
      enrichOpenAICompatibilityThinking: enrich,
    })
    const catalog = new Map([['gpt-5.6-sol', { id: 'gpt-5.6-sol' }]])
    catalogMocks.fetchCatalog.mockResolvedValue(catalog)
    clientMocks.discover.mockResolvedValue(discovery())

    await registry.forceRefresh(false)
    await registry.forceRefresh(false)

    expect(enrich).toHaveBeenCalledTimes(1)
    expect(enrich).toHaveBeenCalledWith(catalog)
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith(
      'Enriched OpenAI-compatible thinking levels from the model catalog.',
    )
  })

  it('reports regional restrictions without starting credential recovery', async () => {
    const rejected = vi.fn()
    const registry = createRegistry('secret', { onCredentialsRejected: rejected })
    const message = 'The model grok-4.5 is not available in your region.'
    clientMocks.discover.mockRejectedValueOnce(new ProxyHttpError(message, 403))

    await expect(registry.forceRefresh(true)).resolves.toEqual([])
    expect(rejected).not.toHaveBeenCalled()
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      `CLIProxyAPI model discovery failed: ${message}`,
    )
  })
})

function createRegistry(
  apiKey?: string,
  hooks: Partial<ConstructorParameters<typeof ModelRegistry>[3]> = {},
  connection: Partial<ConstructorParameters<typeof ModelRegistry>[0]> = {},
): ModelRegistry {
  return new ModelRegistry(
    {
      ensureReady: vi.fn(async () => {}),
      baseUrl: () => 'http://proxy',
      ...connection,
    },
    { get: vi.fn(async () => apiKey) } as never,
    vscodeMock.output as never,
    {
      acquireApiKey: vi.fn(async () => apiKey),
      onCredentialsRejected: vi.fn(),
      onCredentialsAccepted: vi.fn(),
      ...hooks,
    },
  )
}

function discovery() {
  return singleModelDiscovery()
}

function collidingDiscovery() {
  return {
    available: [
      { id: 'model-a', owned_by: 'test', context_length: 128_000, max_completion_tokens: 20 },
      { id: 'model-b', owned_by: 'test', context_length: 128_000, max_completion_tokens: 20 },
    ],
    metadata: [
      { slug: 'model-a', display_name: 'Model (Low)', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
      { slug: 'model-b', display_name: 'Model (High)', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    ],
  }
}

function deferredDiscovery() {
  let resolve!: (value: ReturnType<typeof discovery>) => void
  const promise = new Promise<ReturnType<typeof discovery>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function outputMessages(message: string): unknown[][] {
  return vscodeMock.output.appendLine.mock.calls.filter(call => call[0] === message)
}
