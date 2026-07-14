import type { QuickPickItem } from 'vscode'
import type { CodexResetOption } from '../../src/cliproxy/codex-resets'
import type { QuotaSection } from '../../src/extension/quota-menu'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickPickItemKind } from 'vscode'
import { showQuotaMenu } from '../../src/extension/quota-menu'
import { env, quickPick, resetVSCodeMock, triggerQuickPickItemButton, window } from '../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

function source(sections: QuotaSection[]): () => QuotaSection[] {
  return () => sections
}

function labels(): string[] {
  return (quickPick.items as QuickPickItem[]).map(item => item.label)
}

const RESET = {
  account: { authIndex: 'codex-1', label: 'one@example.com', accountId: 'acct-1' },
  credit: { id: 'credit-1', expiresAt: Date.parse('2026-07-20T00:00:00Z') },
  availableCount: 2,
} satisfies CodexResetOption

async function clickReset(): Promise<void> {
  const item = (quickPick.items as Array<QuickPickItem & { reset?: CodexResetOption }>).find(candidate => candidate.reset !== undefined)!
  await triggerQuickPickItemButton({ item, button: item.buttons![0] })
}

async function acceptReset(): Promise<void> {
  const item = (quickPick.items as Array<QuickPickItem & { reset?: CodexResetOption }>).find(candidate => candidate.reset !== undefined)!
  quickPick.activeItems = [item]
  const listener: unknown = quickPick.onDidAccept.mock.calls[0]?.[0]
  if (typeof listener !== 'function') {
    throw new TypeError('No Quick Pick accept listener was registered.')
  }
  ;(listener as () => void)()
  await vi.waitFor(() => expect(window.showWarningMessage).toHaveBeenCalled())
}

