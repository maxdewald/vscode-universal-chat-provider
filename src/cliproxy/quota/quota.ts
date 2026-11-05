import type { AuthFileRaw, ManagementClient } from '@src/cliproxy/api/management-client'
import type { QuotaProvider, QuotaReport } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { isQuotaProvider, QUOTA_PROVIDERS } from '@src/cliproxy/quota/providers'
import { parseReset } from '@src/cliproxy/quota/providers/types'
import { errorMessage } from '@src/shared/errors'
import { asJsonValue } from '@src/shared/json'

export type { QuotaReport, QuotaWindow } from '@src/cliproxy/quota/providers/types'

const ObjectSchema = Type.Object({}, { additionalProperties: true })

function quotaProviderForModel(model: { proxyOwner: string }): QuotaReport['provider'] | undefined {
  const owner = model.proxyOwner.toLowerCase()
  return (Object.keys(QUOTA_PROVIDERS) as Array<QuotaReport['provider']>)
    .find(name => QUOTA_PROVIDERS[name].owners.includes(owner))
}

const FETCH_INTERVAL_MS = 5 * 60_000
// Providers with header signals stay fresh between fetches, so their usage endpoint is polled rarely.
const SIGNAL_FETCH_INTERVAL_MS = 15 * 60_000

// nextFetch maps authIndex -> earliest time to hit that account's usage endpoint again. Until then,
// or when a fetch fails, the account keeps its previous report, overlaid with newer proxy signals.
export async function fetchQuotas(
  client: ManagementClient,
  signal?: AbortSignal,
  nextFetch: Map<string, number> = new Map(),
  previous: readonly QuotaReport[] = [],
): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  return Promise.all(files.flatMap((entry) => {
    const raw = (entry.provider ?? entry.type ?? '').trim().toLowerCase()
    const provider = raw === 'xai' ? 'grok' : raw
    if (!isQuotaProvider(provider))
      return []
    const source = QUOTA_PROVIDERS[provider]
    const account = accountOf(entry)
    const last = previous.find(report => report.provider === provider && account !== undefined && report.account?.authIndex === account.authIndex)
      ?? { provider, windows: [], ...(account === undefined ? {} : { account }) }
    if ((nextFetch.get(account?.authIndex ?? '') ?? 0) > Date.now())
      return [Promise.resolve(withSignals(last, source, entry))]
    return [fetchProviderQuota(source, client, entry, signal, nextFetch, last)]
  }))
}

function withSignals(report: QuotaReport, source: QuotaProvider, entry: AuthFileRaw): QuotaReport {
  const observedAt = Date.parse(entry.quota?.observed_at ?? '')
  const fresh = source.fromSignals?.(entry.quota?.signals ?? {}) ?? []
  if (fresh.length === 0 || Number.isNaN(observedAt) || observedAt <= (report.updatedAt ?? 0))
    return report
  const windows = report.windows.map(window => fresh.find(update => update.label === window.label) ?? window)
  windows.push(...fresh.filter(update => !windows.includes(update)))
  const { error: _error, ...rest } = report
  return { ...rest, windows, updatedAt: observedAt }
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
  const remaining = reports
    .filter(report => report.provider === name)
    .map(report => provider.remaining(report, model.proxyModelId))
    .filter((percent): percent is number => percent !== undefined)
  return remaining.length > 0 ? Math.max(...remaining) : undefined
}

async function fetchProviderQuota(
  source: QuotaProvider,
  client: ManagementClient,
  entry: AuthFileRaw,
  signal: AbortSignal | undefined,
  nextFetch: Map<string, number>,
  last: QuotaReport,
): Promise<QuotaReport> {
  const authIndex = last.account?.authIndex
  if (authIndex === undefined)
    return { ...last, error: 'missing auth_index' }
  const requestBody = source.body?.(entry)
  if (requestBody !== undefined && 'error' in requestBody)
    return { ...last, error: requestBody.error }
  // Claimed before awaiting so overlapping refreshes don't fetch the same account twice.
  nextFetch.set(authIndex, Date.now() + FETCH_INTERVAL_MS)
  try {
    const { statusCode, header, body } = await client.apiCall({
      auth_index: authIndex,
      method: source.method,
      url: source.url,
      header: source.header,
      ...requestBody,
    }, signal)
    const ok = statusCode >= 200 && statusCode < 300
    const interval = ok && source.fromSignals !== undefined ? SIGNAL_FETCH_INTERVAL_MS : FETCH_INTERVAL_MS
    nextFetch.set(authIndex, parseRetryAfter(header, statusCode) ?? Date.now() + interval)
    if (!ok)
      return { ...last, error: `HTTP ${statusCode} from ${source.url} — ${describeBody(body)}` }
    const data = asJsonValue(ObjectSchema, body)
    if (data === undefined)
      return { ...last, error: `invalid quota payload from ${source.url} — ${describeBody(body)}` }
    const report: QuotaReport = { provider: last.provider, windows: [], account: last.account!, updatedAt: Date.now() }
    source.apply(report, data)
    return report
  }
  catch (error) {
    return { ...last, error: errorMessage(error) }
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
