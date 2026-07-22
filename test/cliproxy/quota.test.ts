import type { QuotaReport } from '../../src/cliproxy/quota'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchQuotas, formatResetCountdown, remainingForModel } from '../../src/cliproxy/quota'
import { createManagementClientFake } from './support/management'

const CODEX_BODY = JSON.stringify({
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 1, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 49, limit_window_seconds: 604_800 },
  },
})

const ANTIGRAVITY_BODY = JSON.stringify({
  models: {
    'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6', quotaInfo: { remainingFraction: 0.1 } },
    'gemini-pro-agent': { displayName: 'Gemini 3.1 Pro (High)', quotaInfo: { remainingFraction: 1 } },
    'chat_001': { quotaInfo: null },
  },
})

const CLAUDE_BODY = JSON.stringify({
  five_hour: { utilization: 20, resets_at: '2026-06-25T12:00:00Z' },
  seven_day: { utilization: 5, resets_at: '2026-07-01T00:00:00Z' },
  seven_day_sonnet: { utilization: 60, resets_at: '2026-07-01T00:00:00Z' },
  seven_day_opus: { utilization: 90, resets_at: '2026-07-01T00:00:00Z' },
  extra_usage: { is_enabled: true, utilization: 25, used_credits: 5, monthly_limit: 20 },
})

const GROK_BODY = JSON.stringify({
  config: {
    used: { val: 30 },
    monthlyLimit: { val: 120 },
    onDemandCap: { val: 0 },
    billingPeriodEnd: '2026-08-01T00:00:00Z',
  },
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
      config: { used: { val: 10 }, monthlyLimit: { val: 100 }, billingPeriodEnd: '2025-01-01T00:00:00Z' },
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
      'claude-sonnet-4-6': 10,
      'gemini-pro-agent': 100,
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
      { key: 'extra_usage', label: 'Extra Usage', remainingPercent: 75 },
    ])
  })

  it('parses grok monthly credit usage as a single window', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'grok.json', type: 'xai', auth_index: 'x1' }], respondOk)

    const report = (await fetchQuotas(client))[0]!

    expect(report.provider).toBe('grok')
    expect(report.windows).toEqual([{ label: 'Credits', remainingPercent: 75, resetsAt: Date.parse('2026-08-01T00:00:00Z') }])
    expect(apiCall.mock.calls[0]![0]).toMatchObject({
      url: 'https://cli-chat-proxy.grok.com/v1/billing',
      header: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
    })
  })

  it('skips providers without a known quota endpoint', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'kimi.json', type: 'kimi', auth_index: 'x1' }], respondOk)

    await expect(fetchQuotas(client)).resolves.toEqual([])
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('reports an HTTP error instead of throwing', async () => {
    const { client, apiCall } = createManagementClientFake(
      [{ name: 'codex.json', provider: 'codex', auth_index: 'c1' }],
      () => ({ statusCode: 401, body: 'unauthorized' }),
    )

    const report = (await fetchQuotas(client))[0]!
    expect(report).toMatchObject({ provider: 'codex', error: 'HTTP 401', windows: [] })
    expect(apiCall).toHaveBeenCalledTimes(1)
  })

  it('captures the upstream Retry-After from a 429 as an epoch deadline', async () => {
    const { client } = createManagementClientFake(
      [{ name: 'claude.json', type: 'claude', auth_index: 'x1' }],
      () => ({ statusCode: 429, body: '', header: { 'Retry-After': ['238'] } }),
    )

    const report = (await fetchQuotas(client))[0]!
    expect(report).toMatchObject({ provider: 'claude', error: 'HTTP 429', retryAfter: Date.now() + 238_000 })
  })

  it('skips the upstream call while an account is inside its Retry-After window', async () => {
    const { client, apiCall } = createManagementClientFake([{ name: 'claude.json', type: 'claude', auth_index: 'x1' }], respondOk)
    const until = Date.now() + 60_000

    const report = (await fetchQuotas(client, undefined, new Map([['x1', until]])))[0]!
    expect(report).toMatchObject({ provider: 'claude', error: 'rate limited', retryAfter: until })
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
    { provider: 'codex', windows: [{ label: '5h Quota', remainingPercent: 80 }, { label: '7d Quota', remainingPercent: 8 }] },
    { provider: 'antigravity', windows: [], models: { 'gemini-pro-agent': 35 } },
    { provider: 'grok', windows: [{ label: 'Credits', remainingPercent: 75 }] },
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

  it('returns the tightest codex window for any openai model', () => {
    expect(remainingForModel(reports, { proxyOwner: 'openai', proxyModelId: 'gpt-5-codex' })).toBe(8)
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
    expect(remainingForModel(reports, { proxyOwner: 'kimi', proxyModelId: 'k2' })).toBeUndefined()
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
