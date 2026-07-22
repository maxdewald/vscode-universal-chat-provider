import type { CatalogModel } from '../chat/catalog'
import type { ManagementEndpoint, OpenAICompatibilityProvider } from './management-client'
import { Type } from '@sinclair/typebox'
import { sleep } from 'moderndash'
import { env, ProgressLocation, Uri, window } from 'vscode'
import { fetchCatalog } from '../chat/catalog'
import { errorMessage } from '../shared/errors'
import { asValue } from '../shared/json'
import { LOGIN_PROVIDERS, ManagementClient } from './management-client'
import { enrichOpenAICompatibilityProviders } from './openai-compat-thinking'

const LOGIN_TIMEOUT_MS = 180_000
const LOGIN_POLL_MS = 1500

export interface AccountsDeps {
  resolveManagement: (start: boolean) => Promise<ManagementEndpoint | undefined>
  currentManagement: () => ManagementEndpoint | undefined
  persistOpenAICompatibility?: (providers: OpenAICompatibilityProvider[]) => Promise<void>
  onAccountsChanged: () => void
}

export class AccountsService {
  private loginPrompted = false

  constructor(private readonly deps: AccountsDeps) {}

  reset(): void {
    this.loginPrompted = false
  }

  async login(): Promise<void> {
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
    let url: string
    let before: string
    try {
      // ponytail: whole-blob compare; catches same-email overwrite (count stays flat).
      // Byte-identical re-login won't trip this; fresh logins always rotate the token.
      before = JSON.stringify(await client.listAuthFilesRaw())
      url = await client.requestAuthUrl(picked.provider.endpoint)
    }
    catch (error) {
      void window.showErrorMessage(`Could not start ${picked.provider.label} login: ${errorMessage(error)}`)
      return
    }

    const opened = await env.openExternal(Uri.parse(url))
    if (!opened) {
      void window.showWarningMessage(`Open this URL to finish signing in: ${url}`)
      return
    }

    const connected = await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: true, title: `Waiting for ${picked.provider.label} sign-in…` },
      async (_progress, token) => {
        const deadline = Date.now() + LOGIN_TIMEOUT_MS
        while (Date.now() < deadline && !token.isCancellationRequested) {
          await sleep(LOGIN_POLL_MS)
          const files = await client.listAuthFilesRaw().catch(() => undefined)
          if (files !== undefined && JSON.stringify(files) !== before)
            return true
        }
        return false
      },
    )

    if (connected) {
      void window.showInformationMessage(`${picked.provider.label} account connected.`)
      this.deps.onAccountsChanged()
    }
    else {
      void window.showWarningMessage(`${picked.provider.label} sign-in did not complete. Check Show Logs and try again.`)
    }
  }

  private async addOpenAIEndpoint(client: ManagementClient): Promise<void> {
    const baseUrl = await window.showInputBox({
      title: 'OpenAI-compatible base URL',
      prompt: 'Must include the /v1 path when the provider uses one (e.g. https://openrouter.ai/api/v1).',
      placeHolder: 'https://openrouter.ai/api/v1',
      ignoreFocusOut: true,
      validateInput: value => value.trim() === '' || !isHttpUrl(value.trim())
        ? 'Enter an http(s) base URL.'
        : undefined,
    })
    if (baseUrl === undefined)
      return

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
      await this.deps.persistOpenAICompatibility?.(updated)
      void window.showInformationMessage(`OpenAI-compatible endpoint “${provider.name}” added (${models.length} models).`)
      this.deps.onAccountsChanged()
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
      this.deps.onAccountsChanged()
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
