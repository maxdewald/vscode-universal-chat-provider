import type { StatusBarItem } from 'vscode'
import type { ServerStatus } from '../cliproxy/controller'
import type { QuotaSection } from './quota-menu'
import { MarkdownString, StatusBarAlignment, ThemeColor, window, workspace } from 'vscode'
import { formatPercent } from '../cliproxy/quota'

// Default remaining-quota percent below which the status bar warns; overridable per setting.
const DEFAULT_LOW_PERCENT = 10

// Percent below which to warn, or undefined when warnings are disabled.
function warnBelow(): number | undefined {
  const cfg = workspace.getConfiguration('universalChatProvider')
  return cfg.get<boolean>('showQuotaWarnings', true)
    ? cfg.get<number>('quotaWarningThreshold', DEFAULT_LOW_PERCENT)
    : undefined
}

const PRESENTATION: Record<ServerStatus, { icon: string, tooltip: string }> = {
  external: { icon: '$(server)', tooltip: 'Universal Chat Provider: using an external server' },
  starting: { icon: '$(loading~spin)', tooltip: 'Universal Chat Provider: starting the managed server…' },
  running: { icon: '$(server-process)', tooltip: 'Universal Chat Provider: managed server running' },
  error: { icon: '$(error)', tooltip: 'Universal Chat Provider: managed server failed to start' },
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
  statusBar.text = low
    ? `$(warning) ${current.name} · ${formatPercent(current.remainingPercent)} left`
    : `${icon} Universal Chat Provider`
  statusBar.backgroundColor = low ? new ThemeColor('statusBarItem.warningBackground') : undefined
  statusBar.tooltip = buildTooltip(icon, tooltip, sections, threshold)
}

function buildTooltip(icon: string, header: string, sections: QuotaSection[], threshold: number | undefined): MarkdownString {
  const md = new MarkdownString()
  md.supportThemeIcons = true
  md.appendMarkdown(`${icon} **${header}**\n\n`)
  for (const section of sections) {
    md.appendMarkdown(`| **${section.title}** | | |\n| :-- | :-- | --: |\n`)
    for (const entry of section.entries) {
      const warn = threshold !== undefined && entry.remainingPercent !== undefined && entry.remainingPercent < threshold ? '$(warning) ' : ''
      md.appendMarkdown(`| ${entry.name} | ${gaugeBar(entry.remainingPercent)} | ${warn}${formatPercent(entry.remainingPercent)} |\n`)
    }
    md.appendMarkdown('\n')
  }
  return md
}

// Filled blocks only, in their own table column: with no empty-track glyph the bar can never
// out-width itself, so the column borders stay straight. The percent sits in its own right-aligned column.
function gaugeBar(percent: number | undefined): string {
  const filled = percent === undefined ? 0 : Math.round(percent / 10)
  return filled === 0 ? '' : `\`${'█'.repeat(filled)}\``
}
