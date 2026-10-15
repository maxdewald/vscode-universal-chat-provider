import type { AuthFileRaw, CredentialQuota, ManagementClient } from '@src/cliproxy/api/management-client'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import { fetchQuotas, formatResetCountdown, quotaProviderForModel, quotaWindows, remainingForModel } from '@src/cliproxy/quota/quota'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ModelInfo = Array<{ id: string, name?: string }>

function createClient(
  files: AuthFileRaw[],
  quotas: Record<string, CredentialQuota | Error>,
  models: Record<string, ModelInfo> = {},
) {
  const fetchCredentialQuota = vi.fn(async (authIndex: string) => {
    const quota = quotas[authIndex]
    if (quota === undefined)
      throw new Error('no quota provider available for credential')
    if (quota instanceof Error)
      throw quota
    return quota
  })
  const listAuthFileModelInfo = vi.fn(async (name: string) => models[name] ?? [])
  const apiCall = vi.fn()
  return {
    client: {
      listAuthFilesRaw: vi.fn(async () => files),
      fetchCredentialQuota,
      listAuthFileModelInfo,
      apiCall,
    } as unknown as ManagementClient,
    fetchCredentialQuota,
    apiCall,
  }
}

const FIVE_HOUR_WEEKLY: CredentialQuota = {
  groups: [{ displayName: 'Usage', buckets: [
    { window: '5h', remainingFraction: 0.99, resetTime: '2026-06-01T05:00:00Z' },
    { window: '7d', remainingFraction: 0.51 },
  ] }],
}

describe('fetchQuotas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') })
  })

  it('reads normalized windows from CLIProxyAPI for every credential it supports', async () => {
    const { client, apiCall } = createClient(
      [{ name: 'codex.json', provider: 'codex', auth_index: 'c1', email: 'a@example.com', supports_quota: true }],
      { c1: FIVE_HOUR_WEEKLY },
      { 'codex.json': [{ id: 'gpt-6' }] },
    )

    expect(await fetchQuotas(client)).toEqual([{
      provider: 'codex',
      title: 'Codex',
      account: { authIndex: 'c1', label: 'a@example.com' },
      models: [{ id: 'gpt-6' }],
      windows: [
        { label: 'Usage · 5h', group: 'Usage', remainingPercent: 99, resetsAt: Date.parse('2026-06-01T05:00:00Z') },
        { label: 'Usage · 7d', group: 'Usage', remainingPercent: 51 },
      ],
    }])
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('skips credentials the server cannot report quota for, and disabled ones', async () => {
    const { client, fetchCredentialQuota } = createClient([
      { name: 'meta.json', provider: 'meta', auth_index: 'm1' },
      { name: 'devin.json', provider: 'devin', auth_index: 'd1', supports_quota: true },
      { name: 'off.json', provider: 'codex', auth_index: 'c1', supports_quota: true, disabled: true },
      { name: 'orphan.json', provider: 'codex', supports_quota: true },
    ], { d1: FIVE_HOUR_WEEKLY })

    const reports = await fetchQuotas(client)

    expect(reports.map(report => [report.provider, report.title])).toEqual([['devin', 'Devin']])
    expect(fetchCredentialQuota).toHaveBeenCalledTimes(1)
  })

  it('titles providers it has never heard of from their server key', async () => {
    const { client } = createClient([{ name: 'k.json', provider: 'kiro', auth_index: 'k1', supports_quota: true }], { k1: FIVE_HOUR_WEEKLY })

    expect((await fetchQuotas(client))[0]?.title).toBe('Kiro')
  })

  it('fetches only the requested provider', async () => {
    const { client, fetchCredentialQuota } = createClient([
      { name: 'codex.json', provider: 'codex', auth_index: 'c1', supports_quota: true },
      { name: 'claude.json', provider: 'claude', auth_index: 'a1', supports_quota: true },
    ], { c1: FIVE_HOUR_WEEKLY, a1: FIVE_HOUR_WEEKLY })

    const reports = await fetchQuotas(client, undefined, new Map(), 'claude')

    expect(reports.map(report => report.provider)).toEqual(['claude'])
    expect(fetchCredentialQuota).toHaveBeenCalledWith('a1', undefined)
  })

  it('reports a server error instead of throwing', async () => {
    const { client } = createClient(
      [{ name: 'claude.json', provider: 'claude', auth_index: 'a1', supports_quota: true }],
      { a1: new Error('failed to fetch quota: upstream returned 401') },
    )

    expect((await fetchQuotas(client))[0]).toMatchObject({ provider: 'claude', windows: [], error: 'failed to fetch quota: upstream returned 401' })
  })

  it('sits out a rate-limited account, then fetches again once the floor has elapsed', async () => {
    const backoff = new Map<string, number>()
    const quotas: Record<string, CredentialQuota | Error> = { a1: new Error('failed to fetch quota: upstream returned 429') }
    const { client, fetchCredentialQuota } = createClient([{ name: 'claude.json', provider: 'claude', auth_index: 'a1', supports_quota: true }], quotas)

    await fetchQuotas(client, undefined, backoff)
    expect(backoff.get('a1')).toBe(Date.parse('2026-06-01T00:05:00Z'))

    const skipped = await fetchQuotas(client, undefined, backoff)
    expect(skipped[0]).toMatchObject({ windows: [] })
    expect(skipped[0]?.error).toBeUndefined()
    expect(fetchCredentialQuota).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60_000 + 1)
    quotas['a1'] = FIVE_HOUR_WEEKLY
    await fetchQuotas(client, undefined, backoff)
    expect(fetchCredentialQuota).toHaveBeenCalledTimes(2)
    expect(backoff.has('a1')).toBe(false)
  })
})

