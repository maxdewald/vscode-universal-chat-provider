import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countAccounts } from '../../src/cliproxy/status'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('countAccounts', () => {
  it('counts auth files and openai-compatibility endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      if (request.url.includes('/openai-compatibility'))
        return Response.json({ 'openai-compatibility': [{ name: 'opencode.ai', 'base-url': 'https://opencode.ai/v1' }] })
      return Response.json({ files: [{ name: 'a' }, { name: 'b' }] })
    }))

    await expect(countAccounts({ baseUrl: 'http://127.0.0.1:8317', key: 'mgmt-key' })).resolves.toBe(3)
  })

  it('returns undefined on probe failure or missing endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))

    await expect(countAccounts({ baseUrl: 'http://127.0.0.1:8317', key: 'mgmt-key' })).resolves.toBeUndefined()
    await expect(countAccounts(undefined)).resolves.toBeUndefined()
  })
})
