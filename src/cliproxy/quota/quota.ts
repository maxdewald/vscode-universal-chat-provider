import type { AuthFileRaw, ManagementClient } from '@src/cliproxy/api/management-client'
import type { QuotaProvider, QuotaReport } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { UpstreamError } from '@src/cliproxy/api/management-client'
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

const FETCH_INTERVAL_MS = 5 * 60_000
// Providers with header signals stay fresh between fetches, so their usage endpoint is polled rarely.
const SIGNAL_FETCH_INTERVAL_MS = 15 * 60_000
// How long to sit out a 429 that carried no usable deadline, so we never hot-loop the upstream.
const RATE_LIMIT_FLOOR_MS = 5 * 60_000

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
    // OAuth `antigravity` accounts are legacy and get no quota; the plugin's `agy` accounts take the name.
    const provider = raw === 'xai' ? 'grok' : raw === 'agy' ? 'antigravity' : raw === 'antigravity' ? '' : raw
    if (!isQuotaProvider(provider))
      return []
    const source = QUOTA_PROVIDERS[provider]
    const account = accountOf(entry)
    const last = previous.find(report => report.provider === provider && account !== undefined && report.account?.authIndex === account.authIndex)
      ?? { provider, windows: [], ...(account === undefined ? {} : { account }) }
    if ((nextFetch.get(account?.authIndex ?? '') ?? 0) > Date.now())
      return [Promise.resolve(withSignals(last, source, entry))]
    return [loadQuota(source, client, signal, nextFetch, last)]
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

// Maps a model to its remaining-quota percent by handing the report to the provider that bills its owner.
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

async function loadQuota(
  source: QuotaProvider,
  client: ManagementClient,
  signal: AbortSignal | undefined,
  nextFetch: Map<string, number>,
  last: QuotaReport,
): Promise<QuotaReport> {
  const authIndex = last.account?.authIndex
  if (authIndex === undefined)
    return { ...last, error: 'missing auth_index' }
  // Claimed before awaiting so overlapping refreshes don't fetch the same account twice.
  nextFetch.set(authIndex, Date.now() + FETCH_INTERVAL_MS)
  try {
    const body = await source.load(client, authIndex, signal)
    nextFetch.set(authIndex, Date.now() + (source.fromSignals !== undefined ? SIGNAL_FETCH_INTERVAL_MS : FETCH_INTERVAL_MS))
    const data = asJsonValue(ObjectSchema, body)
    if (data === undefined)
      return { ...last, error: `invalid quota payload from ${source.source} — ${String(body)}` }
    const report: QuotaReport = { provider: last.provider, windows: [], account: last.account!, updatedAt: Date.now() }
    source.apply(report, data)
    return report
  }
  catch (error) {
    if (!(error instanceof UpstreamError))
      return { ...last, error: errorMessage(error) }
    if (error.status === 429)
      nextFetch.set(authIndex, retryAfter(error.headers) ?? Date.now() + RATE_LIMIT_FLOOR_MS)
    return { ...last, error: `${error.message} from ${source.source}` }
  }
}

// Retry-After as RFC 7231 delta-seconds or an HTTP date; Go canonicalizes the header name.
function retryAfter(headers: Record<string, string[]>): number | undefined {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1]?.[0]?.trim()
  const seconds = Number(value)
  return parseReset(Number.isNaN(seconds) ? value : Date.now() / 1000 + seconds)
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
