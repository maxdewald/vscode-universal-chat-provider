import type { Static } from '@sinclair/typebox'
import type { BeforeErrorHook, KyInstance } from 'ky'
import { Type } from '@sinclair/typebox'
import ky, { isHTTPError } from 'ky'
import { asValue } from '../shared/json'

export const LOGIN_PROVIDERS = [
  { label: 'OpenAI Codex', detail: 'ChatGPT / Codex account', endpoint: 'codex-auth-url' },
  { label: 'Anthropic Claude', detail: 'Claude Code account', endpoint: 'anthropic-auth-url' },
  { label: 'Antigravity', detail: 'Antigravity account', endpoint: 'antigravity-auth-url' },
  { label: 'Kimi', detail: 'Moonshot Kimi account', endpoint: 'kimi-auth-url' },
  { label: 'xAI Grok', detail: 'Grok Build account', endpoint: 'xai-auth-url' },
]

export interface ManagementEndpoint {
  baseUrl: string
  key: string
}

export interface AuthFile {
  name: string
  type?: string
}

export interface OpenAICompatibilityProvider {
  'name': string
  'base-url': string
  'api-key-entries'?: Array<{ 'api-key': string }>
  'models'?: Array<{ name: string }>
}

const IdTokenSchema = Type.Object({
  email: Type.Optional(Type.String()),
  chatgpt_account_id: Type.Optional(Type.String()),
})

export const AuthFileRawSchema = Type.Object({
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  provider: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  auth_index: Type.Optional(Type.String()),
  project_id: Type.Optional(Type.String()),
  chatgpt_account_id: Type.Optional(Type.String()),
  account_id: Type.Optional(Type.String()),
  id_token: Type.Optional(IdTokenSchema),
})

export type AuthFileRaw = Static<typeof AuthFileRawSchema>

const AuthFilesPayloadSchema = Type.Object({
  files: Type.Optional(Type.Array(Type.Unknown())),
})

const ManagementErrorSchema = Type.Object({
  error: Type.Optional(Type.String()),
})

const AuthUrlPayloadSchema = Type.Object({
  url: Type.Optional(Type.Unknown()),
})

const ApiCallResponseSchema = Type.Object({
  status_code: Type.Optional(Type.Number()),
  statusCode: Type.Optional(Type.Number()),
  header: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  body: Type.Optional(Type.Unknown()),
})

const OpenAICompatibilityProviderSchema = Type.Object({
  'name': Type.String(),
  'base-url': Type.String(),
}, { additionalProperties: true })

const OpenAICompatibilityPayloadSchema = Type.Object({
  'openai-compatibility': Type.Optional(Type.Array(Type.Unknown())),
})

const toManagementError: BeforeErrorHook = ({ error }) => {
  if (!isHTTPError(error))
    return error
  return new Error(
    managementErrorMessage(error.data) ?? `Management request failed with HTTP ${error.response.status}.`,
  )
}

export class ManagementClient {
  private readonly fetcher: KyInstance

  constructor(baseUrl: string, key: string) {
    // ponytail: retry:0/timeout:false preserve the old raw-fetch behavior; ky just folds
    // away the bearer header, base path, and !ok error parsing (the beforeError hook).
    this.fetcher = ky.create({
      prefix: `${baseUrl}/v0/management`,
      headers: { Authorization: `Bearer ${key}` },
      retry: 0,
      timeout: false,
      hooks: { beforeError: [toManagementError] },
    })
  }

  async requestAuthUrl(endpoint: string, signal?: AbortSignal): Promise<string> {
    const payload = asValue(AuthUrlPayloadSchema, await this.fetcher.get(`/${endpoint}?is_webui=true`, { signal: signal ?? null }).json())
    if (typeof payload?.url !== 'string')
      throw new Error('CLIProxyAPI returned an invalid auth URL response.')
    return payload.url
  }

  async listAuthFiles(signal?: AbortSignal): Promise<AuthFile[]> {
    return (await this.listAuthFilesRaw(signal))
      .filter((file): file is AuthFileRaw & { name: string } => file.name !== undefined)
      .map(file => (file.type === undefined ? { name: file.name } : { name: file.name, type: file.type }))
  }

  async deleteAuthFile(name: string, signal?: AbortSignal): Promise<void> {
    await this.fetcher.delete(`/auth-files?name=${encodeURIComponent(name)}`, { signal: signal ?? null })
  }

  async listAuthFilesRaw(signal?: AbortSignal): Promise<AuthFileRaw[]> {
    const payload = asValue(AuthFilesPayloadSchema, await this.fetcher.get('/auth-files', { signal: signal ?? null }).json())
    return (payload?.files ?? []).flatMap((file) => {
      const entry = asValue(AuthFileRawSchema, file)
      return entry === undefined ? [] : [entry]
    })
  }

  async serverVersion(signal?: AbortSignal): Promise<string | undefined> {
    const response = await this.fetcher.get('/auth-files', { signal: signal ?? null })
    const version = response.headers.get('x-cpa-version')?.trim()
    return version === undefined || version === '' ? undefined : version
  }

  // Proxies an upstream request through CLIProxyAPI using a stored credential.
  // CPA substitutes the literal "$TOKEN$" in headers with the account's token.
  async apiCall(payload: {
    auth_index: string
    method: string
    url: string
    header?: Record<string, string>
    data?: string
  }, signal?: AbortSignal): Promise<{ statusCode: number, header: Record<string, string[]>, body: unknown }> {
    const json = asValue(ApiCallResponseSchema, await this.fetcher.post('/api-call', {
      json: payload,
      signal: signal ?? null,
      retry: { limit: 2, methods: ['post'], statusCodes: [408, 429, 500, 502, 503, 504] },
    }).json())
    return { statusCode: json?.status_code ?? json?.statusCode ?? 0, header: json?.header ?? {}, body: json?.body }
  }

  async listOpenAICompatibility(signal?: AbortSignal): Promise<OpenAICompatibilityProvider[]> {
    const payload = asValue(
      OpenAICompatibilityPayloadSchema,
      await this.fetcher.get('/openai-compatibility', { signal: signal ?? null }).json(),
    )
    return (payload?.['openai-compatibility'] ?? []).flatMap((entry) => {
      const provider = asValue(OpenAICompatibilityProviderSchema, entry)
      return provider === undefined ? [] : [provider]
    })
  }

  async putOpenAICompatibility(providers: OpenAICompatibilityProvider[], signal?: AbortSignal): Promise<void> {
    await this.fetcher.put('/openai-compatibility', { json: providers, signal: signal ?? null })
  }

  async deleteOpenAICompatibility(name: string, signal?: AbortSignal): Promise<void> {
    await this.fetcher.delete(`/openai-compatibility?name=${encodeURIComponent(name)}`, { signal: signal ?? null })
  }
}

function managementErrorMessage(data: unknown): string | undefined {
  return asValue(ManagementErrorSchema, data)?.error
    ?? (typeof data === 'string' && data.trim() ? data.trim() : undefined)
}