describe('showQuotaMenu', () => {
  it('opens immediately, runs the refresh, then fills the picker from fresh data', async () => {
    let refreshed = false
    await showQuotaMenu(source([
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 99 }, { name: '7d Quota', remainingPercent: 51 }] },
      { title: 'Antigravity', entries: [{ name: 'Claude Sonnet 4.6', remainingPercent: 100 }] },
    ]), async () => {
      refreshed = true
    })

    expect(quickPick.show).toHaveBeenCalled()
    expect(refreshed).toBe(true)
    expect(labels()).toEqual([
      'Codex · 5h Quota — 99% left',
      'Codex · 7d Quota — 51% left',
      '',
      'Antigravity · Claude Sonnet 4.6 — 100% left',
    ])
    expect((quickPick.items as QuickPickItem[]).filter(item => item.kind === QuickPickItemKind.Separator).map(item => item.label)).toEqual([''])
    expect(quickPick.busy).toBe(false)
  })

  it('shows a no-data row when there is no quota', async () => {
    await showQuotaMenu(source([]), async () => {})
    expect(labels()).toEqual(['No model quota information is available yet.'])
  })

  it.each([
    ['unknown', undefined, 'unknown'],
    ['rounded', 42.6, '43% left'],
  ] as const)('shows a %s percentage', async (_name, remainingPercent, expected) => {
    await showQuotaMenu(source([{ title: 'Codex', entries: [{ name: '7d Quota', remainingPercent }] }]), async () => {})
    expect(labels()).toEqual([`Codex · 7d Quota — ${expected}`])
  })

  it('appends a reset countdown when resetsAt is in the future', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-12T00:00:00Z') })
    const resetsAt = Date.parse('2026-07-12T03:25:00Z') // 3h 25m ahead
    await showQuotaMenu(source([{ title: 'Grok', entries: [{ name: 'Credits', remainingPercent: 75, resetsAt }] }]), async () => {})
    expect(labels()).toEqual(['Grok · Credits — 75% left'])
    expect((quickPick.items as QuickPickItem[])[0]?.description).toBe('resets in 3h 25m')
    vi.useRealTimers()
  })

  it('omits the reset suffix when resetsAt is missing or in the past', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-12T00:00:00Z') })
    const past = Date.parse('2026-07-11T00:00:00Z')
    await showQuotaMenu(source([
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 99, resetsAt: past }] },
      { title: 'Codex', entries: [{ name: '7d Quota', remainingPercent: 51 }] },
    ]), async () => {})
    expect(labels()).toEqual([
      'Codex · 5h Quota — 99% left',
      'Codex · 7d Quota — 51% left',
    ])
    vi.useRealTimers()
  })

  it('shows one reset action per eligible account', async () => {
    env.language = 'de-DE'
    await showQuotaMenu(source([]), async () => {}, {
      listCodexResets: async () => [RESET, {
        account: { authIndex: 'codex-2', label: 'two@example.com' },
        credit: { id: 'credit-2' },
        availableCount: 1,
      }],
      claimCodexReset: vi.fn(),
    })

    expect(labels()).toEqual([
      'Codex · one@example.com — 2 resets available',
      'Codex · two@example.com — 1 reset available',
    ])
    const resetItems = (quickPick.items as Array<QuickPickItem & { reset?: CodexResetOption }>).filter(item => item.reset !== undefined)
    expect(resetItems.map(item => item.description)).toEqual([
      `Next reset expires ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(RESET.credit.expiresAt)}`,
      'Next reset does not expire',
    ])
    expect(resetItems.every(item => item.buttons?.[0]?.tooltip === 'Use next reset')).toBe(true)
  })

  it.each([
    ['button', clickReset],
    ['row', acceptReset],
  ])('never claims a reset when the %s confirmation is cancelled', async (_name, trigger) => {
    const claim = vi.fn()
    window.showWarningMessage.mockResolvedValueOnce(undefined)
    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [RESET], claimCodexReset: claim })

    await trigger()

    expect(quickPick.hide).not.toHaveBeenCalled()
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('consumes one reset credit'),
      { modal: true },
      'Use Reset',
    )
    expect(claim).not.toHaveBeenCalled()
  })

  it('gives a stronger warning when the account still has usage remaining', async () => {
    const claim = vi.fn()
    const resetWithUsage = {
      ...RESET,
      hasRemainingUsage: true,
    } satisfies CodexResetOption
    window.showWarningMessage.mockResolvedValueOnce(undefined)
    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [resetWithUsage], claimCodexReset: claim })

    await clickReset()

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'WARNING: one@example.com still has usage remaining. Using a reset now discards that remaining usage and consumes one reset credit. This cannot be undone.',
      { modal: true },
      'Use Reset Anyway',
    )
    expect(claim).not.toHaveBeenCalled()
  })

  it('claims only after confirmation and refreshes the reset action', async () => {
    const claim = vi.fn(async () => 'success' as const)
    const list = vi.fn()
      .mockResolvedValueOnce([RESET])
      .mockResolvedValueOnce([])
    window.showWarningMessage.mockResolvedValueOnce('Use Reset')
    await showQuotaMenu(source([{ title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 100 }] }]), async () => {}, { listCodexResets: list, claimCodexReset: claim })

    await clickReset()

    expect(claim).toHaveBeenCalledWith(RESET, expect.any(String))
    expect(list).toHaveBeenCalledTimes(2)
    expect(labels()).toEqual(['Codex · 5h Quota — 100% left'])
    expect(window.showInformationMessage).toHaveBeenCalledWith('Codex usage reset for one@example.com.')
  })

  it('requires confirmation again while reusing the same idempotency key on retry', async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('success')
    window.showWarningMessage.mockResolvedValue('Use Reset')
    await showQuotaMenu(source([]), async () => {}, { listCodexResets: async () => [RESET], claimCodexReset: claim })

    await clickReset()
    await clickReset()

    expect(window.showWarningMessage).toHaveBeenCalledTimes(2)
    expect(claim).toHaveBeenCalledTimes(2)
    expect(claim.mock.calls[0]![1]).toBe(claim.mock.calls[1]![1])
  })
})
