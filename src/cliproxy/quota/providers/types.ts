import type { TNull, TOptional, TSchema, TUnion } from '@sinclair/typebox'
import type { AuthFileRaw } from '@src/cliproxy/api/management-client'
import { Type } from '@sinclair/typebox'

// These APIs null out fields rather than omitting them, and an absent value means the same as
// a null one everywhere we read quota, so accept both.
export function Nullable<T extends TSchema>(schema: T): TOptional<TUnion<[T, TNull]>> {
  return Type.Optional(Type.Union([schema, Type.Null()]))
}

export interface QuotaWindow {
  label: string
  remainingPercent?: number
  balance?: { amount: number, currency: string, suffix: 'left' | 'used' }
  key?: string // scopes a window to a subset of models, or excludes it from the account minimum
  resetsAt?: number // epoch ms when the window refreshes; omitted when unknown or already past
}

export interface QuotaReport {
  provider: 'codex' | 'antigravity' | 'claude' | 'grok' | 'kimi'
  windows: QuotaWindow[] // codex/claude/grok/kimi: account-level windows (5h / 7d / …)
  models?: Record<string, { remainingPercent: number, resetsAt?: number }> // antigravity: keyed by proxy model id
  account?: { authIndex: string, label: string } // identifies which signed-in account the report belongs to
  error?: string
}

// One upstream usage endpoint plus the two things only this provider knows: how to read its
// payload, and how to map one of its models back to a remaining-quota percent.
export interface QuotaProvider {
  method: 'GET' | 'POST'
  url: string
  header: Record<string, string>
  // Request body. Returning an error reports it without calling the upstream.
  body?: (entry: AuthFileRaw) => { data: string } | { error: string }
  apply: (report: QuotaReport, data: unknown) => void
  owners: string[] // proxy `owned_by` values this provider bills for
  remaining: (report: QuotaReport, proxyModelId: string) => number | undefined
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

// Accepts an ISO-8601 string or epoch seconds and returns epoch ms, dropping values already in the past.
export function parseReset(value: string | number | null | undefined): number | undefined {
  if (value == null)
    return undefined
  const ms = typeof value === 'string' ? Date.parse(value) : value * 1000
  return Number.isNaN(ms) || ms <= Date.now() ? undefined : ms
}

// Percent of a used/limit pair, or undefined when either side is missing or there is no cap.
export function percentOf(used: number | undefined, limit: number | undefined): number | undefined {
  return used === undefined || limit === undefined || limit <= 0 ? undefined : (used / limit) * 100
}

// The tightest window gates the account, so it is what a model has left.
export function minRemaining(windows: readonly QuotaWindow[]): number | undefined {
  const percents = windows.map(window => window.remainingPercent).filter((percent): percent is number => percent !== undefined)
  return percents.length > 0 ? Math.min(...percents) : undefined
}
