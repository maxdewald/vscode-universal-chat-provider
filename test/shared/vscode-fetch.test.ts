import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('vscodeCompatibleFetch', () => {
  it('passes duplex when forwarding a Request with a body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const { vscodeCompatibleFetch } = await import('@src/shared/vscode-fetch')
    const request = new Request('http://proxy/v1/responses', {
      method: 'POST',
      body: new ReadableStream(),
      duplex: 'half',
    })

    await vscodeCompatibleFetch(request)

    expect(fetchMock).toHaveBeenCalledWith(request, { duplex: 'half' })
  })

  it('preserves an explicitly supplied duplex option', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const { vscodeCompatibleFetch } = await import('@src/shared/vscode-fetch')
    const request = new Request('http://proxy/v1/responses', {
      method: 'POST',
      body: new ReadableStream(),
      duplex: 'half',
    })
    const init: RequestInit = { duplex: 'half' }

    await vscodeCompatibleFetch(request, init)

    expect(fetchMock).toHaveBeenCalledWith(request, init)
  })
})
