import type { MarkdownString, ThemeColor } from 'vscode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBarAlignment } from 'vscode'
import { createStatusBar, updateStatusBar } from '../../src/extension/status-bar'
import { resetVSCodeMock, statusBarItem, vscodeMock, window } from '../support/vscode'

function tooltipValue(): string {
  return (statusBarItem.tooltip as MarkdownString).value
}

beforeEach(() => {
  resetVSCodeMock()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('status bar', () => {
  it('creates a manage-provider status item', () => {
    const item = createStatusBar()

    expect(window.createStatusBarItem).toHaveBeenCalledWith(StatusBarAlignment.Right, 100)
    expect(item.command).toBe('universalChatProvider.manage')
  })

  it.each([
    ['external', '$(server) Universal Chat Provider', 'using an external server', undefined],
    ['starting', '$(loading~spin) Universal Chat Provider', 'starting the managed server', undefined],
    ['error', '$(warning) Universal Chat Provider', 'managed server is not running', 'statusBarItem.warningBackground'],
  ] as const)('shows %s status', (status, text, tooltip, background) => {
    updateStatusBar(statusBarItem as never, status)

    expect(statusBarItem.text).toBe(text)
    expect(tooltipValue()).toContain(tooltip)
    expect(statusBarItem.backgroundColor?.id).toBe(background)
  })

  it('omits the healthy managed server state from the tooltip', () => {
    updateStatusBar(statusBarItem as never, 'running')

    expect(statusBarItem.text).toBe('$(server-process) Universal Chat Provider')
    expect(tooltipValue()).not.toContain('managed server running')
  })

  it('warns in the bar when the active model is low on quota', () => {
    updateStatusBar(statusBarItem as never, 'running', [], { name: 'Gemini 3 Pro', remainingPercent: 6 })

    expect(statusBarItem.text).toBe('$(warning) Gemini 3 Pro · 6% left')
    expect((statusBarItem.backgroundColor as ThemeColor).id).toBe('statusBarItem.warningBackground')
  })

  it('stays normal when the active model is above the low threshold', () => {
    updateStatusBar(statusBarItem as never, 'running', [], { name: 'Gemini 3 Pro', remainingPercent: 12 })

    expect(statusBarItem.text).toBe('$(server-process) Universal Chat Provider')
    expect(statusBarItem.backgroundColor).toBeUndefined()
  })

  it('never warns when showQuotaWarnings is disabled', () => {
    vscodeMock.settings.set('universalChatProvider.showQuotaWarnings', false)
    updateStatusBar(statusBarItem as never, 'running', [
      { title: 'Codex', entries: [{ name: '7d Quota', remainingPercent: 2 }] },
    ], { name: 'Gemini 3 Pro', remainingPercent: 2 })

    expect(statusBarItem.text).toBe('$(server-process) Universal Chat Provider')
    expect(statusBarItem.backgroundColor).toBeUndefined()
    expect(tooltipValue()).not.toContain('$(warning)')
  })

  it('honors a custom quotaWarningThreshold', () => {
    vscodeMock.settings.set('universalChatProvider.quotaWarningThreshold', 50)
    updateStatusBar(statusBarItem as never, 'running', [], { name: 'Gemini 3 Pro', remainingPercent: 40 })

    expect(statusBarItem.text).toBe('$(warning) Gemini 3 Pro · 40% left')
  })

  it('renders all quota sections in one aligned table with resets', () => {
    vi.useFakeTimers({ now: new Date('2026-07-12T00:00:00Z') })
    updateStatusBar(statusBarItem as never, 'running', [
      { title: 'Codex', entries: [
        { name: '5h Quota', remainingPercent: 80, resetsAt: Date.parse('2026-07-12T03:25:00Z') },
        { name: '7d Quota', remainingPercent: 8 },
      ] },
      { title: 'Antigravity', entries: [{ name: 'Gemini 3 Pro', remainingPercent: undefined }] },
    ])

    const value = tooltipValue()
    expect(value).toContain('| Quota | Available | Left | | Resets |')
    expect(value).toContain('| **Codex** | | | | |')
    expect(value).toContain('| 5h Quota | `████████░░` | 80% | | 3h 25m |')
    expect(value).toContain('| 7d Quota | `█░░░░░░░░░` | $(warning) 8% | | — |')
    expect(value).toContain('| | | | | |\n| **Antigravity** | | | | |')
    expect(value).toContain('| Gemini 3 Pro |  | ? | | — |')
    expect(value.match(/\*\*Codex\*\*/g)).toHaveLength(1)
    const tooltip = statusBarItem.tooltip as MarkdownString
    expect(tooltip.supportThemeIcons).toBe(true)
  })
})