describe('quotaWindows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') })
  })

  it('clamps fractions, falls back to the bucket description, and drops past resets', () => {
    expect(quotaWindows({ groups: [
      { buckets: [{ description: 'Credits', remainingFraction: 1.2 }] },
      { displayName: 'Weekly', buckets: [{ remainingFraction: -0.1, resetTime: '2026-05-01T00:00:00Z' }] },
      { displayName: 'Empty' },
    ] })).toEqual([
      { label: 'Credits', remainingPercent: 100 },
      { label: 'Weekly', group: 'Weekly', remainingPercent: 0 },
    ])
  })

  it('moves server reset times onto the local clock', () => {
    const [window] = quotaWindows({
      serverTimeOffsetMs: 60_000,
      groups: [{ buckets: [{ window: '5h', remainingFraction: 0.5, resetTime: '2026-06-01T01:00:00Z' }] }],
    })

    expect(window?.resetsAt).toBe(Date.parse('2026-06-01T00:59:00Z'))
  })
})

describe('remainingForModel', () => {
  const codex: QuotaReport = {
    provider: 'codex',
    title: 'Codex',
    models: [{ id: 'gpt-6' }],
    windows: [{ label: '5h', remainingPercent: 80 }, { label: '7d', remainingPercent: 8 }],
  }
  const antigravity: QuotaReport = {
    provider: 'antigravity',
    title: 'Antigravity',
    models: [{ id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' }, { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
    windows: [
      { label: 'Gemini 3.1 Pro (High)', group: 'Gemini 3.1 Pro (High)', remainingPercent: 35 },
      { label: 'claude-sonnet-4-6', group: 'claude-sonnet-4-6', remainingPercent: 10 },
    ],
  }

  it('takes the tightest account-wide window for a model the credential serves', () => {
    expect(remainingForModel([codex], { proxyModelId: 'gpt-6' })).toBe(8)
  })

  it('scopes windows grouped under a served model to that model only', () => {
    expect(remainingForModel([antigravity], { proxyModelId: 'gemini-pro-agent' })).toBe(35)
    expect(remainingForModel([antigravity], { proxyModelId: 'claude-sonnet-4-6' })).toBe(10)
  })

  it('takes each account\'s tightest window before selecting the best account', () => {
    const accounts: QuotaReport[] = [
      { ...codex, windows: [{ label: '5h', remainingPercent: 100 }, { label: '7d', remainingPercent: 5 }] },
      { ...codex, windows: [{ label: '5h', remainingPercent: 10 }, { label: '7d', remainingPercent: 100 }] },
      { ...codex, windows: [{ label: '5h', remainingPercent: 100 }], error: 'HTTP 401' },
    ]
    expect(remainingForModel(accounts, { proxyModelId: 'gpt-6' })).toBe(10)
  })

  it('is undefined for models no credential with quota serves', () => {
    expect(remainingForModel([codex, antigravity], { proxyModelId: 'grok-5' })).toBeUndefined()
    expect(remainingForModel([{ ...codex, windows: [] }], { proxyModelId: 'gpt-6' })).toBeUndefined()
  })

  it('maps a model to the provider whose credential serves it', () => {
    expect(quotaProviderForModel([codex, antigravity], { proxyModelId: 'claude-sonnet-4-6' })).toBe('antigravity')
    expect(quotaProviderForModel([codex], { proxyModelId: 'unknown' })).toBeUndefined()
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
