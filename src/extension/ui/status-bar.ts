import type { ServerStatus } from '@src/cliproxy/controller'
import type { QuotaSection } from '@src/extension/ui/quota-menu'
import type { StatusBarItem } from 'vscode'
import { formatPercent, formatResetCountdown } from '@src/cliproxy/quota/quota'
import { MarkdownString, StatusBarAlignment, ThemeColor, window, workspace } from 'vscode'

// Default remaining-quota percent below which the status bar warns; overridable per setting.
const DEFAULT_LOW_PERCENT = 10

// Percent below which to warn, or undefined when warnings are disabled.
function warnBelow(): number | undefined {
  const cfg = workspace.getConfiguration('universalChatProvider')
  return cfg.get<boolean>('showQuotaWarnings', true)
    ? cfg.get<number>('quotaWarningThreshold', DEFAULT_LOW_PERCENT)
    : undefined
}

const PRESENTATION: Record<ServerStatus, { icon: string, tooltip?: string }> = {
  external: { icon: '$(server)', tooltip: 'using an external server' },
  starting: { icon: '$(loading~spin)', tooltip: 'starting the managed server…' },
  running: { icon: '$(server-process)' },
  error: { icon: '$(warning)', tooltip: 'managed server is not running' },
}

export function createStatusBar(): StatusBarItem {
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.command = 'universalChatProvider.manage'
  return statusBar
}

export function updateStatusBar(
  statusBar: StatusBarItem,
  status: ServerStatus,
  sections: QuotaSection[] = [],
  current?: { name: string, remainingPercent: number },
): void {
  const { icon, tooltip } = PRESENTATION[status]
  const threshold = warnBelow()
  const low = threshold !== undefined && current !== undefined && current.remainingPercent < threshold
  const unavailable = status === 'error'
  statusBar.text = unavailable
    ? '$(warning) Universal Chat Provider'
    : low
      ? `$(warning) ${current.name} · ${formatPercent(current.remainingPercent)} left`
      : `${icon} Universal Chat Provider`
  statusBar.backgroundColor = unavailable || low ? new ThemeColor('statusBarItem.warningBackground') : undefined
  statusBar.tooltip = buildTooltip(icon, tooltip, sections, threshold)
}

function buildTooltip(icon: string, header: string | undefined, sections: QuotaSection[], threshold: number | undefined): MarkdownString {
  const md = new MarkdownString()
  md.supportThemeIcons = true
  md.appendMarkdown(`${icon} **Universal Chat Provider**`)
  if (header !== undefined)
    md.appendMarkdown(`\n\n${header}`)
  if (!sections.some(section => section.entries.length > 0))
    return md

  md.appendMarkdown('\n\n| Quota | Available | Left | | Resets |\n| :-- | :-- | --: | :-- | :-- |\n')
  for (const [index, section] of sections.entries()) {
    if (index > 0)
      md.appendMarkdown('| | | | | |\n')
    md.appendMarkdown(`| **${escapeTableCell(section.title)}** | | | | |\n`)
    for (const entry of section.entries) {
      const warn = threshold !== undefined && entry.remainingPercent !== undefined && entry.remainingPercent < threshold ? '$(warning) ' : ''
      const reset = formatResetCountdown(entry.resetsAt) ?? '—'
      md.appendMarkdown(`| ${escapeTableCell(entry.name)} | ${gaugeBar(entry.remainingPercent)} | ${warn}${formatPercent(entry.remainingPercent)} | | ${reset} |\n`)
    }
  }
  return md
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

// Fixed 10-block track so remaining capacity reads as empty space, not a shorter full bar.
function gaugeBar(percent: number | undefined): string {
  if (percent === undefined)
    return ''
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))
  return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\``
}
