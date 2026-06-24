import type { QuickPickItem } from 'vscode'
import type { QuotaSection, QuotaSource } from '../../src/extension/quota-menu'
import { beforeEach, describe, expect, it } from 'vitest'
import { showQuotaMenu } from '../../src/extension/quota-menu'
import { quickPick, resetVSCodeMock } from '../support/vscode'

beforeEach(() => {
  resetVSCodeMock()
})

function source(sections: QuotaSection[]): QuotaSource {
  return { quotaSections: () => sections }
}

function labels(): string[] {
  return (quickPick.items as QuickPickItem[]).map(item => item.label)
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
      'Antigravity · Claude Sonnet 4.6 — 100% left',
    ])
    expect(quickPick.busy).toBe(false)
  })

  it('shows a no-data row when there is no quota', async () => {
    await showQuotaMenu(source([]), async () => {})
    expect(labels()).toEqual(['No model quota information is available yet.'])
  })

  it('shows "unknown" when a percentage is missing', async () => {
    await showQuotaMenu(source([{ title: 'Codex', entries: [{ name: '7d Quota', remainingPercent: undefined }] }]), async () => {})
    expect(labels()).toEqual(['Codex · 7d Quota — unknown'])
  })
})
