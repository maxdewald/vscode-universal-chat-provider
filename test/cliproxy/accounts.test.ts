import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsService } from '../../src/cliproxy/accounts'
import { ManagementClient } from '../../src/cliproxy/management-client'
import { resetVSCodeMock, window } from '../support/vscode'

describe('accounts login completion', () => {
  beforeEach(() => {
    resetVSCodeMock()
    vi.useFakeTimers()
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI Codex',
      detail: 'ChatGPT / Codex account',
      provider: { label: 'OpenAI Codex', detail: 'ChatGPT / Codex account', endpoint: 'codex-auth-url' },
    })
    vi.spyOn(ManagementClient.prototype, 'requestAuthUrl').mockResolvedValue('https://example.com/auth')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('treats a same-email auth overwrite as completed login', async () => {
    const files = [
      { name: 'codex-user.json', provider: 'codex', email: 'same@example.com', expires_at: '2026-01-01T00:00:00Z' },
    ]
    const list = vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw')
      .mockResolvedValueOnce([...files])
      .mockImplementation(async () => [{ ...files[0], expires_at: '2026-07-20T00:00:00Z' }])
    const onAccountsChanged = vi.fn()
    const service = new AccountsService({
      resolveManagement: async () => ({ baseUrl: 'http://127.0.0.1:8317', key: 'k' }),
      currentManagement: () => undefined,
      onAccountsChanged,
    })

    const done = service.login()
    await vi.advanceTimersByTimeAsync(1_500)
    await done

    expect(list).toHaveBeenCalled()
    expect(window.showInformationMessage).toHaveBeenCalledWith('OpenAI Codex account connected.')
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
    expect(window.showWarningMessage).not.toHaveBeenCalled()
  })

  it('completes when a new auth file appears', async () => {
    const list = vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw')
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'codex-new.json', provider: 'codex' }])
    const onAccountsChanged = vi.fn()
    const service = new AccountsService({
      resolveManagement: async () => ({ baseUrl: 'http://127.0.0.1:8317', key: 'k' }),
      currentManagement: () => undefined,
      onAccountsChanged,
    })

    const done = service.login()
    await vi.advanceTimersByTimeAsync(1_500)
    await done

    expect(window.showInformationMessage).toHaveBeenCalledWith('OpenAI Codex account connected.')
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
  })
})
