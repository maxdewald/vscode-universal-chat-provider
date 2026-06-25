import type { ThemeColor } from 'vscode'
import type { MarkdownString } from '../support/vscode'
import { beforeEach, describe, expect, it } from 'vitest'
import { StatusBarAlignment } from 'vscode'
import { createStatusBar, updateStatusBar } from '../../src/extension/status-bar'
import { resetVSCodeMock, statusBarItem, vscodeMock, window } from '../support/vscode'

function tooltipValue(): string {
  return (statusBarItem.tooltip as MarkdownString).value
}

beforeEach(() => {
  resetVSCodeMock()
})

describe('status bar', () => {
  it('creates a manage-provider status item', () => {
    const item = createStatusBar()

    expect(window.createStatusBarItem).toHaveBeenCalledWith(StatusBarAlignment.Right, 100)
    expect(item.command).toBe('universalChatProvider.manage')
  })

  it.each([
    ['external', '$(server) Universal Chat Provider', 'using an external server'],
    ['starting', '$(loading~spin) Universal Chat Provider', 'starting the managed server'],
    ['running', '$(server-process) Universal Chat Provider', 'managed server running'],
    ['error', '$(error) Universal Chat Provider', 'managed server failed to start'],
  ] as const)('shows %s status', (status, text, tooltip) => {
    updateStatusBar(statusBarItem as never, status)

    expect(statusBarItem.text).toBe(text)
    expect(tooltipValue()).toContain(tooltip)
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

  it('renders quota sections with bars and command links', () => {
    updateStatusBar(statusBarItem as never, 'running', [
      { title: 'Codex', entries: [{ name: '5h Quota', remainingPercent: 80 }, { name: '7d Quota', remainingPercent: 8 }] },
      { title: 'Antigravity', entries: [{ name: 'Gemini 3 Pro', remainingPercent: undefined }] },
    ])

    const value = tooltipValue()
    expect(value).toContain('**Codex**')
    expect(value).toContain('80%')
    expect(value).toContain('$(warning)') // 7d Quota at 8% is below the low-quota threshold
    expect(value).toContain('Gemini 3 Pro')
    const tooltip = statusBarItem.tooltip as MarkdownString
    expect(tooltip.supportThemeIcons).toBe(true)
  })
})
