import { discoverAuthorizedClaudeModels } from '@src/cliproxy/accounts/claude-models'
import { ManagementClient } from '@src/cliproxy/api/management-client'
import { describe, expect, it, vi } from 'vitest'

describe('Claude model discovery', () => {
  it('unions the model lists returned by authenticated Claude accounts', async () => {
    const client = {
      listAuthFilesRaw: vi.fn(async () => [
        { type: 'claude', auth_index: 'one' },
        { provider: 'claude', auth_index: 'two' },
        { provider: 'codex', auth_index: 'three' },
      ]),
      apiCall: vi.fn(async ({ auth_index }: { auth_index: string }) => ({
        statusCode: 200,
        header: {},
        body: JSON.stringify({ data: [{ id: `claude-${auth_index}` }] }),
      })),
    } as unknown as ManagementClient

    await expect(discoverAuthorizedClaudeModels(client)).resolves.toEqual(new Set(['claude-one', 'claude-two']))
    expect(client.apiCall).toHaveBeenCalledTimes(2)
  })

  it('keeps the proxy model list when the upstream endpoint is unavailable', async () => {
    const client = {
      listAuthFilesRaw: vi.fn(async () => [{ type: 'claude', auth_index: 'one' }]),
      apiCall: vi.fn(async () => ({ statusCode: 404, header: {}, body: {} })),
    } as unknown as ManagementClient

    await expect(discoverAuthorizedClaudeModels(client)).resolves.toBeUndefined()
  })
})