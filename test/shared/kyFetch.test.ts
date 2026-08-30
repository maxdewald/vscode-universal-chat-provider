import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('kyFetch', () => {
  it('passes duplex when forwarding a request with a body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetchMock)
    const { kyFetch } = await import('@src/shared/kyFetch')

    await kyFetch.post('http://proxy/v1/responses', { json: {} })

    expect(fetchMock).toHaveBeenCalledWith(expect.any(Request), { duplex: 'half' })
  })
})
