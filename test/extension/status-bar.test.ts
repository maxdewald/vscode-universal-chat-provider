import type { MarkdownString } from '../support/vscode'
import { beforeEach, describe, expect, it } from 'vitest'
import { StatusBarAlignment } from 'vscode'
import { createStatusBar, updateStatusBar } from '../../src/extension/status-bar'
import { resetVSCodeMock, statusBarItem, window } from '../support/vscode'

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
