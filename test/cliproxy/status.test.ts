import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countAccounts } from '../../src/cliproxy/status'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('countAccounts', () => {
  it('counts auth files when the management endpoint responds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: [{ name: 'a' }, { name: 'b' }] })))

    await expect(countAccounts({ baseUrl: 'http://127.0.0.1:8317', key: 'mgmt-key' })).resolves.toBe(2)
  })

  it('returns undefined on probe failure or missing endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))

    await expect(countAccounts({ baseUrl: 'http://127.0.0.1:8317', key: 'mgmt-key' })).resolves.toBeUndefined()
    await expect(countAccounts(undefined)).resolves.toBeUndefined()
  })
})
