import type { CatalogModel } from '@src/chat/models/catalog'
import { AccountsService } from '@src/cliproxy/accounts/accounts'
import { ManagementClient } from '@src/cliproxy/api/management-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetVSCodeMock, window } from '../../support/vscode'

const catalogMocks = vi.hoisted(() => ({
  fetchCatalog: vi.fn<() => Promise<Map<string, CatalogModel>>>(),
}))

vi.mock('../../../src/chat/models/catalog', () => ({
  fetchCatalog: catalogMocks.fetchCatalog,
}))

describe('accounts login completion', () => {
  beforeEach(() => {
    resetVSCodeMock()
    vi.useFakeTimers()
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI Codex',
      detail: 'ChatGPT / Codex account',
      account: 'oauth',
      provider: { label: 'OpenAI Codex', detail: 'ChatGPT / Codex account', endpoint: 'codex-auth-url', provider: 'codex' },
    })
    vi.spyOn(ManagementClient.prototype, 'requestAuthUrl').mockResolvedValue({ url: 'https://example.com/auth', state: 'oauth-state' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      name: 'a same-email auth overwrite',
      before: [
        { name: 'codex-user.json', provider: 'codex', email: 'same@example.com', expires_at: '2026-01-01T00:00:00Z' },
      ],
      after: [
        { name: 'codex-user.json', provider: 'codex', email: 'same@example.com', expires_at: '2026-07-20T00:00:00Z' },
      ],
    },
    {
      name: 'a new auth file',
      before: [],
      after: [{ name: 'codex-new.json', provider: 'codex' }],
    },
  ])('completes login after $name appears', async ({ before, after }) => {
    const list = vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw')
      .mockResolvedValueOnce(before)
      .mockResolvedValue(after)
    vi.spyOn(ManagementClient.prototype, 'getAuthStatus').mockResolvedValue({ status: 'ok' })
    vi.spyOn(ManagementClient.prototype, 'listAuthFileModels').mockResolvedValue(['gpt-5.5'])
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

  it('reports server-declared login errors without refreshing models', async () => {
    vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw').mockResolvedValue([])
    vi.spyOn(ManagementClient.prototype, 'getAuthStatus').mockResolvedValue({ status: 'error', error: 'access denied' })
    const { service, onAccountsChanged } = serviceWith()

    const done = service.login()
    await vi.advanceTimersByTimeAsync(1_500)
    await done

    expect(window.showErrorMessage).toHaveBeenCalledWith('OpenAI Codex sign-in failed: access denied')
    expect(onAccountsChanged).not.toHaveBeenCalled()
  })

  it('shares one account picker across concurrent login requests', async () => {
    let resolvePick!: (value: undefined) => void
    window.showQuickPick.mockReturnValue(new Promise(resolve => resolvePick = resolve))
    const { service } = serviceWith()

    const first = service.login()
    const second = service.login()
    await vi.waitFor(() => expect(window.showQuickPick).toHaveBeenCalledTimes(1))
    resolvePick(undefined)

    await Promise.all([first, second])
  })
})

describe('openai-compatible endpoint', () => {
  beforeEach(() => {
    resetVSCodeMock()
    vi.unstubAllGlobals()
    catalogMocks.fetchCatalog.mockReset().mockResolvedValue(new Map([
      ['gpt-5.5', {
        id: 'gpt-5.5',
        thinking: { levels: ['low', 'medium', 'high', 'xhigh'] },
      }],
      ['gpt-5.6-sol', {
        id: 'gpt-5.6-sol',
        thinking: { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      }],
    ]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('remembers only the last base URL', async () => {
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI-compatible endpoint',
      account: 'openai-compatibility',
    })
    window.showInputBox
      .mockResolvedValueOnce(' https://new.example/v1 ')
      .mockResolvedValueOnce(undefined)
    const values = new Map<string, unknown>([
      ['universalChatProvider.lastOpenAIBaseUrl', 'https://old.example/v1'],
    ])
    const { service } = serviceWith({
      state: {
        get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
        update: async (key: string, value: unknown) => void values.set(key, value),
      },
    })

    await service.login()

    expect(window.showInputBox.mock.calls[0]?.[0]).toMatchObject({ value: 'https://old.example/v1' })
    expect(window.showInputBox.mock.calls[1]?.[0]).not.toHaveProperty('value')
    expect(values.get('universalChatProvider.lastOpenAIBaseUrl')).toBe('https://new.example/v1')
  })

  it('falls back to manual models when /v1/models is unavailable', async () => {
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI-compatible endpoint',
      account: 'openai-compatibility',
    })
    window.showInputBox
      .mockResolvedValueOnce('https://opencode.ai/v1/')
      .mockResolvedValueOnce('sk-test')
      .mockResolvedValueOnce('claude-opus-4-8, gpt-5.5')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))

    const put = vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([
      {
        'name': 'openrouter',
        'base-url': 'https://openrouter.ai/api/v1',
        'api-key-entries': [{ 'api-key': 'old' }],
        'models': [{ name: 'x' }],
      },
    ])
    const persistOpenAICompatibility = vi.fn<() => Promise<void>>().mockResolvedValue()
    const { service, onAccountsChanged } = serviceWith({ persistOpenAICompatibility })

    await service.login()

    expect(put).toHaveBeenCalledWith([
      {
        'name': 'openrouter',
        'base-url': 'https://openrouter.ai/api/v1',
        'api-key-entries': [{ 'api-key': 'old' }],
        'models': [{ name: 'x' }],
      },
      {
        'name': 'opencode.ai',
        'base-url': 'https://opencode.ai/v1',
        'api-key-entries': [{ 'api-key': 'sk-test' }],
        'models': [
          { name: 'claude-opus-4-8', alias: 'opencode.ai/claude-opus-4-8' },
          {
            name: 'gpt-5.5',
            alias: 'opencode.ai/gpt-5.5',
            thinking: { levels: ['low', 'medium', 'high', 'xhigh'] },
          },
        ],
      },
    ])
    expect(persistOpenAICompatibility).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'opencode.ai' }),
    ]))
    expect(window.showInformationMessage).toHaveBeenCalledWith('OpenAI-compatible endpoint “opencode.ai” added (2 models).')
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
  })

  it('exposes every model discovered from /v1/models', async () => {
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI-compatible endpoint',
      account: 'openai-compatibility',
    })
    window.showInputBox
      .mockResolvedValueOnce('https://openrouter.ai/api/v1')
      .mockResolvedValueOnce('sk-or')
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/models')
      return Response.json({ data: [{ id: 'gpt-5.5' }, { id: 'claude-opus-4-8' }] })
    }))

    const put = vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([])
    const { service, onAccountsChanged } = serviceWith()

    await service.login()

    expect(put).toHaveBeenCalledWith([
      {
        'name': 'openrouter.ai',
        'base-url': 'https://openrouter.ai/api/v1',
        'api-key-entries': [{ 'api-key': 'sk-or' }],
        'models': [
          {
            name: 'gpt-5.5',
            alias: 'openrouter.ai/gpt-5.5',
            thinking: { levels: ['low', 'medium', 'high', 'xhigh'] },
          },
          { name: 'claude-opus-4-8', alias: 'openrouter.ai/claude-opus-4-8' },
        ],
      },
    ])
    expect(window.showInputBox).toHaveBeenCalledTimes(2)
    expect(onAccountsChanged).toHaveBeenCalledWith([
      'openrouter.ai/gpt-5.5',
      'openrouter.ai/claude-opus-4-8',
    ])
  })

  it('refreshes models when persistence fails after the live endpoint update', async () => {
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI-compatible endpoint',
      account: 'openai-compatibility',
    })
    window.showInputBox
      .mockResolvedValueOnce('https://openrouter.ai/api/v1')
      .mockResolvedValueOnce('sk-or')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'gpt-5.5' }] })))
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([])
    vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
    const persistOpenAICompatibility = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('storage full'))
    const { service, onAccountsChanged } = serviceWith({ persistOpenAICompatibility })

    await service.login()

    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
    expect(window.showErrorMessage).toHaveBeenCalledWith('Could not add OpenAI-compatible endpoint: storage full')
  })

  it('enriches existing openai-compatible providers missing thinking levels', async () => {
    const put = vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-test' }],
        'models': [
          { name: 'gpt-5.6-sol', alias: 'codegate.dev/gpt-5.6-sol' },
          {
            name: 'gpt-5.5',
            alias: 'codegate.dev/gpt-5.5',
            thinking: { levels: ['low', 'high'] },
          },
        ],
      },
    ])
    const persistOpenAICompatibility = vi.fn<() => Promise<void>>().mockResolvedValue()
    const { service } = serviceWith({
      currentManagement: () => ({ baseUrl: 'http://127.0.0.1:8317', key: 'k' }),
      persistOpenAICompatibility,
    })

    await expect(service.enrichThinkingLevels(await catalogMocks.fetchCatalog())).resolves.toBe(true)
    expect(put).toHaveBeenCalledWith([
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-test' }],
        'models': [
          {
            name: 'gpt-5.6-sol',
            alias: 'codegate.dev/gpt-5.6-sol',
            thinking: { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
          },
          {
            name: 'gpt-5.5',
            alias: 'codegate.dev/gpt-5.5',
            thinking: { levels: ['low', 'high'] },
          },
        ],
      },
    ])
    expect(persistOpenAICompatibility).toHaveBeenCalledWith(put.mock.calls[0]?.[0])
  })

  it('keeps same-url endpoints with different tokens under unique names', async () => {
    window.showQuickPick.mockResolvedValue({
      label: 'OpenAI-compatible endpoint',
      account: 'openai-compatibility',
    })
    window.showInputBox
      .mockResolvedValueOnce('https://codegate.dev/v1')
      .mockResolvedValueOnce('sk-second')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'claude-opus-4-8' }] })))

    const put = vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-first' }],
        'models': [{ name: 'claude-opus-4-8', alias: 'codegate.dev/claude-opus-4-8' }],
      },
    ])
    const { service, onAccountsChanged } = serviceWith()

    await service.login()

    expect(put).toHaveBeenCalledWith([
      {
        'name': 'codegate.dev',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-first' }],
        'models': [{ name: 'claude-opus-4-8', alias: 'codegate.dev/claude-opus-4-8' }],
      },
      {
        'name': 'codegate.dev-2',
        'base-url': 'https://codegate.dev/v1',
        'api-key-entries': [{ 'api-key': 'sk-second' }],
        'models': [{ name: 'claude-opus-4-8', alias: 'codegate.dev-2/claude-opus-4-8' }],
      },
    ])
    expect(window.showInformationMessage).toHaveBeenCalledWith('OpenAI-compatible endpoint “codegate.dev-2” added (1 models).')
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
  })

  it('removes openai-compatibility providers from manage accounts', async () => {
    vi.spyOn(ManagementClient.prototype, 'listAuthFiles').mockResolvedValue([])
    vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([
      { 'name': 'opencode.ai', 'base-url': 'https://opencode.ai/v1' },
    ])
    const del = vi.spyOn(ManagementClient.prototype, 'deleteOpenAICompatibility').mockResolvedValue()
    window.showQuickPick.mockResolvedValue({
      label: 'opencode.ai',
      description: 'openai-compatibility',
      account: 'openai-compatibility',
    })
    window.showWarningMessage.mockResolvedValue('Remove')
    const persistOpenAICompatibility = vi.fn<() => Promise<void>>().mockResolvedValue()
    const { service, onAccountsChanged } = serviceWith({ persistOpenAICompatibility })

    await service.manageAccounts()

    expect(del).toHaveBeenCalledWith('opencode.ai')
    expect(persistOpenAICompatibility).toHaveBeenCalledWith([])
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
  })
})

function serviceWith(
  overrides: Partial<ConstructorParameters<typeof AccountsService>[0]> = {},
): { service: AccountsService, onAccountsChanged: ReturnType<typeof vi.fn> } {
  const onAccountsChanged = vi.fn(async () => {})
  return {
    onAccountsChanged,
    service: new AccountsService({
      resolveManagement: async () => ({ baseUrl: 'http://127.0.0.1:8317', key: 'k' }),
      currentManagement: () => undefined,
      onAccountsChanged,
      ...overrides,
    }),
  }
}
