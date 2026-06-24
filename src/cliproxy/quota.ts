import type { ManagementClient } from './management-client'
import { isPlainObject } from 'moderndash'
import { errorMessage } from '../shared/errors'

export interface QuotaWindow {
  label: string
  remainingPercent?: number
}

export interface QuotaReport {
  provider: 'codex' | 'antigravity'
  windows: QuotaWindow[] // codex: 5h / 7d account-level windows
  models?: Record<string, number> // antigravity: remaining percent keyed by proxy model id
  error?: string
}

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const ANTIGRAVITY_MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'

export async function fetchQuotas(client: ManagementClient, signal?: AbortSignal): Promise<QuotaReport[]> {
  const files = await client.listAuthFilesRaw(signal)
  const tasks = files.flatMap((entry) => {
    const provider = str(entry.provider ?? entry.type).toLowerCase()
    if (provider === 'codex')
      return [fetchCodexQuota(client, entry, signal)]
    if (provider === 'antigravity')
      return [fetchAntigravityQuota(client, entry, signal)]
    return []
  })
  return Promise.all(tasks)
}

export function formatPercent(value?: number): string {
  return value === undefined ? '?' : `${Math.round(value)}%`
}

async function fetchCodexQuota(client: ManagementClient, entry: Record<string, unknown>, signal?: AbortSignal): Promise<QuotaReport> {
  const report: QuotaReport = { provider: 'codex', windows: [] }
  const authIndex = str(entry.auth_index)
  if (authIndex === '')
    return { ...report, error: 'missing auth_index' }
  try {
    // The credential identifies the account; no Chatgpt-Account-Id header needed.
    const { statusCode, body } = await client.apiCall({
      auth_index: authIndex,
      method: 'GET',
      url: WHAM_USAGE_URL,
      header: { 'Authorization': 'Bearer $TOKEN$', 'Content-Type': 'application/json' },
    }, signal)
    if (statusCode < 200 || statusCode >= 300)
      return { ...report, error: `HTTP ${statusCode}` }
    const data = parseBody(body)
    if (data === undefined)
      return { ...report, error: 'invalid quota payload' }
    report.windows = parseCodexWindows(data)
    return report
  }
  catch (error) {
    return { ...report, error: errorMessage(error) }
  }
}

async function fetchAntigravityQuota(client: ManagementClient, entry: Record<string, unknown>, signal?: AbortSignal): Promise<QuotaReport> {
  const report: QuotaReport = { provider: 'antigravity', windows: [] }
  const authIndex = str(entry.auth_index)
  const projectId = str(entry.project_id)
  if (authIndex === '')
    return { ...report, error: 'missing auth_index' }
  if (projectId === '')
    return { ...report, error: 'missing project_id' }
  try {
    const { statusCode, body } = await client.apiCall({
      auth_index: authIndex,
      method: 'POST',
      url: ANTIGRAVITY_MODELS_URL,
      header: { 'Authorization': 'Bearer $TOKEN$', 'Content-Type': 'application/json', 'User-Agent': 'antigravity/1.11.5 windows/amd64' },
      data: JSON.stringify({ project: projectId }),
    }, signal)
    if (statusCode < 200 || statusCode >= 300)
      return { ...report, error: `HTTP ${statusCode}` }
    const data = parseBody(body)
    if (data === undefined)
      return { ...report, error: 'invalid quota payload' }
    report.models = parseAntigravityModels(data)
    return report
  }
  catch (error) {
    return { ...report, error: errorMessage(error) }
  }
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
    // exactOptionalPropertyTypes forbids assigning explicit undefined, so omit when unknown.
    windows.push({ label, ...(used === undefined ? {} : { remainingPercent: clamp(100 - used, 0, 100) }) })
  }
  return windows
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

function num(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
