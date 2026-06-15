import type { OutputChannel } from 'vscode'
import type { ProviderModel } from '../../src/chat/model'
import type { TokenCounterDeps } from '../../src/chat/token-counter'
import type { CredentialStore } from '../../src/cliproxy/credentials'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancellationTokenSource } from 'vscode'
import { TokenCounter } from '../../src/chat/token-counter'
import { vscodeMock } from '../support/vscode'

const clientMocks = vi.hoisted(() => ({ countInputTokens: vi.fn() }))

vi.mock('../../src/cliproxy/client', () => ({
  CLIProxyClient: class {
    countInputTokens = clientMocks.countInputTokens
  },
}))

const model = { proxyModelId: 'model-a' } as ProviderModel

beforeEach(() => {
  clientMocks.countInputTokens.mockReset()
  clientMocks.countInputTokens.mockResolvedValue(11)
  vscodeMock.output.appendLine.mockReset()
})

describe('token counter', () => {
  it('returns the proxy count and caches it per content', async () => {
    const counter = new TokenCounter(deps())

    await expect(counter.count(model, 'hello')).resolves.toBe(11)
    await expect(counter.count(model, 'hello')).resolves.toBe(11)
    await expect(counter.count(model, 'different')).resolves.toBe(11)

    expect(clientMocks.countInputTokens).toHaveBeenCalledTimes(2)
  })

  it('coalesces identical in-flight requests into one call', async () => {
    let release!: (value: number) => void
    clientMocks.countInputTokens.mockReturnValueOnce(new Promise<number>((resolve) => {
      release = resolve
    }))
    const counter = new TokenCounter(deps())

    const first = counter.count(model, 'hello')
    const second = counter.count(model, 'hello')
    release(42)

    await expect(first).resolves.toBe(42)
    await expect(second).resolves.toBe(42)
    expect(clientMocks.countInputTokens).toHaveBeenCalledTimes(1)
  })

  it('returns 0 and logs when the proxy count fails, without caching the failure', async () => {
    clientMocks.countInputTokens
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(9)
    const counter = new TokenCounter(deps())

    await expect(counter.count(model, 'hello')).resolves.toBe(0)
    expect(vscodeMock.output.appendLine).toHaveBeenCalledWith('[token-count] model-a: offline')
    await expect(counter.count(model, 'hello')).resolves.toBe(9)
  })

  it('returns 0 without calling the proxy when no credentials are stored', async () => {
    const counter = new TokenCounter(deps({ apiKey: undefined }))

    await expect(counter.count(model, 'hello')).resolves.toBe(0)
    expect(clientMocks.countInputTokens).not.toHaveBeenCalled()
  })

  it('returns 0 for an already-cancelled token without calling the proxy', async () => {
    const counter = new TokenCounter(deps())
    const source = new CancellationTokenSource()
    source.cancel()

    await expect(counter.count(model, 'hello', source.token)).resolves.toBe(0)
    expect(clientMocks.countInputTokens).not.toHaveBeenCalled()
  })
})

function deps(options: { apiKey: string | undefined } = { apiKey: 'key' }): TokenCounterDeps {
  return {
    connection: { ensureReady: async () => {}, baseUrl: () => 'http://proxy' },
    credentials: { get: async () => options.apiKey } as unknown as CredentialStore,
    output: vscodeMock.output as unknown as OutputChannel,
  }
}
