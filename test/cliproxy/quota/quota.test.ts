import type { QuotaReport } from '@src/cliproxy/quota/quota'
import { fetchQuotas, formatResetCountdown, remainingForModel } from '@src/cliproxy/quota/quota'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createManagementClientFake } from '../support/management'

const CODEX_BODY = JSON.stringify({
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 1, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 49, limit_window_seconds: 604_800 },
  },
})

const ANTIGRAVITY_BODY = JSON.stringify({
  models: {
    'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6', quotaInfo: { remainingFraction: 0.1, resetTime: '2026-06-02T00:00:00Z' } },
    'gemini-pro-agent': { displayName: 'Gemini 3.1 Pro (High)', quotaInfo: { remainingFraction: 1 } },
    'chat_001': { quotaInfo: null },
  },
})

const CLAUDE_BODY = JSON.stringify({
  five_hour: { utilization: 20, resets_at: '2026-06-25T12:00:00Z' },
  seven_day: { utilization: 5, resets_at: '2026-07-01T00:00:00Z' },
  seven_day_sonnet: { utilization: 60, resets_at: '2026-07-01T00:00:00Z' },
  seven_day_opus: { utilization: 90, resets_at: '2026-07-01T00:00:00Z' },
  extra_usage: { is_enabled: true, utilization: 25, used_credits: 500, monthly_limit: 2000, currency: 'EUR', decimal_places: 2 },
})

const GROK_BODY = JSON.stringify({
  config: {
    creditUsagePercent: 25,
    onDemandCap: { val: 0 },
    currentPeriod: { end: '2026-08-01T00:00:00Z' },
  },
})

const KIMI_BODY = JSON.stringify({
  usage: { limit: '100', used: '64', remaining: '36', resetTime: '2026-06-04T06:02:56.054721Z' },
  limits: [
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '4', remaining: '96' } },
  ],
  totalQuota: { limit: '100', remaining: '99' },
})

function respondOk(url: string) {
  if (url.includes('wham/usage'))
    return { statusCode: 200, body: CODEX_BODY }
  if (url.includes('fetchAvailableModels'))
    return { statusCode: 200, body: ANTIGRAVITY_BODY }
  if (url.includes('oauth/usage'))
    return { statusCode: 200, body: CLAUDE_BODY }
  if (url.includes('grok.com/v1/billing'))
    return { statusCode: 200, body: GROK_BODY }
  if (url.includes('api.kimi.com/coding/v1/usages'))
    return { statusCode: 200, body: KIMI_BODY }
  return { statusCode: 404, body: '' }
}

