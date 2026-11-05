import type { CodexResetOption } from '@src/cliproxy/quota/codex-resets'
import type { QuotaReport } from '@src/cliproxy/quota/quota'
import { createFastModeNudge, fastModeOpportunity, fastModeQuota } from '@src/extension/fast-mode-nudge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderModel } from '../support/chat'
import { commands, createExtensionContext, resetVSCodeMock, vscodeMock, window } from '../support/vscode'

const MINUTE = 60_000
const now = Date.now()
const model = createProviderModel({ proxyOwner: 'openai', proxyModelId: 'gpt-test' })
const fast = { ...model, id: `${model.id}:fast`, serviceTier: 'priority' as const, name: 'GPT Test (Fast Mode)', detail: '2x usage' }

function report(label = '5h Quota', minutes = 45): QuotaReport {
  return { provider: 'codex', account: { authIndex: 'one', label: 'Account One' }, updatedAt: now, windows: [{ label, remainingPercent: 60, resetsAt: now + minutes * MINUTE }] }
}

beforeEach(() => {
  resetVSCodeMock()
  vi.spyOn(Date, 'now').mockReturnValue(now)
})

describe('fast-mode eligibility', () => {
  it.each([
    ['5h Quota', 45, true],
    ['5h Quota', 46, false],
    ['7d Quota', 180, true],
    ['7d Quota', 181, false],
    ['7d Quota', 0, false],
    ['Other Quota', 5, false],
  ])('checks %s resetting in %i minutes', (label, minutes, expected) => {
    expect(fastModeOpportunity(model, report(label, minutes)) !== undefined).toBe(expected)
  })

  it('requires a fresh, healthy, unambiguous account and standard mode', () => {
    const quota = report()
    expect(fastModeQuota(model, [quota])).toBe(quota)
    expect(fastModeQuota(fast, [quota])).toBeUndefined()
    expect(fastModeQuota(model, [quota, { ...quota, account: { authIndex: 'two', label: 'Other' } }])).toBeUndefined()
    expect(fastModeQuota(model, [{ ...quota, error: 'offline' }])).toBeUndefined()
    expect(fastModeQuota(model, [{ ...quota, updatedAt: now - 21 * MINUTE }])).toBeUndefined()
    expect(fastModeQuota(model, [{ ...quota, updatedAt: undefined } as never])).toBeUndefined()
    expect(fastModeQuota(model, [{ ...quota, windows: [...quota.windows, { label: '7d Quota', remainingPercent: 19 }] }])).toBeUndefined()
    expect(fastModeOpportunity(model, { ...quota, windows: [{ ...quota.windows[0]!, remainingPercent: 49 }] })).toBeUndefined()
  })

  it('ignores unrelated Claude caps and purchased credits', () => {
    const quota: QuotaReport = { ...report(), provider: 'claude', windows: [
      ...report().windows,
      { key: 'seven_day_opus', label: '7d Opus', remainingPercent: 0 },
      { key: 'extra_usage', label: 'Extra Usage', remainingPercent: 0 },
    ] }
    const claude = { ...model, proxyOwner: 'anthropic', proxyModelId: 'claude-sonnet' }
    expect(fastModeQuota(claude, [quota])).toBe(quota)
    expect(fastModeQuota({ ...claude, proxyModelId: 'claude-opus' }, [quota])).toBeUndefined()
    const credits = { ...report('Other Quota'), windows: [{ key: 'credits', label: '7d Quota', remainingPercent: 100, resetsAt: now + MINUTE }] }
    expect(fastModeOpportunity(model, credits)).toBeUndefined()
  })

  it('matches expiring credits to the account, expiry window, and remaining quota', () => {
    const quota = report('7d Quota', 500)
    const reset = { account: quota.account!, credit: { id: 'credit', expiresAt: now + 180 * MINUTE }, availableCount: 1 }
    expect(fastModeOpportunity(model, quota, [reset])).toMatchObject({ kind: 'credit', id: 'credit' })
    for (const option of [
      { ...reset, account: { authIndex: 'other', label: 'Other' } },
      { ...reset, credit: { ...reset.credit, expiresAt: now + 181 * MINUTE } },
      { ...reset, credit: { ...reset.credit, expiresAt: now } },
      { ...reset, credit: { id: 'unknown' } },
      { ...reset, availableCount: 0 },
    ])
      expect(fastModeOpportunity(model, quota, [option])).toBeUndefined()
    expect(fastModeOpportunity(model, { ...quota, windows: [{ label: '7d Quota', remainingPercent: 49 }] }, [reset])).toBeUndefined()
  })
})

