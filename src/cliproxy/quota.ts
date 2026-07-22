import type { Static } from '@sinclair/typebox'
import type { AuthFileRaw, ManagementClient } from './management-client'
import { Type } from '@sinclair/typebox'
import { errorMessage } from '../shared/errors'
import { asJsonValue, asValue } from '../shared/json'

export interface QuotaWindow {
  label: string
  remainingPercent?: number
  key?: string // claude: window id; remainingForModel scopes family caps by it
  resetsAt?: number // epoch ms when the window refreshes; omitted when unknown or already past
}

export interface QuotaReport {
  provider: 'codex' | 'antigravity' | 'claude' | 'grok'
  windows: QuotaWindow[] // codex/claude/grok: account-level windows (5h / 7d / …)
  models?: Record<string, number> // antigravity: remaining percent keyed by proxy model id
  account?: { authIndex: string, label: string } // identifies which signed-in account the report belongs to
  error?: string
  retryAfter?: number // epoch ms the upstream asked us to wait until before retrying (from a 429 Retry-After)
}

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const ANTIGRAVITY_MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing'
// Claude weekly caps are keyed "seven_day_<family>" (e.g. seven_day_opus); the family binds the
// window to its model family by name, so a new one like seven_day_fable works without code changes.
const SEVEN_DAY_FAMILY = /^seven_day_(.+)$/

function sevenDayFamily(key: string | undefined): string | undefined {
  return SEVEN_DAY_FAMILY.exec(key ?? '')?.[1]
}

interface QuotaSource {
  method: 'GET' | 'POST'
  url: string
  header: Record<string, string>
  apply: (report: QuotaReport, data: unknown) => void
}

const GrokMetricSchema = Type.Object({
  val: Type.Optional(Type.Number()),
})

const GrokConfigSchema = Type.Object({
  used: Type.Optional(GrokMetricSchema),
  monthlyLimit: Type.Optional(GrokMetricSchema),
  billingPeriodEnd: Type.Optional(Type.Union([Type.String(), Type.Number()])),
})

const GrokBodySchema = Type.Object({
  config: Type.Optional(GrokConfigSchema),
})

const ClaudeWindowSchema = Type.Object({
  utilization: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  resets_at: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
  is_enabled: Type.Optional(Type.Boolean()),
})

const ClaudeWindowValueSchema = Type.Union([ClaudeWindowSchema, Type.Null()])

const ClaudeBodySchema = Type.Object({
  extra_usage: Type.Optional(ClaudeWindowValueSchema),
}, { additionalProperties: true })

const CodexWindowSchema = Type.Object({
  used_percent: Type.Optional(Type.Number()),
  limit_window_seconds: Type.Optional(Type.Number()),
  reset_at: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  reset_after_seconds: Type.Optional(Type.Number()),
})

const CodexRateLimitSchema = Type.Object({
  primary_window: Type.Optional(Type.Union([CodexWindowSchema, Type.Null()])),
  secondary_window: Type.Optional(Type.Union([CodexWindowSchema, Type.Null()])),
})

const CodexBodySchema = Type.Object({
  rate_limit: Type.Optional(CodexRateLimitSchema),
})

const AntigravityQuotaInfoSchema = Type.Object({
  remainingFraction: Type.Optional(Type.Number()),
})

const AntigravityModelSchema = Type.Object({
  quotaInfo: Type.Optional(AntigravityQuotaInfoSchema),
})