describe('fetchQuotas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') })
  })

  it('parses codex 5h/7d windows from a string body', async () => {
    const { client } = createManagementClientFake([{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.provider).toBe('codex')
    expect(report.windows).toEqual([
      { label: '5h Quota', remainingPercent: 99 },
      { label: '7d Quota', remainingPercent: 51 },
    ])
  })

  it('parses codex reset_at as epoch seconds, falling back to reset_after_seconds', async () => {
    const now = Date.now()
    const body = JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_at: Math.floor(now / 1000) + 3600 },
        secondary_window: { used_percent: 20, limit_window_seconds: 604_800, reset_after_seconds: 86_400 },
      },
    })
    const { client } = createManagementClientFake([{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }], () => ({
      statusCode: 200,
      body,
    }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows[0]?.resetsAt).toBe(now + 3600 * 1000)
    expect(report.windows[1]?.resetsAt).toBe(now + 86_400 * 1000)
  })

  it('drops reset times that are already in the past', async () => {
    const body = JSON.stringify({
      config: { creditUsagePercent: 10, currentPeriod: { end: '2025-01-01T00:00:00Z' } },
    })
    const { client } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], () => ({
      statusCode: 200,
      body,
    }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([{ label: 'Credits', remainingPercent: 90 }])
  })

  it('maps antigravity quota by model id, skipping entries without a fraction', async () => {
    const { client } = createManagementClientFake([{ name: 'anti.json', provider: 'antigravity', auth_index: 'a1', project_id: 'p1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.models).toEqual({
      'claude-sonnet-4-6': { remainingPercent: 10, resetsAt: Date.parse('2026-06-02T00:00:00Z') },
      'gemini-pro-agent': { remainingPercent: 100 },
    })
  })

  it('parses claude account windows and enabled extra usage', async () => {
    const { client } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.provider).toBe('claude')
    expect(report.windows).toEqual([
      { key: 'five_hour', label: '5h Quota', remainingPercent: 80, resetsAt: Date.parse('2026-06-25T12:00:00Z') },
      { key: 'seven_day', label: '7d Quota', remainingPercent: 95, resetsAt: Date.parse('2026-07-01T00:00:00Z') },
      { key: 'seven_day_sonnet', label: '7d Sonnet', remainingPercent: 40, resetsAt: Date.parse('2026-07-01T00:00:00Z') },
      { key: 'seven_day_opus', label: '7d Opus', remainingPercent: 10, resetsAt: Date.parse('2026-07-01T00:00:00Z') },
      { key: 'extra_usage', label: 'Extra Usage', remainingPercent: 75, balance: { amount: 15, currency: 'EUR', suffix: 'left' } },
    ])
  })

  it('keeps claude used credits when no monthly limit is available', async () => {
    const body = JSON.stringify({
      five_hour: { utilization: 20, resets_at: null },
      seven_day_sonnet: null,
      extra_usage: {
        is_enabled: true,
        monthly_limit: null,
        used_credits: 755,
        utilization: null,
        currency: 'EUR',
        decimal_places: 2,
      },
      unknown_limit: null,
      rate_limits: [
        { kind: 'session', percent: 0, resets_at: null, is_active: false },
        { kind: 'weekly_all', percent: 61, resets_at: '2026-07-25T09:00:00.306312+00:00', is_active: true },
      ],
      feature_enabled: false,
    })
    const { client } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], () => ({
      statusCode: 200,
      body,
    }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([
      { key: 'five_hour', label: '5h Quota', remainingPercent: 80 },
      { key: 'extra_usage', label: 'Extra Usage', balance: { amount: 7.55, currency: 'EUR', suffix: 'used' } },
    ])
  })

  it('parses the grok premium credit pool as a single window', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.provider).toBe('grok')
    expect(report.windows).toEqual([{ label: 'Credits', remainingPercent: 75, resetsAt: Date.parse('2026-08-01T00:00:00Z') }])
    expect(apiCall.mock.calls[0]![0]).toMatchObject({
      url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      header: { Authorization: 'Bearer $TOKEN$', Accept: 'application/json' },
    })
  })

  it('prefers the unified credit pool percent and its period end', async () => {
    const body = JSON.stringify({
      config: {
        creditUsagePercent: 40,
        used: { val: 30 },
        monthlyLimit: { val: 120 },
        currentPeriod: { start: '2026-05-25T00:00:00Z', end: '2026-06-08T00:00:00Z' },
        onDemandCap: { val: 50 },
        onDemandUsed: { val: 5 },
        billingPeriodEnd: '2026-08-01T00:00:00Z',
      },
    })
    const { client } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([
      { label: 'Credits', remainingPercent: 60, resetsAt: Date.parse('2026-06-08T00:00:00Z') },
      { label: 'On-Demand', remainingPercent: 90, resetsAt: Date.parse('2026-06-08T00:00:00Z') },
    ])
  })

  it('sums grok product usage when the aggregate percent is absent', async () => {
    const body = JSON.stringify({
      config: {
        currentPeriod: { end: '2026-06-08T00:00:00Z' },
        productUsage: [
          { product: 'GrokBuild', usagePercent: 17 },
          { product: 'GrokChat', usagePercent: 1 },
        ],
      },
    })
    const { client } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([
      { label: 'Credits', remainingPercent: 82, resetsAt: Date.parse('2026-06-08T00:00:00Z') },
    ])
  })

  it('ignores an empty grok product usage list', async () => {
    const body = JSON.stringify({ config: { productUsage: [] } })
    const { client } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([])
  })

  it('parses kimi windows, labelling each from its own duration', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'kimi.json', type: 'kimi', auth_index: 'k1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.provider).toBe('kimi')
    expect(report.windows).toEqual([
      { label: 'Weekly Quota', remainingPercent: 36, resetsAt: Date.parse('2026-06-04T06:02:56.054721Z') },
      { label: '5h Quota', remainingPercent: 96 },
      { label: 'Total', remainingPercent: 99 },
    ])
    expect(apiCall.mock.calls[0]![0]).toMatchObject({ url: 'https://api.kimi.com/coding/v1/usages' })
  })

  it('drops kimi windows without a usable limit', async () => {
    const body = JSON.stringify({
      usage: { limit: '0', used: '12', remaining: '0' },
      limits: [{ detail: { limit: 'bad', used: '1' } }],
      totalQuota: { limit: '100', remaining: '25' },
    })
    const { client } = createManagementClientFake([{ name: 'kimi.json', type: 'kimi', auth_index: 'k1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([{ label: 'Total', remainingPercent: 25 }])
  })

  it('parses codex spark and purchased credit windows', async () => {
    const body = JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 18_000 },
      },
      additional_rate_limits: [
        { limit_name: 'gpt-5-spark', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18_000 } } },
        { limit_name: 'other', rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 18_000 } } },
      ],
      spend_control: { individual_limit: { limit: 2000, used: 500 } },
    })
    const { client } = createManagementClientFake([{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([
      { label: '5h Quota', remainingPercent: 99 },
      { key: 'spark', label: 'Spark 5h Quota', remainingPercent: 75 },
      { key: 'credits', label: 'Credits', remainingPercent: 75 },
    ])
  })

  it('keeps codex windows when the optional sections arrive as null', async () => {
    const body = JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 18_000, reset_at: null, reset_after_seconds: null },
        secondary_window: null,
      },
      additional_rate_limits: null,
      spend_control: { individual_limit: null },
    })
    const { client } = createManagementClientFake([{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([{ label: '5h Quota', remainingPercent: 99 }])
  })

  it('parses claude model-scoped weekly caps, skipping legacy duplicates', async () => {
    const body = JSON.stringify({
      seven_day_opus: { utilization: 90, resets_at: '2026-07-01T00:00:00Z' },
      limits: [
        { kind: 'weekly_scoped', percent: 30, resets_at: '2026-07-02T00:00:00Z', scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 10, resets_at: '2026-07-01T00:00:00Z', scope: { model: { display_name: 'Opus' } } },
        { kind: 'weekly_all', percent: 61, resets_at: '2026-07-01T00:00:00Z', scope: null },
      ],
    })
    const { client } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], () => ({ statusCode: 200, body }))

    const report = (await fetchQuotas(client))[0]!

    expect(report.windows).toEqual([
      { key: 'seven_day_opus', label: '7d Opus', remainingPercent: 10, resetsAt: Date.parse('2026-07-01T00:00:00Z') },
      { key: 'seven_day_fable', label: '7d Fable', remainingPercent: 70, resetsAt: Date.parse('2026-07-02T00:00:00Z') },
    ])
  })

  it('reports an HTTP error instead of throwing', async () => {
    const { client, apiCall } = createManagementClientFake(
      [{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }],
      () => ({ statusCode: 401, body: 'unauthorized' }),
    )

    const report = (await fetchQuotas(client))[0]!
    expect(report).toMatchObject({ provider: 'codex', error: expect.stringContaining('HTTP 401') as string, windows: [] })
    expect(apiCall).toHaveBeenCalledTimes(1)
  })

  it('includes the upstream url and error body in the reported error', async () => {
    const { client } = createManagementClientFake(
      [{ name: 'claude.json', type: 'claude', auth_index: 'x1' }],
      () => ({ statusCode: 429, body: '{"error":{"type":"rate_limit_error"}}' }),
    )

    const report = (await fetchQuotas(client))[0]!
    expect(report.error).toContain('https://api.anthropic.com/api/oauth/usage')
    expect(report.error).toContain('rate_limit_error')
  })

  it('captures the upstream Retry-After from a 429 as an epoch deadline', async () => {
    const { client } = createManagementClientFake(
      [{ name: 'claude.json', type: 'claude', auth_index: 'x1' }],
      () => ({ statusCode: 429, body: '', header: { 'Retry-After': ['238'] } }),
    )
    const backoff = new Map<string, number>()

    const report = (await fetchQuotas(client, undefined, backoff))[0]!
    expect(report).toMatchObject({ provider: 'claude', error: expect.stringContaining('HTTP 429') as string })
    expect(backoff.get('x1')).toBe(Date.now() + 238_000)
  })

  it('falls back to a floor deadline when a 429 carries no Retry-After', async () => {
    const { client } = createManagementClientFake(
      [{ name: 'claude.json', type: 'claude', auth_index: 'x1' }],
      () => ({ statusCode: 429, body: '' }),
    )
    const backoff = new Map<string, number>()

    const report = (await fetchQuotas(client, undefined, backoff))[0]!
    expect(report).toMatchObject({ provider: 'claude', error: expect.stringContaining('HTTP 429') as string })
    expect(backoff.get('x1')).toBe(Date.now() + 300_000)
  })

  it('backs off from an exhausted unified rate limit on a successful response', async () => {
    const reset = new Date(Date.now() + 90_000).toISOString()
    const { client } = createManagementClientFake(
      [{ name: 'claude.json', type: 'claude', auth_index: 'x1' }],
      () => ({
        statusCode: 200,
        body: CLAUDE_BODY,
        header: {
          'Anthropic-Ratelimit-Unified-Remaining': ['0'],
          'Anthropic-Ratelimit-Unified-Reset': [reset],
        },
      }),
    )
    const backoff = new Map<string, number>()

    const report = (await fetchQuotas(client, undefined, backoff))[0]!
    expect(report.error).toBeUndefined()
    expect(backoff.get('x1')).toBe(Date.parse(reset))
  })

  it('clears the backoff once the upstream stops rate limiting', async () => {
    const { client } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], respondOk)
    const backoff = new Map([['x1', Date.now() - 1]])

    await fetchQuotas(client, undefined, backoff)
    expect(backoff.has('x1')).toBe(false)
  })

  it('skips the upstream call while an account is inside its Retry-After window', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], respondOk)
    const until = Date.now() + 60_000

    const report = (await fetchQuotas(client, undefined, new Map([['x1', until]])))[0]!
    expect(report).toMatchObject({ provider: 'claude', error: 'rate limited' })
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('fetches normally once the Retry-After window has elapsed', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], respondOk)

    const report = (await fetchQuotas(client, undefined, new Map([['x1', Date.now() - 1]])))[0]!
    expect(report.error).toBeUndefined()
    expect(apiCall).toHaveBeenCalledTimes(1)
  })

  it('reports missing project_id without calling the upstream', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'anti.json', provider: 'antigravity', auth_index: 'a1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!
    expect(report).toMatchObject({ error: 'missing project_id' })
    expect(apiCall).not.toHaveBeenCalled()
  })
})

