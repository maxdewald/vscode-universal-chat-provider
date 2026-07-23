import type { CompletionDeps } from '../../../src/chat/requests/completion'
import type { ProxyRequestBody } from '../../../src/chat/requests/request-builder'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancellationTokenSource } from 'vscode'
import { streamCompletion } from '../../../src/chat/requests/completion'
import { ProxyHttpError } from '../../../src/cliproxy/api/errors'

const emptyBody = {} as ProxyRequestBody
const clientMocks = vi.hoisted(() => ({
  streamResponse: vi.fn(),
}))

vi.mock('../../../src/cliproxy/api/proxy-client', () => ({
  CLIProxyClient: class {
    streamResponse = clientMocks.streamResponse
  },
}))

beforeEach(() => {
  clientMocks.streamResponse.mockReset()
})

describe('streamCompletion', () => {
  it('requires credentials', async () => {
    await expect(streamCompletion(deps(), emptyBody, callbacks())).rejects.toMatchObject({
      code: 'NoPermissions',
      message: 'Configure a CLIProxyAPI API key first.',
    })
    expect(clientMocks.streamResponse).not.toHaveBeenCalled()
  })

  it('resolves quietly when cancellation aborts the stream', async () => {
    const token = new CancellationTokenSource()
    clientMocks.streamResponse.mockImplementationOnce(async (_body, _callbacks, signal: AbortSignal) => {
      token.cancel()
      expect(signal.aborted).toBe(true)
      throw new Error('aborted')
    })

    await expect(streamCompletion(deps('key'), emptyBody, callbacks(), token.token)).resolves.toBeUndefined()
  })

  it.each([
    [401, 'bad key', 'NoPermissions', true],
    [403, 'The model grok-4.5 is not available in your region.', 'NoPermissions', false],
    [404, 'failed', 'NotFound', false],
    [429, 'failed', 'Blocked', false],
  ])('maps HTTP %s errors', async (status, message, code, recovers) => {
    const rejected = vi.fn()
    clientMocks.streamResponse.mockRejectedValueOnce(new ProxyHttpError(message, status))

    await expect(
      streamCompletion(deps('key', rejected), emptyBody, callbacks()),
    ).rejects.toMatchObject({ code, message })
    expect(rejected).toHaveBeenCalledTimes(recovers ? 1 : 0)
  })
})

function deps(apiKey?: string, onCredentialsRejected = vi.fn()): CompletionDeps {
  return {
    connection: {
      ensureReady: vi.fn(async () => {}),
      baseUrl: () => 'http://proxy',
    },
    credentials: {
      get: vi.fn(async () => apiKey),
    },
    onCredentialsRejected,
  } as unknown as CompletionDeps
}

function callbacks() {
  return {
    onText: vi.fn(),
    onToolCall: vi.fn(),
  }
}
