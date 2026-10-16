import type { AuthFileRaw, CredentialQuota, ManagementClient } from '@src/cliproxy/api/management-client'
import { LOGIN_PROVIDERS } from '@src/cliproxy/api/management-client'
import { errorMessage } from '@src/shared/errors'

export interface QuotaWindow {
  label: string
  remainingPercent: number
  resetsAt?: number // epoch ms when the window refreshes; omitted when unknown or already past
  group?: string // the server's group name; a group named after a served model gates only that model
}

export interface QuotaReport {
  provider: string // CLIProxyAPI credential provider key, as listed by the server
  title: string
  windows: QuotaWindow[]
  models?: Array<{ id: string, name?: string }> // models this credential serves, as listed by the server
  account?: { authIndex: string, label: string }
  error?: string
}

// How long to sit out an account whose quota fetch was rate limited, so we never hot-loop the upstream.
const RATE_LIMIT_FLOOR_MS = 5 * 60_000

export function quotaProviderForModel(reports: readonly QuotaReport[], model: { proxyModelId: string }): string | undefined {
  return reports.find(report => servesModel(report, model.proxyModelId))?.provider
}

// Quota is computed by CLIProxyAPI's quota providers; this only lists the credentials the server
// says it can report on and asks the server for each one. No upstream endpoint is known here.
export async function fetchQuotas(
  client: ManagementClient,
  signal?: AbortSignal,
  backoff: Map<string, number> = new Map(),
  providerFilter?: string,
): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  const tasks = files.flatMap((entry) => {
    const provider = (entry.provider ?? entry.type ?? '').trim().toLowerCase()
    const authIndex = entry.auth_index?.trim() ?? ''
    if (entry.supports_quota !== true || entry.disabled === true || provider === '' || authIndex === '')
      return []
    if (providerFilter !== undefined && provider !== providerFilter)
      return []
    const report: QuotaReport = { provider, title: providerTitle(provider), windows: [], account: { authIndex, label: accountLabel(entry, authIndex) } }
    if ((backoff.get(authIndex) ?? 0) > Date.now())
      return [Promise.resolve(report)]
    return [fetchCredentialQuota(client, entry, report, signal, backoff)]
  })
  return Promise.all(tasks)
}

async function fetchCredentialQuota(
  client: ManagementClient,
  entry: AuthFileRaw,
  report: QuotaReport,
  signal: AbortSignal | undefined,
  backoff: Map<string, number>,
): Promise<QuotaReport> {
  const authIndex = report.account!.authIndex
  const [quota, models] = await Promise.allSettled([
    client.fetchCredentialQuota(authIndex, signal),
    entry.name === undefined ? Promise.resolve([]) : client.listAuthFileModelInfo(entry.name, signal),
  ])
  const withModels = models.status === 'fulfilled' ? { ...report, models: models.value } : report
  if (quota.status === 'rejected') {
    const error = errorMessage(quota.reason)
    if (/\b429\b/.test(error))
      backoff.set(authIndex, Date.now() + RATE_LIMIT_FLOOR_MS)
    return { ...withModels, error }
  }
  backoff.delete(authIndex)
  return { ...withModels, windows: quotaWindows(quota.value) }
}

export function quotaWindows(quota: CredentialQuota): QuotaWindow[] {
  const offset = quota.serverTimeOffsetMs ?? 0
  return (quota.groups ?? []).flatMap((group) => {
    const groupName = group.displayName?.trim() ?? ''
    return (group.buckets ?? []).map((bucket) => {
      const window = (bucket.window ?? bucket.description ?? '').trim()
      const resetsAt = parseReset(bucket.resetTime, offset)
      return {
        label: [groupName, window].filter(part => part !== '').join(' · ') || 'Quota',
        remainingPercent: Math.min(Math.max(bucket.remainingFraction * 100, 0), 100),
        ...(resetsAt === undefined ? {} : { resetsAt }),
        ...(groupName === '' ? {} : { group: groupName }),
      }
    })
  })
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

// A model's remaining quota is the tightest window that gates it, on the best account serving it.
// A window grouped under one of the credential's served models gates only that model; every other
// window gates the whole account.
export function remainingForModel(reports: readonly QuotaReport[], model: { proxyModelId: string }): number | undefined {
  const remaining = reports
    .filter(report => report.error === undefined && servesModel(report, model.proxyModelId))
    .map(report => tightestWindow(report, model.proxyModelId))
    .filter((percent): percent is number => percent !== undefined)
  return remaining.length > 0 ? Math.max(...remaining) : undefined
}

function tightestWindow(report: QuotaReport, proxyModelId: string): number | undefined {
  const served = report.models ?? []
  const modelScoped = new Set(served.flatMap(model => [model.id, model.name ?? '']).map(normalize).filter(key => key !== ''))
  const own = new Set(served.filter(model => model.id === proxyModelId).flatMap(model => [model.id, model.name ?? '']).map(normalize))
  const percents = report.windows
    .filter(window => window.group === undefined || !modelScoped.has(normalize(window.group)) || own.has(normalize(window.group)))
    .map(window => window.remainingPercent)
  return percents.length > 0 ? Math.min(...percents) : undefined
}

function servesModel(report: QuotaReport, proxyModelId: string): boolean {
  return (report.models ?? []).some(model => model.id === proxyModelId)
}

function normalize(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function providerTitle(provider: string): string {
  return LOGIN_PROVIDERS.find(entry => entry.provider === provider)?.title
    ?? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
}

// Accepts an ISO-8601 server time and returns local epoch ms, dropping values already in the past.
function parseReset(value: string | undefined, serverOffsetMs: number): number | undefined {
  if (value === undefined || value.trim() === '')
    return undefined
  const ms = Date.parse(value) - serverOffsetMs
  return Number.isNaN(ms) || ms <= Date.now() ? undefined : ms
}

function accountLabel(entry: AuthFileRaw, authIndex: string): string {
  return entry.email?.trim()
    ?? entry.id_token?.email?.trim()
    ?? entry.label?.trim()
    ?? entry.name?.trim()
    ?? `Account ${authIndex}`
}
