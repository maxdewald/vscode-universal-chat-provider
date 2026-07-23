import type { CatalogModel } from '@src/chat/models/catalog'
import type { AuthFileRaw, AuthSession, ManagementEndpoint, OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import type { CancellationToken, Memento } from 'vscode'
import { Type } from '@sinclair/typebox'
import { fetchCatalog } from '@src/chat/models/catalog'
import { enrichOpenAICompatibilityProviders } from '@src/cliproxy/accounts/openai-compat-thinking'
import { LOGIN_PROVIDERS, ManagementClient } from '@src/cliproxy/api/management-client'
import { errorMessage } from '@src/shared/errors'
import { asValue } from '@src/shared/json'
import { sleep } from 'moderndash'
import { env, ProgressLocation, Uri, window } from 'vscode'

const LOGIN_TIMEOUT_MS = 180_000
const LOGIN_POLL_MS = 1500
const LAST_OPENAI_BASE_URL_KEY = 'universalChatProvider.lastOpenAIBaseUrl'

export interface AccountsDeps {
  resolveManagement: (start: boolean) => Promise<ManagementEndpoint | undefined>
  currentManagement: () => ManagementEndpoint | undefined
  state?: Pick<Memento, 'get' | 'update'>
  persistOpenAICompatibility?: (providers: OpenAICompatibilityProvider[]) => Promise<void>
  onAccountsChanged: (expectedModelIds?: readonly string[]) => Promise<void>
}

export class AccountsService {
  private loginPrompted = false
  private loginPromise: Promise<void> | undefined

  constructor(private readonly deps: AccountsDeps) {}

  reset(): void {
    this.loginPrompted = false
  }

  async login(): Promise<void> {
    this.loginPromise ??= this.doLogin().finally(() => {
      this.loginPromise = undefined
    })
    return this.loginPromise
  }

  private async doLogin(): Promise<void> {
    const management = await this.deps.resolveManagement(true)
    if (management === undefined)
      return

    const picked = await window.showQuickPick(
      [
        ...LOGIN_PROVIDERS.map(provider => ({ label: provider.label, detail: provider.detail, account: 'oauth' as const, provider })),
        {
          label: 'OpenAI-compatible endpoint',
          detail: 'API key + base URL (OpenCode, OpenRouter, …)',
          account: 'openai-compatibility' as const,
        },
      ],
      { title: 'Connect a CLIProxyAPI Account', placeHolder: 'Choose a provider to sign in with' },
    )
    if (picked === undefined)
      return
    if (picked.account === 'openai-compatibility') {
      await this.addOpenAIEndpoint(new ManagementClient(management.baseUrl, management.key))
      return
    }

    const client = new ManagementClient(management.baseUrl, management.key)
    let session: AuthSession
    let before: AuthFileRaw[]
    try {
      before = await client.listAuthFilesRaw()
      session = await client.requestAuthUrl(picked.provider.endpoint)
    }
    catch (error) {
      void window.showErrorMessage(`Could not start ${picked.provider.label} login: ${errorMessage(error)}`)
      return
    }

    const opened = await env.openExternal(Uri.parse(session.url))
    if (!opened) {
      void window.showWarningMessage(`Open this URL to finish signing in: ${session.url}`)
      return
    }

    const result = await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: true, title: `Waiting for ${picked.provider.label} sign-in…` },
      async (_progress, token) => this.waitForLogin(client, session, picked.provider.provider, before, token),
    )

    if (result.status === 'ok') {
      await this.deps.onAccountsChanged()
      void window.showInformationMessage(`${picked.provider.label} account connected.`)
    }
    else if (result.status === 'error') {
      void window.showErrorMessage(`${picked.provider.label} sign-in failed: ${result.error}`)
    }
    else {
      void window.showWarningMessage(`${picked.provider.label} sign-in did not complete. Check Show Logs and try again.`)
    }
  }

  private async waitForLogin(
    client: ManagementClient,
    session: AuthSession,
    expectedProvider: string,
    before: AuthFileRaw[],
    token: CancellationToken,
  ): Promise<{ status: 'wait' | 'ok' } | { status: 'error', error: string }> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS

    while (Date.now() < deadline && !token.isCancellationRequested) {
      await sleep(LOGIN_POLL_MS)
      const status = await client.getAuthStatus(session.state).catch(() => undefined)
      if (status?.status === 'error')
        return status
      if (status?.status === 'ok' && await this.waitForRuntimeModels(client, expectedProvider, before, deadline, token))
        return status
    }

    if (token.isCancellationRequested)
      await client.cancelAuthSession(session.state).catch(() => undefined)
    return { status: 'wait' }
  }

  private async waitForRuntimeModels(
    client: ManagementClient,
    expectedProvider: string,
    before: AuthFileRaw[],
    deadline: number,
    token: CancellationToken,
  ): Promise<boolean> {
    const beforeFiles = new Map(before.map(file => [file.name ?? file.auth_index, JSON.stringify(file)]))
    while (Date.now() < deadline && !token.isCancellationRequested) {
      const after = await client.listAuthFilesRaw().catch(() => undefined)
      const added = after?.find((file) => {
        const name = file.name ?? file.auth_index
        return name !== undefined
          && (file.provider === expectedProvider || file.type === expectedProvider)
          && beforeFiles.get(name) !== JSON.stringify(file)
      })
      if (added === undefined) {
        await sleep(LOGIN_POLL_MS)
        continue
      }
      const name = added.name ?? added.auth_index!
      if ((await client.listAuthFileModels(name).catch(() => [])).length > 0)
        return true
      await sleep(LOGIN_POLL_MS)
    }
    return false
  }

  private async addOpenAIEndpoint(client: ManagementClient): Promise<void> {
    const baseUrl = await window.showInputBox({
      title: 'OpenAI-compatible base URL',
      value: this.deps.state?.get<string>(LAST_OPENAI_BASE_URL_KEY) ?? '',
      prompt: 'Must include the /v1 path when the provider uses one (e.g. https://openrouter.ai/api/v1).',
      placeHolder: 'https://openrouter.ai/api/v1',
      ignoreFocusOut: true,
      validateInput: value => value.trim() === '' || !isHttpUrl(value.trim())
        ? 'Enter an http(s) base URL.'
        : undefined,
    })
    if (baseUrl === undefined)
      return
    await this.deps.state?.update(LAST_OPENAI_BASE_URL_KEY, baseUrl.trim())

    const apiKey = await window.showInputBox({
      title: 'API key',
      prompt: 'Provider API key (stored in CLIProxyAPI config, not VS Code SecretStorage).',
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.trim() === '' ? 'API key is required.' : undefined,
    })
    if (apiKey === undefined)
      return

    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    const [discovered, catalog] = await window.withProgress(
      { location: ProgressLocation.Notification, title: 'Fetching models from endpoint…' },
      async () => Promise.all([
        discoverUpstreamModels(normalizedBaseUrl, apiKey.trim()),
        fetchCatalog(),
      ]),
    )

    let modelIds = discovered
    if (modelIds.length === 0) {
      const modelsRaw = await window.showInputBox({
        title: 'Models',
        prompt: 'Endpoint did not list models. Enter comma-separated model IDs.',
        placeHolder: 'claude-opus-4-8, gpt-5.5',
        ignoreFocusOut: true,
        validateInput: value => parseModelIds(value).length === 0
          ? 'Enter at least one model ID.'
          : undefined,
      })
      if (modelsRaw === undefined)
        return
      modelIds = parseModelIds(modelsRaw)
      if (modelIds.length === 0)
        return
    }

    try {
      const existing = await client.listOpenAICompatibility()
      const baseName = new URL(normalizedBaseUrl).hostname.replace(/^www\./, '')
      const providerName = uniqueProviderName(baseName, existing.map(entry => entry.name))
      const models = modelIds.map(name => ({ name, alias: `${providerName}/${name}` }))
      const provider: OpenAICompatibilityProvider = {
        'name': providerName,
        'base-url': normalizedBaseUrl,
        'api-key-entries': [{ 'api-key': apiKey.trim() }],
        models,
      }
      enrichOpenAICompatibilityProviders([provider], catalog)
      const updated = [...existing, provider]
      await client.putOpenAICompatibility(updated)
      try {
        await this.deps.persistOpenAICompatibility?.(updated)
      }
      finally {
        await this.deps.onAccountsChanged(models.map(model => model.alias))
      }
      void window.showInformationMessage(`OpenAI-compatible endpoint “${provider.name}” added (${models.length} models).`)
    }
    catch (error) {
      void window.showErrorMessage(`Could not add OpenAI-compatible endpoint: ${errorMessage(error)}`)
    }
  }

  async enrichThinkingLevels(catalog: ReadonlyMap<string, CatalogModel>): Promise<boolean> {
    const management = this.deps.currentManagement()
    if (management === undefined)
      return false
    try {
      const client = new ManagementClient(management.baseUrl, management.key)
      const existing = await client.listOpenAICompatibility()
      if (!enrichOpenAICompatibilityProviders(existing, catalog))
        return false
      await client.putOpenAICompatibility(existing)
      await this.deps.persistOpenAICompatibility?.(existing)
      return true
    }
    catch {
      return false
    }
  }

  async manageAccounts(): Promise<void> {
    const management = await this.deps.resolveManagement(false)
    if (management === undefined)
      return
    const client = new ManagementClient(management.baseUrl, management.key)
    const [files, endpoints] = await Promise.all([
      client.listAuthFiles().catch((error): undefined => {
        void window.showErrorMessage(`Could not list accounts: ${errorMessage(error)}`)
        return undefined
      }),
      client.listOpenAICompatibility().catch((): OpenAICompatibilityProvider[] => []),
    ])
    if (files === undefined)
      return
    if (files.length === 0 && endpoints.length === 0) {
      const choice = await window.showInformationMessage('No accounts are connected.', 'Add Account')
      if (choice === 'Add Account')
        await this.login()
      return
    }

    const picked = await window.showQuickPick(
      [
        ...files.map(file => ({
          label: file.name,
          ...(file.type !== undefined ? { description: file.type } : {}),
          account: 'oauth' as const,
        })),
        ...endpoints.map(endpoint => ({
          label: endpoint.name,
          description: 'openai-compatibility',
          detail: endpoint['base-url'],
          account: 'openai-compatibility' as const,
        })),
      ],
      { title: 'Connected Accounts', placeHolder: 'Select an account to remove' },
    )
    if (picked === undefined)
      return
    const confirm = await window.showWarningMessage(`Remove the account ${picked.label}?`, { modal: true }, 'Remove')
    if (confirm !== 'Remove')
      return
    try {
      if (picked.account === 'openai-compatibility') {
        await client.deleteOpenAICompatibility(picked.label)
        await this.deps.persistOpenAICompatibility?.(endpoints.filter(endpoint => endpoint.name !== picked.label))
      }
      else {
        await client.deleteAuthFile(picked.label)
      }
      void window.showInformationMessage(`Removed ${picked.label}.`)
      await this.deps.onAccountsChanged()
    }
    catch (error) {
      void window.showErrorMessage(`Could not remove ${picked.label}: ${errorMessage(error)}`)
    }
  }

  async maybePromptLogin(): Promise<void> {
    if (this.loginPrompted)
      return
    const management = this.deps.currentManagement()
    if (management === undefined)
      return
    this.loginPrompted = true
    try {
      const client = new ManagementClient(management.baseUrl, management.key)
      const [files, endpoints] = await Promise.all([
        client.listAuthFiles(),
        client.listOpenAICompatibility().catch((): OpenAICompatibilityProvider[] => []),
      ])
      if (files.length > 0 || endpoints.length > 0)
        return
      const choice = await window.showInformationMessage(
        'CLIProxyAPI is running but no model accounts are connected yet.',
        'Add Account',
        'Later',
      )
      if (choice === 'Add Account')
        await this.login()
    }
    catch {}
  }
}

const UpstreamModelsSchema = Type.Object({
  data: Type.Optional(Type.Array(Type.Object({
    id: Type.Optional(Type.String()),
  }, { additionalProperties: true }))),
}, { additionalProperties: true })

async function discoverUpstreamModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok)
      return []
    const payload = asValue(UpstreamModelsSchema, await response.json())
    const ids = (payload?.data ?? [])
      .map(model => model.id?.trim())
      .filter((id): id is string => id !== undefined && id.length > 0)
    return [...new Set(ids)]
  }
  catch {
    return []
  }
}

function parseModelIds(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(part => part.trim()).filter(Boolean))]
}

function uniqueProviderName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(name => name.toLowerCase()))
  if (!taken.has(base.toLowerCase()))
    return base
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`
    if (!taken.has(candidate.toLowerCase()))
      return candidate
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}
