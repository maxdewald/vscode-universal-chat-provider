import type { CatalogModel } from '@src/chat/models/catalog'
import type { OpenAICompatibilityProvider } from '@src/cliproxy/api/management-client'
import type { Memento } from 'vscode'
import { Type } from '@sinclair/typebox'
import { fetchCatalog } from '@src/chat/models/catalog'
import { enrichOpenAICompatibilityProviders } from '@src/cliproxy/accounts/openai-compat-thinking'
import { asValue } from '@src/shared/json'
import { ProgressLocation, window } from 'vscode'

const LAST_OPENAI_BASE_URL_KEY = 'universalChatProvider.lastOpenAIBaseUrl'

export interface OpenAICompatibilityDraft {
  baseUrl: string
  apiKey: string
  modelIds: string[]
  catalog: ReadonlyMap<string, CatalogModel>
}

export async function promptOpenAICompatibilityEndpoint(
  state?: Pick<Memento, 'get' | 'update'>,
): Promise<OpenAICompatibilityDraft | undefined> {
  const baseUrl = await window.showInputBox({
    title: 'OpenAI-compatible base URL',
    value: state?.get<string>(LAST_OPENAI_BASE_URL_KEY) ?? '',
    prompt: 'Must include the /v1 path when the provider uses one (e.g. https://openrouter.ai/api/v1).',
    placeHolder: 'https://openrouter.ai/api/v1',
    ignoreFocusOut: true,
    validateInput: value => value.trim() === '' || !isHttpUrl(value.trim())
      ? 'Enter an http(s) base URL.'
      : undefined,
  })
  if (baseUrl === undefined)
    return undefined
  await state?.update(LAST_OPENAI_BASE_URL_KEY, baseUrl.trim())

  const apiKey = await window.showInputBox({
    title: 'API key',
    prompt: 'Provider API key (stored in CLIProxyAPI config, not VS Code SecretStorage).',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim() === '' ? 'API key is required.' : undefined,
  })
  if (apiKey === undefined)
    return undefined

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const normalizedApiKey = apiKey.trim()
  const [discovered, catalog] = await window.withProgress(
    { location: ProgressLocation.Notification, title: 'Fetching models from endpoint…' },
    async () => Promise.all([
      discoverUpstreamModels(normalizedBaseUrl, normalizedApiKey),
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
      return undefined
    modelIds = parseModelIds(modelsRaw)
    if (modelIds.length === 0)
      return undefined
  }

  return { baseUrl: normalizedBaseUrl, apiKey: normalizedApiKey, modelIds, catalog }
}

export function buildOpenAICompatibilityProvider(
  draft: OpenAICompatibilityDraft,
  existing: readonly OpenAICompatibilityProvider[],
): OpenAICompatibilityProvider {
  const baseName = new URL(draft.baseUrl).hostname.replace(/^www\./, '')
  const providerName = uniqueProviderName(baseName, existing.map(entry => entry.name))
  const models = draft.modelIds.map(name => ({ name, alias: `${providerName}/${name}` }))
  const provider: OpenAICompatibilityProvider = {
    'name': providerName,
    'base-url': draft.baseUrl,
    'api-key-entries': [{ 'api-key': draft.apiKey }],
    models,
  }
  enrichOpenAICompatibilityProviders([provider], draft.catalog)
  return provider
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
    return uniqueModelIds((payload?.data ?? []).map(model => model.id))
  }
  catch {
    return []
  }
}

function parseModelIds(value: string): string[] {
  return uniqueModelIds(value.split(/[\n,]/))
}

function uniqueModelIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => value !== undefined && value.length > 0))]
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
