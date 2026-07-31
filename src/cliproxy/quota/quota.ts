import type { AuthFileRaw, ManagementClient } from '@src/cliproxy/api/management-client'
import type { QuotaProvider, QuotaReport } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { isQuotaProvider, QUOTA_PROVIDERS } from '@src/cliproxy/quota/providers'
import { parseReset } from '@src/cliproxy/quota/providers/types'
import { errorMessage } from '@src/shared/errors'
import { asJsonValue } from '@src/shared/json'

export type { QuotaReport, QuotaWindow } from '@src/cliproxy/quota/providers/types'

const ObjectSchema = Type.Object({}, { additionalProperties: true })

export function quotaProviderForModel(model: { proxyOwner: string }): QuotaReport['provider'] | undefined {
  const owner = model.proxyOwner.toLowerCase()
  return (Object.keys(QUOTA_PROVIDERS) as Array<QuotaReport['provider']>)
    .find(name => QUOTA_PROVIDERS[name].owners.includes(owner))
}

// backoff maps authIndex -> deadline and is owned here: fetchProviderQuota writes it from the
// response headers, and an account still inside its window reports no windows instead of being
// fetched, so setQuotas keeps its last-good value without touching the upstream.
export async function fetchQuotas(
  client: ManagementClient,
  signal?: AbortSignal,
  backoff: Map<string, number> = new Map(),
  providerFilter?: QuotaReport['provider'],
): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  const tasks = files.flatMap((entry) => {
    const raw = (entry.provider ?? entry.type ?? '').trim().toLowerCase()
    const provider = raw === 'xai' ? 'grok' : raw
    if (!isQuotaProvider(provider) || (providerFilter !== undefined && provider !== providerFilter))
      return []
    if ((backoff.get(entry.auth_index?.trim() ?? '') ?? 0) > Date.now()) {
      const account = accountOf(entry)
      return [Promise.resolve<QuotaReport>({ provider, windows: [], ...(account === undefined ? {} : { account }) })]
    }
    return [fetchProviderQuota(provider, QUOTA_PROVIDERS[provider], client, entry, signal, backoff)]
  })
  return Promise.all(tasks)
}

export function formatPercent(value?: number): string {
  return value === undefined ? '?' : `${Math.round(value)}%`
}

// Compact countdown using the two largest non-zero units, e.g. "3d 4h", "3h 25m", "12m".
export function formatResetCountdown(resetsAt: number | undefined): string | undefined {
  const delta = (resetsAt ?? 0) - Date.now()
  if (delta <= 0)
    return undefined
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1)
    return 'soon'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0)
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

// Maps a model to its remaining-quota percent by handing the report to the provider that
// bills its owner. Antigravity is keyed per model; the rest report account-level windows.
export function remainingForModel(reports: QuotaReport[], model: { proxyOwner: string, proxyModelId: string }): number | undefined {
  const name = quotaProviderForModel(model)
  if (name === undefined)
    return undefined
  const provider = QUOTA_PROVIDERS[name]
  const report = reports.find(candidate => candidate.provider === name && candidate.error === undefined)
  return report === undefined ? undefined : provider.remaining(report, model.proxyModelId)
}

async function fetchProviderQuota(
  provider: QuotaReport['provider'],
  source: QuotaProvider,
  client: ManagementClient,
  entry: AuthFileRaw,
  signal: AbortSignal | undefined,
  backoff: Map<string, number>,
): Promise<QuotaReport> {
  const account = accountOf(entry)
  const report: QuotaReport = { provider, windows: [], ...(account === undefined ? {} : { account }) }
  const authIndex = entry.auth_index?.trim() ?? ''
  if (authIndex === '')
    return { ...report, error: 'missing auth_index' }
  const requestBody = source.body?.(entry)
  if (requestBody !== undefined && 'error' in requestBody)
    return { ...report, error: requestBody.error }
  try {
    const { statusCode, header, body } = await client.apiCall({
      auth_index: authIndex,
      method: source.method,
      url: source.url,
      header: source.header,
      ...requestBody,
    }, signal)
    const retryAfter = parseRetryAfter(header, statusCode)
    if (retryAfter === undefined)
      backoff.delete(authIndex)
    else
      backoff.set(authIndex, retryAfter)
    if (statusCode < 200 || statusCode >= 300)
      return { ...report, error: `HTTP ${statusCode} from ${source.url} — ${describeBody(body)}` }
    const data = asJsonValue(ObjectSchema, body)
    if (data === undefined)
      return { ...report, error: `invalid quota payload from ${source.url} — ${describeBody(body)}` }
    source.apply(report, data)
    return report
  }
  catch (error) {
    return { ...report, error: errorMessage(error) }
  }
}

// Upstream error bodies carry the useful detail (rate_limit_error, invalid_token, …).
function describeBody(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return text === undefined || text.trim() === '' ? 'empty body' : text
}

// How long to sit out a 429 that carried no usable deadline, so we never hot-loop the upstream.
const RATE_LIMIT_FLOOR_MS = 5 * 60_000

// Deadline to wait until before hitting this account again, in order of trust: Retry-After
// (RFC 7231 delta-seconds or HTTP date), then Anthropic's -unified-reset once its -remaining
// hits 0, then a floor for bare 429s.
function parseRetryAfter(header: Record<string, string[]> | undefined, statusCode: number): number | undefined {
  const retryAfter = headerValue(header, 'retry-after')
  const seconds = Number(retryAfter)
  return parseReset(Number.isNaN(seconds) ? retryAfter : Date.now() / 1000 + seconds)
    ?? (headerValue(header, 'anthropic-ratelimit-unified-remaining') === '0'
      ? parseReset(headerValue(header, 'anthropic-ratelimit-unified-reset'))
      : undefined)
    ?? (statusCode === 429 ? Date.now() + RATE_LIMIT_FLOOR_MS : undefined)
}

// CLIProxyAPI forwards Go's canonicalized http.Header, so values arrive as string arrays.
function headerValue(header: Record<string, string[]> | undefined, name: string): string | undefined {
  return Object.entries(header ?? {}).find(([key]) => key.toLowerCase() === name)?.[1]?.[0]?.trim()
}

function accountOf(entry: AuthFileRaw): QuotaReport['account'] | undefined {
  const authIndex = entry.auth_index?.trim() ?? ''
  if (authIndex === '')
    return undefined
  const label = entry.email?.trim()
    ?? entry.id_token?.email?.trim()
    ?? entry.label?.trim()
    ?? entry.name?.trim()
    ?? `Account ${authIndex}`
  return { authIndex, label }
}
