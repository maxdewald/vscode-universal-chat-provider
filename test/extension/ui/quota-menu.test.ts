import type { CodexResetOption } from '@src/cliproxy/quota/codex-resets'
import type { QuotaSection } from '@src/extension/ui/quota-menu'
import type { QuickPickItem } from 'vscode'
import { showQuotaMenu } from '@src/extension/ui/quota-menu'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env, QuickPickItemKind } from 'vscode'
import { resetVSCodeMock, window } from '../../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

const RESET = {
  account: { authIndex: 'codex-1', label: 'one@example.com', accountId: 'acct-1' },
  credit: { id: 'credit-1', expiresAt: Date.parse('2026-07-20T00:00:00Z') },
  availableCount: 2,
} satisfies CodexResetOption

function source(sections: QuotaSection[]): () => QuotaSection[] {
  return () => sections
}

function shownItems(call = 0): Array<QuickPickItem & { reset?: CodexResetOption }> {
  return window.showQuickPick.mock.calls[call]?.[0] as Array<QuickPickItem & { reset?: CodexResetOption }>
}

function chooseReset(times = 1): void {
  let remaining = times
  window.showQuickPick.mockImplementation(async (items) => {
    if (remaining-- <= 0)
      return undefined
    return (items as Array<QuickPickItem & { reset?: CodexResetOption }>).find(item => item.reset !== undefined)
  })
}

describe('showQuotaMenu', () => {
  it('refreshes before showing fresh quota rows', async () => {
    let refreshed = false
    await showQuotaMenu(source([
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 99 }, { name: '7d Quota', remainingPercent: 51 }] },
      { title: 'Antigravity', entries: [{ name: 'Claude Sonnet 4.6', remainingPercent: 100 }] },
    ]), async () => {
      refreshed = true
    })

    expect(refreshed).toBe(true)
    expect(shownItems().map(item => item.label)).toEqual([
      'Codex · 5h Quota — 99% left',
      'Codex · 7d Quota — 51% left',
      '',
      'Antigravity · Claude Sonnet 4.6 — 100% left',
    ])
    expect(shownItems().filter(item => item.kind === QuickPickItemKind.Separator)).toHaveLength(1)
  })

  it('formats missing, rounded, balance, and reset values', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-12T00:00:00Z') })
    await showQuotaMenu(source([
      { title: 'Codex', entries: [{ name: 'Unknown', remainingPercent: undefined }, { name: 'Rounded', remainingPercent: 42.6 }] },
      { title: 'Claude', entries: [
        { name: 'Extra Usage', remainingPercent: 75, balance: { amount: 15, currency: 'EUR', suffix: 'left' } },
        { name: 'Extra Usage', remainingPercent: undefined, balance: { amount: 7.55, currency: 'EUR', suffix: 'used' } },
      ] },
      { title: 'Grok', entries: [{ name: 'Credits', remainingPercent: 75, resetsAt: Date.parse('2026-07-12T03:25:00Z') }] },
    ]), async () => {})

    expect(shownItems().map(item => item.label)).toEqual([
      'Codex · Unknown — unknown',
      'Codex · Rounded — 43% left',
      '',
      'Claude · Extra Usage — €15.00 left (75% left)',
      'Claude · Extra Usage — €7.55 used',
      '',
      'Grok · Credits — 75% left',
    ])
    expect(shownItems().at(-1)?.description).toBe('resets in 3h 25m')
  })

  it('shows a no-data row when there is no quota or reset', async () => {
    await showQuotaMenu(source([]), async () => {})
    expect(shownItems().map(item => item.label)).toEqual(['No model quota information is available yet.'])
  })

  it('shows one reset row per eligible account', async () => {
    await showQuotaMenu(source([]), async () => {}, {
      listCodexResets: async () => [RESET, {
        account: { authIndex: 'codex-2', label: 'two@example.com' },
        credit: { id: 'credit-2' },
        availableCount: 1,
      }],
      claimCodexReset: vi.fn(),
    })

    expect(shownItems().map(item => item.label)).toEqual([
      'Codex · one@example.com — 2 resets available',
      'Codex · two@example.com — 1 reset available',
    ])
    expect(shownItems().map(item => item.description)).toEqual([
      `Next reset expires ${new Intl.DateTimeFormat(env.language, { dateStyle: 'medium', timeStyle: 'short' }).format(RESET.credit.expiresAt)}`,
      'Next reset does not expire',
    ])
  })

  it('does not claim a reset when confirmation is cancelled', async () => {
    const claim = vi.fn()
    chooseReset()
    window.showWarningMessage.mockResolvedValueOnce(undefined)

    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [RESET], claimCodexReset: claim })

    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('consumes one reset credit'), { modal: true }, 'Use Reset')
    expect(claim).not.toHaveBeenCalled()
  })

  it('warns before discarding remaining usage', async () => {
    const option = { ...RESET, hasRemainingUsage: true }
    chooseReset()
    window.showWarningMessage.mockResolvedValueOnce(undefined)

    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [option], claimCodexReset: vi.fn() })

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'WARNING: one@example.com still has usage remaining. Using a reset now discards that remaining usage and consumes one reset credit. This cannot be undone.',
      { modal: true },
      'Use Reset Anyway',
    )
  })

  it('claims after confirmation and reloads available resets', async () => {
    const claim = vi.fn(async () => 'success' as const)
    const list = vi.fn().mockResolvedValueOnce([RESET]).mockResolvedValueOnce([])
    chooseReset()
    window.showWarningMessage.mockResolvedValueOnce('Use Reset')

    await showQuotaMenu(source([{ title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 100 }] }]), async () => {}, { listCodexResets: list, claimCodexReset: claim })

    expect(claim).toHaveBeenCalledWith(RESET, expect.any(String))
    expect(list).toHaveBeenCalledTimes(2)
    expect(shownItems(1).map(item => item.label)).toEqual(['Codex · 5h Quota — 100% left'])
    expect(window.showInformationMessage).toHaveBeenCalledWith('Codex usage reset for one@example.com.')
  })

  it('reuses the idempotency key when a failed reset is retried', async () => {
    const claim = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('success')
    chooseReset(2)
    window.showWarningMessage.mockResolvedValue('Use Reset')

    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [RESET], claimCodexReset: claim })

    expect(claim).toHaveBeenCalledTimes(2)
    expect(claim.mock.calls[0]![1]).toBe(claim.mock.calls[1]![1])
  })
})
