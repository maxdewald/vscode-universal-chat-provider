import type { CatalogModel } from '../../src/chat/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsService } from '../../src/cliproxy/accounts'
import { ManagementClient } from '../../src/cliproxy/management-client'
import { resetVSCodeMock, window } from '../support/vscode'

const catalogMocks = vi.hoisted(() => ({
  fetchCatalog: vi.fn<() => Promise<Map<string, CatalogModel>>>(),
}))

vi.mock('../../src/chat/catalog', () => ({
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
    vi.spyOn(ManagementClient.prototype, 'listAuthFilesRaw')
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
    const { service, onAccountsChanged } = serviceWith()

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
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
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
    const { service } = serviceWith({
      currentManagement: () => ({ baseUrl: 'http://127.0.0.1:8317', key: 'k' }),
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
    const { service, onAccountsChanged } = serviceWith()

    await service.manageAccounts()

    expect(del).toHaveBeenCalledWith('opencode.ai')
    expect(onAccountsChanged).toHaveBeenCalledTimes(1)
  })
})

function serviceWith(
  overrides: Partial<ConstructorParameters<typeof AccountsService>[0]> = {},
): { service: AccountsService, onAccountsChanged: ReturnType<typeof vi.fn> } {
  const onAccountsChanged = vi.fn()
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
