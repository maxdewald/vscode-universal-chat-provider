import type { QuotaProvider, QuotaWindow } from '@src/cliproxy/quota/providers/types'
import { Type } from '@sinclair/typebox'
import { clamp, minRemaining, Nullable, parseReset } from '@src/cliproxy/quota/providers/types'
import { asValue } from '@src/shared/json'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// Claude weekly caps are keyed "seven_day_<family>" (e.g. seven_day_opus); the family binds the
// window to its model family by name, so a new one like seven_day_fable works without code changes.
const SEVEN_DAY_FAMILY = /^seven_day_(.+)$/

const WindowSchema = Type.Object({
  utilization: Nullable(Type.Number()),
  resets_at: Nullable(Type.Union([Type.String(), Type.Number()])),
  is_enabled: Type.Optional(Type.Boolean()),
  used_credits: Type.Optional(Type.Number()),
  monthly_limit: Nullable(Type.Number()),
  currency: Type.Optional(Type.String()),
  decimal_places: Type.Optional(Type.Number()),
})

const WindowValueSchema = Type.Union([WindowSchema, Type.Null()])

const ScopedLimitSchema = Type.Object({
  kind: Nullable(Type.String()),
  percent: Nullable(Type.Number()),
  resets_at: Nullable(Type.Union([Type.String(), Type.Number()])),
  scope: Nullable(Type.Object({
    model: Nullable(Type.Object({
      display_name: Nullable(Type.String()),
      id: Nullable(Type.String()),
    })),
  })),
})

const BodySchema = Type.Object({
  extra_usage: Type.Optional(WindowValueSchema),
  limits: Nullable(Type.Array(Type.Unknown())),
}, { additionalProperties: true })

export const claudeProvider: QuotaProvider = {
  method: 'GET',
  url: USAGE_URL,
  header: { 'Authorization': 'Bearer $TOKEN$', 'Accept': 'application/json', 'anthropic-beta': 'oauth-2025-04-20' },
  apply: (report, data) => {
    report.windows = parseWindows(data)
  },
  owners: ['anthropic'],
  remaining: (report, proxyModelId) => {
    const id = proxyModelId.toLowerCase()
    // 5h/7d windows gate every model; a family cap (seven_day_opus) only gates its own family.
    return minRemaining(report.windows.filter((window) => {
      if (window.key === 'extra_usage')
        return false
      const family = sevenDayFamily(window.key)
      return family === undefined || id.includes(family)
    }))
  },
}

function sevenDayFamily(key: string | undefined): string | undefined {
  return SEVEN_DAY_FAMILY.exec(key ?? '')?.[1]
}

// Account-level utilization (percent used) per window, plus optional extra-usage credits.
function parseWindows(data: unknown): QuotaWindow[] {
  const body = asValue(BodySchema, data)
  if (body === undefined)
    return []
  const windows: QuotaWindow[] = []
  for (const [key, rawValue] of Object.entries(body)) {
    const label = windowLabel(key)
    if (label === undefined)
      continue
    const raw = asValue(WindowValueSchema, rawValue)
    if (raw == null)
      continue
    const used = raw.utilization
    const resetsAt = parseReset(raw.resets_at)
    windows.push({ key, label, ...(used == null ? {} : { remainingPercent: clamp(100 - used, 0, 100) }), ...(resetsAt === undefined ? {} : { resetsAt }) })
  }
  appendScopedWindows(body.limits, windows)
  const extra = body.extra_usage
  if (extra?.is_enabled === true) {
    const divisor = 10 ** (extra.decimal_places ?? 0)
    const balance = extra.used_credits === undefined || extra.currency === undefined
      ? undefined
      : {
          amount: (extra.monthly_limit == null ? extra.used_credits : Math.max(extra.monthly_limit - extra.used_credits, 0)) / divisor,
          currency: extra.currency,
          suffix: extra.monthly_limit == null ? 'used' as const : 'left' as const,
        }
    if (extra.utilization == null && balance === undefined)
      return windows
    windows.push({
      key: 'extra_usage',
      label: 'Extra Usage',
      ...(extra.utilization == null ? {} : { remainingPercent: clamp(100 - extra.utilization, 0, 100) }),
      ...(balance === undefined ? {} : { balance }),
    })
  }
  return windows
}

// Newer model-scoped weekly caps only arrive in the generic `limits` array; the legacy
// seven_day_<family> field stays null for them. Reuse that key shape so `remaining`
// keeps scoping them to their family by name.
function appendScopedWindows(limits: unknown[] | null | undefined, windows: QuotaWindow[]): void {
  for (const rawLimit of limits ?? []) {
    const entry = asValue(ScopedLimitSchema, rawLimit)
    if (entry?.kind !== 'weekly_scoped' || entry.percent == null)
      continue
    const model = entry.scope?.model
    const name = (model?.display_name ?? model?.id ?? '').trim()
    const key = `seven_day_${name.toLowerCase()}`
    if (name === '' || windows.some(window => window.key === key))
      continue
    const resetsAt = parseReset(entry.resets_at)
    windows.push({
      key,
      label: `7d ${name}`,
      remainingPercent: clamp(100 - entry.percent, 0, 100),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }
}

function windowLabel(key: string): string | undefined {
  if (key === 'five_hour')
    return '5h Quota'
  if (key === 'seven_day')
    return '7d Quota'
  const family = sevenDayFamily(key)
  return family === undefined ? undefined : `7d ${family.charAt(0).toUpperCase()}${family.slice(1)}`
}
