import type { QuotaProvider, QuotaWindow } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { clamp, parseReset, percentOf } from '@src/cliproxy/quota/providers/types'
import { asValue } from '@src/shared/json'

// format=credits returns the unified pool (creditUsagePercent + currentPeriod) on top of the
// legacy monthly counters, so one request covers both account shapes.
const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

const MetricSchema = Type.Object({
  val: Type.Optional(Type.Number()),
})

const BodySchema = Type.Object({
  config: Type.Optional(Type.Object({
    used: Type.Optional(MetricSchema),
    monthlyLimit: Type.Optional(MetricSchema),
    billingPeriodEnd: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    creditUsagePercent: Type.Optional(Type.Number()),
    currentPeriod: Type.Optional(Type.Object({
      end: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    })),
    onDemandCap: Type.Optional(MetricSchema),
    onDemandUsed: Type.Optional(MetricSchema),
  })),
})

export const grokProvider: QuotaProvider = {
  method: 'GET',
  url: BILLING_URL,
  header: { 'Authorization': 'Bearer $TOKEN$', 'X-XAI-Token-Auth': 'xai-grok-cli', 'Accept': 'application/json' },
  apply: (report, data) => {
    report.windows = parseWindows(data)
  },
  owners: ['xai'],
  // The shared credit pool is the first window; on-demand spend does not gate normal use.
  remaining: report => report.windows[0]?.remainingPercent,
}

// Grok bills from a shared credit pool. Unified accounts publish creditUsagePercent (and no
// cap); older ones only expose monthly used/limit counters, so fall back to those and finally
// to spend-to-date when there is no cap to divide by.
function parseWindows(data: unknown): QuotaWindow[] {
  const config = asValue(BodySchema, data)?.config
  const used = config?.used?.val
  const percentUsed = config?.creditUsagePercent ?? percentOf(used, config?.monthlyLimit?.val)
  if (percentUsed === undefined && used === undefined)
    return []
  const reset = parseReset(config?.currentPeriod?.end) ?? parseReset(config?.billingPeriodEnd)
  const resetsAt = reset === undefined ? {} : { resetsAt: reset }
  const measure = percentUsed === undefined
    ? { balance: { amount: (used ?? 0) / 100, currency: 'USD', suffix: 'used' as const } }
    : { remainingPercent: clamp(100 - percentUsed, 0, 100) }
  const onDemandUsed = percentOf(config?.onDemandUsed?.val, config?.onDemandCap?.val)
  return [
    { label: 'Credits', ...measure, ...resetsAt },
    ...(onDemandUsed === undefined ? [] : [{ label: 'On-Demand', remainingPercent: clamp(100 - onDemandUsed, 0, 100), ...resetsAt }]),
  ]
}
