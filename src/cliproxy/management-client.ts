import { isPlainObject } from 'moderndash'

export interface LoginProvider {
  label: string
  detail: string
  endpoint: string
}

export const LOGIN_PROVIDERS: readonly LoginProvider[] = [
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

export class ManagementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class ManagementClient {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
  ) {}

  async requestAuthUrl(endpoint: string, signal?: AbortSignal): Promise<string> {
    const payload = await this.getJson<{ url?: unknown }>(`/${endpoint}?is_webui=true`, signal)
    if (typeof payload.url !== 'string')
      throw new ManagementError('CLIProxyAPI returned an invalid auth URL response.', 502)
    return payload.url
  }

  async listAuthFiles(signal?: AbortSignal): Promise<AuthFile[]> {
    const payload = await this.getJson<{ files?: unknown }>('/auth-files', signal)
    if (!Array.isArray(payload.files))
      return []
    return payload.files
      .filter(isPlainObject)
      .filter((file): file is { name: string, type?: string } => typeof file.name === 'string')
      .map(file => (typeof file.type === 'string' ? { name: file.name, type: file.type } : { name: file.name }))
  }

  async deleteAuthFile(name: string, signal?: AbortSignal): Promise<void> {
    await this.send('DELETE', `/auth-files?name=${encodeURIComponent(name)}`, undefined, signal)
  }

  async listAuthFilesRaw(signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const payload = await this.getJson<{ files?: unknown }>('/auth-files', signal)
    return Array.isArray(payload.files) ? payload.files.filter(isPlainObject) : []
  }

  // Proxies an upstream request through CLIProxyAPI using a stored credential.
  // CPA substitutes the literal "$TOKEN$" in headers with the account's token.
  async apiCall(payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ statusCode: number, body: unknown }> {
    const response = await this.send('POST', '/api-call', payload, signal)
    const json = await response.json() as { status_code?: number, statusCode?: number, body?: unknown }
    return { statusCode: json.status_code ?? json.statusCode ?? 0, body: json.body }
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await this.send('GET', path, undefined, signal)
    return await response.json() as T
  }

  private async send(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/v0/management${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ManagementError(
        managementErrorMessage(text) ?? `Management request failed with HTTP ${response.status}.`,
        response.status,
      )
    }
    return response
  }
}

function managementErrorMessage(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text)
    if (isPlainObject(body) && typeof body.error === 'string')
      return body.error
  }
  catch {}
  return text.trim() ? text.trim() : undefined
}
