import type { Static } from '@sinclair/typebox'
import type { QuotaProvider, QuotaWindow } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { clamp, minRemaining, Nullable, parseReset, percentOf } from '@src/cliproxy/quota/providers/types'
import { asValue } from '@src/shared/json'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const WEEKLY_WINDOW_SECONDS = 604_800

const WindowSchema = Type.Object({
  used_percent: Nullable(Type.Number()),
  limit_window_seconds: Nullable(Type.Number()),
  reset_at: Nullable(Type.Union([Type.String(), Type.Number()])),
  reset_after_seconds: Nullable(Type.Number()),
})

const RateLimitSchema = Type.Object({
  primary_window: Nullable(WindowSchema),
  secondary_window: Nullable(WindowSchema),
})

const AdditionalLimitSchema = Type.Object({
  limit_name: Nullable(Type.String()),
  metered_feature: Nullable(Type.String()),
  rate_limit: Nullable(RateLimitSchema),
})

const BodySchema = Type.Object({
  rate_limit: Nullable(RateLimitSchema),
  additional_rate_limits: Nullable(Type.Array(Type.Unknown())),
  spend_control: Nullable(Type.Object({
    individual_limit: Nullable(Type.Object({
      limit: Nullable(Type.Number()),
      used: Nullable(Type.Number()),
    })),
  })),
})

export const codexProvider: QuotaProvider = {
  // The credential identifies the account; no Chatgpt-Account-Id header needed.
  method: 'GET',
  url: USAGE_URL,
  header: { 'Authorization': 'Bearer $TOKEN$', 'Content-Type': 'application/json' },
  apply: (report, data) => {
    report.windows = parseWindows(data)
  },
  owners: ['openai'],
  // Spark and purchased credits are separate pools, so they never gate a regular model.
  remaining: report => minRemaining(report.windows.filter(window => window.key === undefined)),
}

function parseWindows(data: unknown): QuotaWindow[] {
  const body = asValue(BodySchema, data)
  if (body === undefined)
    return []
  const windows = rateWindows(body.rate_limit)
  for (const rawLimit of body.additional_rate_limits ?? []) {
    const entry = asValue(AdditionalLimitSchema, rawLimit)
    if (!`${entry?.limit_name} ${entry?.metered_feature}`.toLowerCase().includes('spark'))
      continue
    windows.push(...rateWindows(entry?.rate_limit).map(window => ({ ...window, key: 'spark', label: `Spark ${window.label}` })))
  }
  // Reported as a used/limit pair in an unspecified unit, so report the ratio rather than
  // guessing whether the amounts are cents or dollars.
  const individual = body.spend_control?.individual_limit
  const creditsUsed = percentOf(individual?.used ?? 0, individual?.limit ?? undefined)
  if (creditsUsed !== undefined)
    windows.push({ key: 'credits', label: 'Credits', remainingPercent: clamp(100 - creditsUsed, 0, 100) })
  return windows
}

function rateWindows(rateLimit: Static<typeof RateLimitSchema> | null | undefined): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  for (const raw of [rateLimit?.primary_window, rateLimit?.secondary_window]) {
    if (raw == null)
      continue
    const used = raw.used_percent
    const resetsAt = windowReset(raw)
    // exactOptionalPropertyTypes forbids assigning explicit undefined, so omit when unknown.
    windows.push({
      label: raw.limit_window_seconds === WEEKLY_WINDOW_SECONDS ? '7d Quota' : '5h Quota',
      ...(used == null ? {} : { remainingPercent: clamp(100 - used, 0, 100) }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }
  return windows
}

// Codex gives an absolute reset_at (epoch seconds); when absent, reset_after_seconds is relative to now.
function windowReset(window: Static<typeof WindowSchema>): number | undefined {
  const absolute = parseReset(window.reset_at)
  if (absolute !== undefined)
    return absolute
  const after = window.reset_after_seconds
  return after == null ? undefined : Date.now() + after * 1000
}
