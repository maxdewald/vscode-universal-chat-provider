import type { Static } from '@sinclair/typebox'
import type { QuotaProvider, QuotaWindow } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { clamp, minRemaining, parseReset, percentOf } from '@src/cliproxy/quota/providers/types'
import { asValue } from '@src/shared/json'

const USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
// Durations arrive as a value plus a TIME_UNIT_* enum; normalize to minutes, e.g. 300 -> "5h Quota".
const MINUTES_PER_UNIT = [['SECOND', 1 / 60], ['HOUR', 60], ['DAY', 1440]] as const

// Kimi reports its counters as strings ("100", "64"); Type.Number covers newer payloads.
const CountSchema = Type.Optional(Type.Union([Type.String(), Type.Number()]))

const UsageSchema = Type.Object({
  limit: CountSchema,
  used: CountSchema,
  remaining: CountSchema,
  resetTime: Type.Optional(Type.String()),
})

const LimitSchema = Type.Object({
  window: Type.Optional(Type.Object({
    duration: Type.Optional(Type.Number()),
    timeUnit: Type.Optional(Type.String()),
  })),
  detail: Type.Optional(UsageSchema),
})

const BodySchema = Type.Object({
  usage: Type.Optional(UsageSchema),
  limits: Type.Optional(Type.Array(Type.Unknown())),
  totalQuota: Type.Optional(UsageSchema),
})

export const kimiProvider: QuotaProvider = {
  method: 'GET',
  url: USAGE_URL,
  header: { Authorization: 'Bearer $TOKEN$', Accept: 'application/json' },
  apply: (report, data) => {
    report.windows = parseWindows(data)
  },
  owners: ['moonshot'],
  remaining: report => minRemaining(report.windows),
}

// Kimi publishes a rolling window per entry in `limits`, plus an account-wide `usage`
// (weekly) and a lifetime `totalQuota`. Every counter is a used/limit pair.
function parseWindows(data: unknown): QuotaWindow[] {
  const body = asValue(BodySchema, data)
  if (body === undefined)
    return []
  const limits = (body.limits ?? []).map(rawLimit => asValue(LimitSchema, rawLimit))
  return [
    usageWindow('Weekly Quota', body.usage),
    ...limits.map(limit => usageWindow(windowLabel(limit?.window), limit?.detail)),
    usageWindow('Total', body.totalQuota),
  ].filter((window): window is QuotaWindow => window !== undefined)
}

function usageWindow(label: string, usage: Static<typeof UsageSchema> | undefined): QuotaWindow | undefined {
  const limit = count(usage?.limit)
  const remaining = count(usage?.remaining)
  const used = count(usage?.used) ?? (limit === undefined || remaining === undefined ? undefined : limit - remaining)
  const percentUsed = percentOf(used, limit)
  if (percentUsed === undefined)
    return undefined
  const resetsAt = parseReset(usage?.resetTime)
  return { label, remainingPercent: clamp(100 - percentUsed, 0, 100), ...(resetsAt === undefined ? {} : { resetsAt }) }
}

function count(value: string | number | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function windowLabel(window: { duration?: number, timeUnit?: string } | undefined): string {
  const duration = window?.duration
  if (duration === undefined || duration <= 0)
    return 'Quota'
  const unit = window?.timeUnit?.toUpperCase() ?? ''
  const minutes = duration * (MINUTES_PER_UNIT.find(([name]) => unit.includes(name))?.[1] ?? 1)
  if (minutes % 1440 === 0)
    return `${minutes / 1440}d Quota`
  return minutes % 60 === 0 ? `${minutes / 60}h Quota` : `${Math.round(minutes)}m Quota`
}
