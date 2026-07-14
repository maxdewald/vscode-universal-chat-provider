import type { ManagementClient } from './management-client'
import { isPlainObject } from 'moderndash'
import { errorMessage } from '../shared/errors'

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
  error?: string
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
  apply: (report: QuotaReport, data: Record<string, unknown>) => void
}

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

export async function fetchQuotas(client: ManagementClient, signal?: AbortSignal): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  const tasks = files.flatMap((entry) => {
    const raw = str(entry.provider ?? entry.type).toLowerCase()
    const provider = raw === 'xai' ? 'grok' : raw
    const source = QUOTA_SOURCES[provider as QuotaReport['provider']]
    return source === undefined ? [] : [fetchProviderQuota(provider as QuotaReport['provider'], source, client, entry, signal)]
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
  entry: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<QuotaReport> {
  const report: QuotaReport = { provider, windows: [] }
  const authIndex = str(entry.auth_index)
  if (authIndex === '')
    return { ...report, error: 'missing auth_index' }
  // Antigravity is the only source with a request payload: its models endpoint takes the project.
  const projectId = str(entry.project_id)
  if (provider === 'antigravity' && projectId === '')
    return { ...report, error: 'missing project_id' }
  try {
    const { statusCode, body } = await client.apiCall({
      auth_index: authIndex,
      method: source.method,
      url: source.url,
      header: source.header,
      ...(provider === 'antigravity' ? { data: JSON.stringify({ project: projectId }) } : {}),
    }, signal)
    if (statusCode < 200 || statusCode >= 300)
      return { ...report, error: `HTTP ${statusCode}` }
    const data = parseBody(body)
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
function parseGrokWindows(data: Record<string, unknown>): QuotaWindow[] {
  const config = isPlainObject(data.config) ? data.config : undefined
  const used = num(isPlainObject(config?.used) ? config.used.val : undefined)
  const limit = num(isPlainObject(config?.monthlyLimit) ? config.monthlyLimit.val : undefined)
  if (used === undefined || limit === undefined || limit <= 0)
    return []
  const resetsAt = parseReset(config?.billingPeriodEnd)
  return [{ label: 'Credits', remainingPercent: clamp(100 - (used / limit) * 100, 0, 100), ...(resetsAt === undefined ? {} : { resetsAt }) }]
}

// Account-level utilization (percent used) per window, plus optional extra-usage credits.
function parseClaudeWindows(data: Record<string, unknown>): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  for (const [key, raw] of Object.entries(data)) {
    if (!isPlainObject(raw))
      continue
    const label = claudeWindowLabel(key)
    if (label === undefined)
      continue
    const used = num(raw.utilization)
    const resetsAt = parseReset(raw.resets_at)
    windows.push({ key, label, ...(used === undefined ? {} : { remainingPercent: clamp(100 - used, 0, 100) }), ...(resetsAt === undefined ? {} : { resetsAt }) })
  }
  const extra = isPlainObject(data.extra_usage) ? data.extra_usage : undefined
  const extraUsed = num(extra?.utilization)
  if (extra?.is_enabled === true && extraUsed !== undefined)
    windows.push({ key: 'extra_usage', label: 'Extra Usage', remainingPercent: clamp(100 - extraUsed, 0, 100) })
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

function parseCodexWindows(data: Record<string, unknown>): QuotaWindow[] {
  const rateLimit = isPlainObject(data.rate_limit) ? data.rate_limit : undefined
  if (rateLimit === undefined)
    return []
  const windows: QuotaWindow[] = []
  for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
    if (!isPlainObject(raw))
      continue
    const used = num(raw.used_percent)
    const label = codexWindowLabel(num(raw.limit_window_seconds))
    const resetsAt = parseCodexReset(raw)
    // exactOptionalPropertyTypes forbids assigning explicit undefined, so omit when unknown.
    windows.push({ label, ...(used === undefined ? {} : { remainingPercent: clamp(100 - used, 0, 100) }), ...(resetsAt === undefined ? {} : { resetsAt }) })
  }
  return windows
}

// Codex gives an absolute reset_at (epoch seconds); when absent, reset_after_seconds is relative to now.
function parseCodexReset(window: Record<string, unknown>): number | undefined {
  const absolute = parseReset(window.reset_at)
  if (absolute !== undefined)
    return absolute
  const after = num(window.reset_after_seconds)
  return after === undefined ? undefined : Date.now() + after * 1000
}

function codexWindowLabel(windowSeconds?: number): string {
  return windowSeconds === 604_800 ? '7d Quota' : '5h Quota'
}

// Antigravity exposes per-model remaining keyed by the same model id the proxy serves,
// so the menu can show each model its own quota.
function parseAntigravityModels(data: Record<string, unknown>): Record<string, number> {
  const models = isPlainObject(data.models) ? data.models : undefined
  if (models === undefined)
    return {}
  const out: Record<string, number> = {}
  for (const [id, raw] of Object.entries(models)) {
    if (!isPlainObject(raw))
      continue
    const quotaInfo = isPlainObject(raw.quotaInfo) ? raw.quotaInfo : undefined
    const fraction = num(quotaInfo?.remainingFraction)
    if (fraction !== undefined)
      out[id] = clamp(fraction * 100, 0, 100)
  }
  return out
}

function parseBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'string')
    return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    return isPlainObject(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}

// Accepts an ISO-8601 string or epoch seconds and returns epoch ms, dropping values already in the past.
function parseReset(value: unknown): number | undefined {
  const ms = typeof value === 'string' ? Date.parse(value) : (num(value) ?? Number.NaN) * 1000
  return Number.isNaN(ms) || ms <= Date.now() ? undefined : ms
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
