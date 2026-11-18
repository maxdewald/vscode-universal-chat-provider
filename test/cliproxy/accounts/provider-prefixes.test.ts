import type { AuthFileRaw, ManagementClient } from '@src/cliproxy/api/management-client'
import { pinAccountsToProviders } from '@src/cliproxy/accounts/provider-prefixes'
import { describe, expect, it, vi } from 'vitest'

function client(files: AuthFileRaw[], models: Record<string, string[]>, setPrefix = vi.fn(async (_name: string) => {})) {
  return {
    client: {
      listAuthFilesRaw: vi.fn(async () => files),
      listAuthFileModels: vi.fn(async (name: string) => models[name] ?? []),
      setAuthFilePrefix: setPrefix,
    } as unknown as ManagementClient,
    setPrefix,
  }
}

describe('pinAccountsToProviders', () => {
  it('prefixes unpinned accounts with their provider so retries stay within it', async () => {
    const { client: management, setPrefix } = client(
      [
        { name: 'claude.json', provider: 'claude' },
        { name: 'anti.json', type: 'antigravity' },
        { name: 'pinned.json', provider: 'codex' },
      ],
      {
        'claude.json': ['claude-sonnet-4-6'],
        'anti.json': ['claude-sonnet-4-6', 'gemini-3-flash'],
        'pinned.json': ['codex/gpt-5.5'],
      },
    )

    await pinAccountsToProviders(management, vi.fn())

    expect(setPrefix.mock.calls).toEqual([
      ['claude.json', 'claude', undefined],
      ['anti.json', 'antigravity', undefined],
    ])
  })

  it('keeps a prefix the user already chose', async () => {
    const { client: management, setPrefix } = client(
      [{ name: 'team.json', provider: 'claude' }],
      { 'team.json': ['team/claude-opus-5'] },
    )

    await pinAccountsToProviders(management, vi.fn())

    expect(setPrefix).not.toHaveBeenCalled()
  })

  it('logs a failed account and continues with the rest', async () => {
    const setPrefix = vi.fn(async (name: string) => {
      if (name === 'a.json')
        throw new Error('locked')
    })
    const log = vi.fn()
    const { client: management } = client(
      [{ name: 'a.json', provider: 'claude' }, { name: 'b.json', provider: 'codex' }],
      { 'a.json': ['claude-opus-5'], 'b.json': ['gpt-5.5'] },
      setPrefix,
    )

    await pinAccountsToProviders(management, log)

    expect(setPrefix).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('Could not pin claude account a.json: locked')
    expect(log).toHaveBeenCalledWith('Pinned codex account b.json to its own provider.')
  })
})