const AntigravityBodySchema = Type.Object({
  models: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const ObjectSchema = Type.Object({}, { additionalProperties: true })

const QUOTA_SOURCES = {
  codex: {
    // The credential identifies the account; no Chatgpt-Account-Id header needed.
    method: 'GET',
    url: WHAM_USAGE_URL,
    header: { 'Authorization': 'Bearer $TOKEN$', 'Content-Type': 'application/json' },
    apply: (report, data) => {
      report.windows = parseCodexWindows(data)
    },
  },
  antigravity: {
    method: 'POST',
    url: ANTIGRAVITY_MODELS_URL,
    header: { 'Authorization': 'Bearer $TOKEN$', 'Content-Type': 'application/json', 'User-Agent': 'antigravity/1.11.5 windows/amd64' },
    apply: (report, data) => {
      report.models = parseAntigravityModels(data)
    },
  },
  claude: {
    method: 'GET',
    url: CLAUDE_USAGE_URL,
    header: { 'Authorization': 'Bearer $TOKEN$', 'Accept': 'application/json', 'anthropic-beta': 'oauth-2025-04-20' },
    apply: (report, data) => {
      report.windows = parseClaudeWindows(data)
    },
  },
  grok: {
    method: 'GET',
    url: GROK_BILLING_URL,
    header: { 'Authorization': 'Bearer $TOKEN$', 'X-XAI-Token-Auth': 'xai-grok-cli', 'Accept': 'application/json' },
    apply: (report, data) => {
      report.windows = parseGrokWindows(data)
    },
  },
} satisfies Record<QuotaReport['provider'], QuotaSource>

function isQuotaProvider(value: string): value is QuotaReport['provider'] {
  return Object.hasOwn(QUOTA_SOURCES, value)
}

// backoff maps authIndex -> Retry-After deadline; an account still inside its window is echoed as an
// error report (not fetched) so setQuotas keeps its last-good value without touching the upstream.
export async function fetchQuotas(
  client: ManagementClient,
  signal?: AbortSignal,
  backoff?: Map<string, number>,
): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  const tasks = files.flatMap((entry) => {
    const raw = (entry.provider ?? entry.type ?? '').trim().toLowerCase()
    const provider = raw === 'xai' ? 'grok' : raw
    if (!isQuotaProvider(provider))
      return []
    const retryAfter = backoff?.get(entry.auth_index?.trim() ?? '')
    if (retryAfter !== undefined && retryAfter > Date.now()) {
      const account = accountOf(entry)
      return [Promise.resolve<QuotaReport>({ provider, windows: [], error: 'rate limited', retryAfter, ...(account === undefined ? {} : { account }) })]
    }
    return [fetchProviderQuota(provider, QUOTA_SOURCES[provider], client, entry, signal)]
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

// Maps a model to its remaining-quota percent. Antigravity is keyed per model; Codex quota is
// account-level (5h/7d windows), so we report the tighter of the two windows for any Codex model.
export function remainingForModel(reports: QuotaReport[], model: { proxyOwner: string, proxyModelId: string }): number | undefined {
  const owner = model.proxyOwner.toLowerCase()
  if (owner === 'antigravity') {
    const report = reports.find(r => r.provider === 'antigravity' && r.error === undefined)
    return report?.models?.[model.proxyModelId]
  }
  if (owner === 'openai') {
    const report = reports.find(r => r.provider === 'codex' && r.error === undefined)
    const percents = (report?.windows ?? []).map(w => w.remainingPercent).filter((p): p is number => p !== undefined)
    return percents.length > 0 ? Math.min(...percents) : undefined
  }
  if (owner === 'anthropic') {
    const report = reports.find(r => r.provider === 'claude' && r.error === undefined)
    const id = model.proxyModelId.toLowerCase()
    // 5h/7d windows gate every model; a family cap (seven_day_opus) only gates its own family.
    const applicable = (report?.windows ?? []).filter((w) => {
      if (w.key === 'extra_usage')
        return false
      const family = sevenDayFamily(w.key)
      return family === undefined || id.includes(family)
    })
    const percents = applicable.map(w => w.remainingPercent).filter((p): p is number => p !== undefined)
    return percents.length > 0 ? Math.min(...percents) : undefined
  }
  if (owner === 'xai') {
    const report = reports.find(r => r.provider === 'grok' && r.error === undefined)
    return report?.windows[0]?.remainingPercent
  }
  return undefined
}

async function fetchProviderQuota(
  provider: QuotaReport['provider'],
  source: QuotaSource,
  client: ManagementClient,
  entry: AuthFileRaw,
  signal?: AbortSignal,
): Promise<QuotaReport> {
  const account = accountOf(entry)
  const report: QuotaReport = { provider, windows: [], ...(account === undefined ? {} : { account }) }
  const authIndex = entry.auth_index?.trim() ?? ''
  if (authIndex === '')
    return { ...report, error: 'missing auth_index' }
  // Antigravity is the only source with a request payload: its models endpoint takes the project.
  const projectId = entry.project_id?.trim() ?? ''
  if (provider === 'antigravity' && projectId === '')
    return { ...report, error: 'missing project_id' }
  try {
    const { statusCode, header, body } = await client.apiCall({
      auth_index: authIndex,
      method: source.method,
      url: source.url,
      header: source.header,
      ...(provider === 'antigravity' ? { data: JSON.stringify({ project: projectId }) } : {}),
    }, signal)
    if (statusCode < 200 || statusCode >= 300) {
      const retryAfter = parseRetryAfter(header)
      return { ...report, error: `HTTP ${statusCode}`, ...(retryAfter === undefined ? {} : { retryAfter }) }
    }
    const data = asJsonValue(ObjectSchema, body)
    if (data === undefined)
      return { ...report, error: 'invalid quota payload' }
    source.apply(report, data)
    return report
  }
  catch (error) {
    return { ...report, error: errorMessage(error) }
  }
}

// Grok Build/SuperGrok bills in monthly credits; report the single account-level window as
// remaining percent of the monthly credit allowance.
function parseGrokWindows(data: unknown): QuotaWindow[] {
  const config = asValue(GrokBodySchema, data)?.config
  const used = config?.used?.val
  const limit = config?.monthlyLimit?.val
  if (config === undefined || used === undefined || limit === undefined || limit <= 0)
    return []
  const resetsAt = parseReset(config.billingPeriodEnd)
  return [{ label: 'Credits', remainingPercent: clamp(100 - (used / limit) * 100, 0, 100), ...(resetsAt === undefined ? {} : { resetsAt }) }]
}

// Account-level utilization (percent used) per window, plus optional extra-usage credits.
function parseClaudeWindows(data: unknown): QuotaWindow[] {
  const body = asValue(ClaudeBodySchema, data)
  if (body === undefined)
    return []
  const windows: QuotaWindow[] = []
  for (const [key, rawValue] of Object.entries(body)) {
    const label = claudeWindowLabel(key)
    if (label === undefined)
      continue
    const raw = asValue(ClaudeWindowValueSchema, rawValue)
    if (raw == null)
      continue
    const used = raw.utilization
    const resetsAt = parseReset(raw.resets_at)
    windows.push({ key, label, ...(used == null ? {} : { remainingPercent: clamp(100 - used, 0, 100) }), ...(resetsAt === undefined ? {} : { resetsAt }) })
  }
  const extra = body.extra_usage
  if (extra?.is_enabled === true && extra.utilization != null)
    windows.push({ key: 'extra_usage', label: 'Extra Usage', remainingPercent: clamp(100 - extra.utilization, 0, 100) })
  return windows
}

function claudeWindowLabel(key: string): string | undefined {
  if (key === 'five_hour')
    return '5h Quota'
  if (key === 'seven_day')
    return '7d Quota'
  const family = sevenDayFamily(key)
  return family === undefined ? undefined : `7d ${family.charAt(0).toUpperCase()}${family.slice(1)}`
}

function parseCodexWindows(data: unknown): QuotaWindow[] {
  const rateLimit = asValue(CodexBodySchema, data)?.rate_limit
  if (rateLimit === undefined)
    return []
  const windows: QuotaWindow[] = []
  for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
    if (raw === undefined || raw === null)
      continue
    const used = raw.used_percent
    const label = codexWindowLabel(raw.limit_window_seconds)
    const resetsAt = parseCodexReset(raw)
    // exactOptionalPropertyTypes forbids assigning explicit undefined, so omit when unknown.
    windows.push({ label, ...(used === undefined ? {} : { remainingPercent: clamp(100 - used, 0, 100) }), ...(resetsAt === undefined ? {} : { resetsAt }) })
  }
  return windows
}

// Codex gives an absolute reset_at (epoch seconds); when absent, reset_after_seconds is relative to now.
function parseCodexReset(window: Static<typeof CodexWindowSchema>): number | undefined {
  const absolute = parseReset(window.reset_at)
  if (absolute !== undefined)
    return absolute
  const after = window.reset_after_seconds
  return after === undefined ? undefined : Date.now() + after * 1000
}

function codexWindowLabel(windowSeconds?: number): string {
  return windowSeconds === 604_800 ? '7d Quota' : '5h Quota'
}

// Antigravity exposes per-model remaining keyed by the same model id the proxy serves,
// so the menu can show each model its own quota.
function parseAntigravityModels(data: unknown): Record<string, number> {
  const models = asValue(AntigravityBodySchema, data)?.models
  if (models === undefined)
    return {}
  const out: Record<string, number> = {}
  for (const [id, rawValue] of Object.entries(models)) {
    const fraction = asValue(AntigravityModelSchema, rawValue)?.quotaInfo?.remainingFraction
    if (fraction !== undefined)
      out[id] = clamp(fraction * 100, 0, 100)
  }
  return out
}

// Retry-After (RFC 7231) is either delta-seconds or an HTTP date. CLIProxyAPI forwards Go's
// canonicalized http.Header, so the key is "Retry-After" and each value is a string array.
function parseRetryAfter(header: Record<string, string[]> | undefined): number | undefined {
  const raw = Object.entries(header ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1]?.[0]?.trim()
  if (raw === undefined || raw === '')
    return undefined
  const seconds = Number(raw)
  const ms = Number.isNaN(seconds) ? Date.parse(raw) : Date.now() + seconds * 1000
  return Number.isNaN(ms) || ms <= Date.now() ? undefined : ms
}

// Accepts an ISO-8601 string or epoch seconds and returns epoch ms, dropping values already in the past.
function parseReset(value: string | number | null | undefined): number | undefined {
  if (value == null)
    return undefined
  const ms = typeof value === 'string' ? Date.parse(value) : value * 1000
  return Number.isNaN(ms) || ms <= Date.now() ? undefined : ms
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