describe('fast-mode notification', () => {
  function setup() {
    const context = createExtensionContext()
    const readers = { listCodexResets: vi.fn(async (): Promise<CodexResetOption[]> => []), listClaudeResets: vi.fn(async () => []) }
    return { context, readers, nudge: createFastModeNudge(context, readers) }
  }

  it('notifies once per opportunity across reloads and includes the Fast variant cost', async () => {
    const { context, readers, nudge } = setup()
    await nudge(model, fast, [report()])
    await nudge(model, fast, [report()])
    await createFastModeNudge(context, readers)(model, fast, [report()])
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1)
    expect(window.showInformationMessage.mock.calls[0]?.[0]).toContain('GPT Test (Fast Mode) (2x usage)')
    expect(readers.listCodexResets).not.toHaveBeenCalled()
    await nudge(model, fast, [report('5h Quota', 44)])
    expect(window.showInformationMessage).toHaveBeenCalledTimes(2)
  })

  it('respects missing Fast variants and disabled suggestions without fetching resets', async () => {
    const { readers, nudge } = setup()
    await nudge(model, undefined, [report()])
    vscodeMock.settings.set('universalChatProvider.models.suggestFastMode', false)
    await nudge(model, fast, [report()])
    expect(window.showInformationMessage).not.toHaveBeenCalled()
    expect(readers.listCodexResets).not.toHaveBeenCalled()
  })

  it('opens quotas or disables suggestions without changing models', async () => {
    const { nudge } = setup()
    window.showInformationMessage.mockResolvedValueOnce('View Quota & Resets')
    await nudge(model, fast, [report()])
    expect(commands.executeCommand).toHaveBeenCalledWith('universalChatProvider.showQuota')
    window.showInformationMessage.mockResolvedValueOnce('Don\'t Suggest Again')
    await nudge(model, fast, [report('5h Quota', 44)])
    expect(vscodeMock.settings.get('universalChatProvider.models.suggestFastMode')).toBe(false)
  })

  it('caches reset lookups and handles lookup failures quietly', async () => {
    const { readers, nudge } = setup()
    readers.listCodexResets.mockRejectedValueOnce(new Error('offline'))
    await nudge(model, fast, [report('7d Quota', 500)])
    await nudge(model, fast, [report('7d Quota', 500)])
    expect(readers.listCodexResets).toHaveBeenCalledTimes(1)
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it('suggests expiring credits, caches lookups, and refreshes them after five minutes', async () => {
    const { readers, nudge } = setup()
    readers.listCodexResets.mockResolvedValue([{ account: report().account!, credit: { id: 'credit', expiresAt: now + 180 * MINUTE }, availableCount: 1 }])
    await nudge(model, fast, [report('7d Quota', 500)])
    await nudge(model, fast, [report('7d Quota', 500)])
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1)
    expect(window.showInformationMessage.mock.calls[0]?.[0]).toContain('unused reset credit expiring in 3h')
    expect(readers.listCodexResets).toHaveBeenCalledTimes(1)
    vi.mocked(Date.now).mockReturnValue(now + 5 * MINUTE)
    await nudge(model, fast, [report('7d Quota', 500)])
    expect(readers.listCodexResets).toHaveBeenCalledTimes(2)
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1)
  })

  it.each(['model changed', 'disabled'])('cancels an in-flight suggestion when %s', async (change) => {
    const { readers, nudge } = setup()
    let resolve!: (resets: CodexResetOption[]) => void
    readers.listCodexResets.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    }))
    const pending = nudge(model, fast, [report('7d Quota', 500)])
    if (change === 'model changed')
      await nudge(fast, undefined, [report()])
    else
      vscodeMock.settings.set('universalChatProvider.models.suggestFastMode', false)
    resolve([{ account: report().account!, credit: { id: 'credit', expiresAt: now + MINUTE }, availableCount: 1 }])
    await pending
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })
})