describe('remainingForModel', () => {
  const reports: QuotaReport[] = [
    { provider: 'codex', windows: [
      { label: '5h Quota', remainingPercent: 80 },
      { label: '7d Quota', remainingPercent: 8 },
      { key: 'spark', label: 'Spark 5h Quota', remainingPercent: 2 },
      { key: 'credits', label: 'Credits', remainingPercent: 1 },
    ] },
    { provider: 'antigravity', windows: [], models: { 'gemini-pro-agent': { remainingPercent: 35 } } },
    { provider: 'grok', windows: [{ label: 'Credits', remainingPercent: 75 }] },
    { provider: 'kimi', windows: [{ label: 'Weekly Quota', remainingPercent: 60 }, { label: '5h Quota', remainingPercent: 22 }] },
    { provider: 'claude', windows: [
      { key: 'five_hour', label: '5h Quota', remainingPercent: 80 },
      { key: 'seven_day', label: '7d Quota', remainingPercent: 50 },
      { key: 'seven_day_sonnet', label: '7d Sonnet', remainingPercent: 40 },
      { key: 'seven_day_opus', label: '7d Opus', remainingPercent: 10 },
      { key: 'extra_usage', label: 'Extra Usage', remainingPercent: 5 },
    ] },
  ]

  it('returns the antigravity per-model percent', () => {
    expect(remainingForModel(reports, { proxyOwner: 'antigravity', proxyModelId: 'gemini-pro-agent' })).toBe(35)
  })

  it('returns the tightest codex window for any openai model, ignoring spark and credits', () => {
    expect(remainingForModel(reports, { proxyOwner: 'openai', proxyModelId: 'gpt-5-codex' })).toBe(8)
  })

  it('returns the tightest kimi window for any moonshot model', () => {
    expect(remainingForModel(reports, { proxyOwner: 'moonshot', proxyModelId: 'kimi-k2.5' })).toBe(22)
  })

  it('returns the grok credit window for any xai model', () => {
    expect(remainingForModel(reports, { proxyOwner: 'xai', proxyModelId: 'grok-code' })).toBe(75)
  })

  it('binds an unknown weekly family by name without code changes', () => {
    const withFable: QuotaReport[] = [{ provider: 'claude', windows: [
      { key: 'seven_day', label: '7d Quota', remainingPercent: 70 },
      { key: 'seven_day_fable', label: '7d Fable', remainingPercent: 15 },
    ] }]
    expect(remainingForModel(withFable, { proxyOwner: 'anthropic', proxyModelId: 'claude-fable-5' })).toBe(15)
    expect(remainingForModel(withFable, { proxyOwner: 'anthropic', proxyModelId: 'claude-opus-4-6' })).toBe(70)
  })

  it('scopes claude weekly caps to the model family, ignoring extra usage', () => {
    // Opus sees its own 10% weekly cap; Sonnet sees 40%; both gated by the shared 5h/7d windows.
    expect(remainingForModel(reports, { proxyOwner: 'anthropic', proxyModelId: 'claude-opus-4-6' })).toBe(10)
    expect(remainingForModel(reports, { proxyOwner: 'anthropic', proxyModelId: 'claude-sonnet-4-6' })).toBe(40)
    // Haiku has no family cap, so the shared 7d window (50%) is the tightest.
    expect(remainingForModel(reports, { proxyOwner: 'anthropic', proxyModelId: 'claude-haiku-4-5' })).toBe(50)
  })

  it('is undefined for an untracked antigravity model, owner, or errored report', () => {
    expect(remainingForModel(reports, { proxyOwner: 'antigravity', proxyModelId: 'unknown' })).toBeUndefined()
    expect(remainingForModel(reports, { proxyOwner: 'gemini', proxyModelId: 'gemini-3-pro' })).toBeUndefined()
    const errored: QuotaReport[] = [{ provider: 'codex', windows: [], error: 'HTTP 401' }]
    expect(remainingForModel(errored, { proxyOwner: 'openai', proxyModelId: 'gpt-5-codex' })).toBeUndefined()
  })
})

describe('formatResetCountdown', () => {
  it('formats future resets and omits unavailable ones', () => {
    vi.useFakeTimers({ now: new Date('2026-07-12T00:00:00Z') })

    expect(formatResetCountdown(Date.parse('2026-07-15T04:00:00Z'))).toBe('3d 4h')
    expect(formatResetCountdown(Date.parse('2026-07-12T03:25:00Z'))).toBe('3h 25m')
    expect(formatResetCountdown(Date.parse('2026-07-12T00:00:20Z'))).toBe('soon')
    expect(formatResetCountdown(undefined)).toBeUndefined()
    expect(formatResetCountdown(Date.parse('2026-07-11T00:00:00Z'))).toBeUndefined()
  })
})
